/**
 * Obscura Rec LLC - Express Backend & Direct Gmail Dispatcher
 * Official Label Mailbox: ocr.agreements@gmail.com
 */

import express from 'express';
import cors from 'cors';
import nodemailer from 'nodemailer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Enable JSON bodies & CORS
app.use(express.json({ limit: '25mb' }));
app.use(cors());

// Data storage directories
const DATA_DIR = path.join(__dirname, 'data');
const AGREEMENTS_DIR = path.join(DATA_DIR, 'agreements');
const VAULT_DIR = path.join(DATA_DIR, 'vault');
const CONFIG_FILE = path.join(DATA_DIR, 'mail-config.json');

fs.mkdirSync(AGREEMENTS_DIR, { recursive: true });
fs.mkdirSync(VAULT_DIR, { recursive: true });

// Read or initialize mail config
function getMailConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    }
  } catch (e) {
    console.error('Error reading mail config:', e);
  }
  return {
    email: 'ocr.agreements@gmail.com',
    appPassword: process.env.GMAIL_APP_PASSWORD || ''
  };
}

function saveMailConfig(cfg) {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2), 'utf8');
}

// Nodemailer Transporter factory
function getTransporter() {
  const cfg = getMailConfig();
  if (!cfg.appPassword) {
    return null;
  }
  return nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: 'ocr.agreements@gmail.com',
      pass: cfg.appPassword.replace(/\s+/g, '') // remove spaces from Google app password
    }
  });
}

// ----------------- API ENDPOINTS -----------------

// 1. Check or Save Mail Server Configuration
app.get('/api/mail-config', (req, res) => {
  const cfg = getMailConfig();
  res.json({
    email: cfg.email || 'ocr.agreements@gmail.com',
    hasPassword: Boolean(cfg.appPassword && cfg.appPassword.trim().length >= 16)
  });
});

app.post('/api/mail-config', (req, res) => {
  const { appPassword } = req.body;
  if (!appPassword || appPassword.trim().length < 16) {
    return res.status(400).json({ error: 'Please enter a valid 16-character Google App Password.' });
  }
  const cleanPassword = appPassword.trim().replace(/\s+/g, '');
  saveMailConfig({
    email: 'ocr.agreements@gmail.com',
    appPassword: cleanPassword
  });
  res.json({ success: true, message: 'Mail credentials saved successfully.' });
});

// 2. Save / Load Agreement by Ref ID (Checks active temporary links and vault archives)
app.get('/api/agreements/:id', (req, res) => {
  const tempFile = path.join(AGREEMENTS_DIR, `${req.params.id}.json`);
  if (fs.existsSync(tempFile)) {
    try {
      const data = JSON.parse(fs.readFileSync(tempFile, 'utf8'));
      return res.json(data);
    } catch (e) {
      return res.status(500).json({ error: 'Failed to read contract data.' });
    }
  }

  // Also check if already archived in Vault
  const vaultFile = path.join(VAULT_DIR, `${req.params.id}.json`);
  if (fs.existsSync(vaultFile)) {
    try {
      const data = JSON.parse(fs.readFileSync(vaultFile, 'utf8'));
      return res.json({ ...data, isArchivedInVault: true, isLockedForArtist: true });
    } catch (e) {
      return res.status(500).json({ error: 'Failed to read vault data.' });
    }
  }

  res.status(404).json({ error: 'Agreement not found.' });
});

app.post('/api/agreements', (req, res) => {
  const state = req.body;
  if (!state || !state.id) {
    return res.status(400).json({ error: 'Invalid agreement data (missing id).' });
  }
  const file = path.join(AGREEMENTS_DIR, `${state.id}.json`);
  fs.writeFileSync(file, JSON.stringify(state, null, 2), 'utf8');
  res.json({ success: true, id: state.id });
});

// ----------------- AGREEMENT VAULT & LIFECYCLE -----------------

// Finalize contract: Save into permanent Vault and PURGE temporary link file
app.post('/api/finalize-to-vault', (req, res) => {
  const state = req.body;
  if (!state || !state.id) {
    return res.status(400).json({ error: 'Missing agreement state.' });
  }

  state.finalizedAt = new Date().toISOString();
  state.isArchivedInVault = true;
  state.isLockedForArtist = true;
  state.status = 'fully_executed';

  // 1. Save to permanent vault
  const vaultFile = path.join(VAULT_DIR, `${state.id}.json`);
  fs.writeFileSync(vaultFile, JSON.stringify(state, null, 2), 'utf8');

  // 2. Permanently delete temporary signing link file to save hosting storage quota
  const tempFile = path.join(AGREEMENTS_DIR, `${state.id}.json`);
  if (fs.existsSync(tempFile)) {
    try {
      fs.unlinkSync(tempFile);
      console.log(`[Storage Optimized] Purged temporary signing file: ${state.id}.json`);
    } catch (e) {
      console.warn('Could not remove temporary file:', e);
    }
  }

  res.json({ success: true, id: state.id, finalizedAt: state.finalizedAt });
});

// List all agreements in the Vault for search & management
app.get('/api/vault', (req, res) => {
  try {
    const files = fs.readdirSync(VAULT_DIR).filter(f => f.endsWith('.json'));
    const records = [];
    for (const f of files) {
      try {
        const c = JSON.parse(fs.readFileSync(path.join(VAULT_DIR, f), 'utf8'));
        records.push({
          id: c.id,
          finalizedAt: c.finalizedAt || c.createdAt || new Date().toISOString(),
          artistLegalName: c.artist?.legalName || '',
          artistStageName: c.artist?.stageName || '',
          artistEmail: c.artist?.email || '',
          labelRepresentative: c.label?.representative || '',
          trackCount: Array.isArray(c.tracks) ? c.tracks.length : 0,
          firstTrackTitle: c.tracks?.[0]?.title || '',
          tracksList: Array.isArray(c.tracks) ? c.tracks.map(t => t.title).filter(Boolean) : [],
          hasArtistSignature: Boolean(c.artist?.signature),
          hasLabelSignature: Boolean(c.label?.signature),
          artistSigHash: c.artist?.signature?.hash || 'Verified',
          artistSigTimestamp: c.artist?.signature?.timestamp || '',
          labelSigTimestamp: c.label?.signature?.timestamp || ''
        });
      } catch (e) {}
    }
    records.sort((a, b) => new Date(b.finalizedAt || 0) - new Date(a.finalizedAt || 0));
    res.json({ success: true, records, count: records.length });
  } catch (err) {
    res.status(500).json({ error: 'Failed to list vault records: ' + err.message });
  }
});

// Get full agreement data from Vault by ID
app.get('/api/vault/:id', (req, res) => {
  const file = path.join(VAULT_DIR, `${req.params.id}.json`);
  if (fs.existsSync(file)) {
    try {
      const data = JSON.parse(fs.readFileSync(file, 'utf8'));
      return res.json(data);
    } catch (e) {
      return res.status(500).json({ error: 'Failed to read vault file.' });
    }
  }
  res.status(404).json({ error: 'Record not found in vault.' });
});

// Delete agreement from Vault (Storage management)
app.delete('/api/vault/:id', (req, res) => {
  const file = path.join(VAULT_DIR, `${req.params.id}.json`);
  if (fs.existsSync(file)) {
    try {
      fs.unlinkSync(file);
      return res.json({ success: true, message: `Agreement ${req.params.id} permanently deleted from vault.` });
    } catch (e) {
      return res.status(500).json({ error: 'Failed to delete file: ' + e.message });
    }
  }
  res.status(404).json({ error: 'Record not found in vault.' });
});

// 3. Send Branded Email to Artist from ocr.agreements@gmail.com
app.post('/api/send-artist-email', async (req, res) => {
  const { state, recipientEmail, signingUrl } = req.body;

  if (!state || !recipientEmail) {
    return res.status(400).json({ error: 'Missing agreement state or recipient email.' });
  }

  // Ensure clean agreement state for artist: clear any prior artist signature and unlock
  const cleanState = JSON.parse(JSON.stringify(state));
  if (cleanState.artist) {
    cleanState.artist.signature = null;
    cleanState.artist.date = new Date().toISOString().split('T')[0];
  }
  cleanState.isLockedForArtist = false;
  cleanState.status = 'awaiting_artist_signature';

  // Persist clean agreement on server
  const file = path.join(AGREEMENTS_DIR, `${cleanState.id}.json`);
  fs.writeFileSync(file, JSON.stringify(cleanState, null, 2), 'utf8');

  const transporter = getTransporter();
  if (!transporter) {
    return res.status(400).json({
      error: 'Gmail App Password not configured. Please configure your 16-character Gmail App Password for ocr.agreements@gmail.com in the settings box.'
    });
  }

  const artistName = state.artist.stageName || state.artist.legalName || 'Artist';
  const labelRep = state.label.representative || 'Director / Founder';
  
  // Format HTML tracks list
  const tracksHtml = state.tracks.map((t, idx) => `
    <tr>
      <td style="padding: 10px 12px; border-bottom: 1px solid #222738; color: #ffffff; font-weight: 600; font-size: 13px;">
        ${idx + 1}. ${t.title || '[Track Name]'} ${t.versionTag || ''} (${t.year || '2026'})
      </td>
      <td style="padding: 10px 12px; border-bottom: 1px solid #222738; color: #c9a050; font-weight: 700; text-align: right; font-size: 13px;">
        ${t.royaltyShare || 50}% Net Royalty
      </td>
    </tr>
  `).join('');

  // Luxury HTML Email Template
  const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Obscura Rec LLC - Agreement Ready for Signature</title>
</head>
<body style="margin: 0; padding: 0; background-color: #07090e; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; -webkit-font-smoothing: antialiased;">
  <table width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: #07090e; padding: 30px 15px;">
    <tr>
      <td align="center">
        <!-- Main Card Wrapper -->
        <table width="100%" border="0" cellspacing="0" cellpadding="0" style="max-width: 600px; background-color: #0c0f17; border: 1px solid #c9a050; border-radius: 12px; overflow: hidden; box-shadow: 0 15px 40px rgba(0,0,0,0.8);">
          
          <!-- Black Header Banner -->
          <tr>
            <td style="background-color: #000000; padding: 26px 30px; border-bottom: 2px solid #c9a050;">
              <table width="100%" border="0" cellspacing="0" cellpadding="0">
                <tr>
                  <td>
                    <div style="font-size: 18px; font-weight: 900; letter-spacing: 2px; color: #ffffff; text-transform: uppercase;">
                      OBSCURA REC LLC
                    </div>
                    <div style="font-size: 11px; color: #9ca3af; letter-spacing: 0.8px; margin-top: 4px; text-transform: uppercase;">
                      Act of Acceptance and Transfer of Objects
                    </div>
                  </td>
                  <td align="right">
                    <span style="background: #151822; color: #c9a050; border: 1px solid #c9a050; padding: 4px 10px; border-radius: 20px; font-size: 11px; font-weight: 700; letter-spacing: 0.5px;">
                      Ref: ${state.id}
                    </span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Email Content Body -->
          <tr>
            <td style="padding: 32px 30px; color: #d1d5db; font-size: 14px; line-height: 1.6;">
              <div style="font-size: 16px; color: #ffffff; margin-bottom: 16px;">
                Dear <strong>${artistName}</strong>,
              </div>
              <p style="margin: 0 0 18px 0; color: #d1d5db; font-size: 14px;">
                Obscura Rec LLC has prepared the official <strong>Act of Acceptance and Transfer of Objects</strong> agreement for your upcoming music release.
              </p>
              <p style="margin: 0 0 20px 0; color: #9ca3af; font-size: 13px;">
                All terms have been prepared and locked by the record label. Please review the track allocation schedule below and apply your digital signature via the secure portal:
              </p>

              <!-- Track Allocation Schedule Table -->
              <table width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: #121622; border: 1px solid #232a3d; border-radius: 8px; margin-bottom: 24px;">
                <tr>
                  <td colspan="2" style="background-color: #181d2c; padding: 10px 12px; font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: 1px; color: #c9a050; border-bottom: 1px solid #232a3d;">
                    DELIVERED SOUND RECORDINGS & ROYALTY SPLIT
                  </td>
                </tr>
                ${tracksHtml}
                <tr>
                  <td colspan="2" style="padding: 10px 12px; font-size: 12px; color: #9ca3af; background-color: #0e121c;">
                    • Term of Exclusive License: <strong style="color: #ffffff;">${state.terms?.termYears || 10} Years</strong> (30-day notice prior to renewal)
                  </td>
                </tr>
              </table>

              <!-- Big Gold Call to Action Button -->
              <table width="100%" border="0" cellspacing="0" cellpadding="0" style="margin: 28px 0 24px 0;">
                <tr>
                  <td align="center">
                    <a href="${signingUrl}" target="_blank" style="display: inline-block; background: #c9a050; background: linear-gradient(135deg, #dfb461 0%, #b38b38 100%); color: #000000; font-weight: 800; font-size: 15px; letter-spacing: 0.5px; text-decoration: none; padding: 14px 34px; border-radius: 30px; box-shadow: 0 6px 20px rgba(201,160,80,0.35);">
                      ✍️ Review & Sign Agreement
                    </a>
                  </td>
                </tr>
              </table>

              <!-- Plain Text Link Fallback -->
              <p style="font-size: 11.5px; color: #6b7280; text-align: center; margin: 0; line-height: 1.5; word-break: break-all;">
                If the button above does not open, copy and paste this link into your browser:<br>
                <a href="${signingUrl}" style="color: #60a5fa; text-decoration: underline;">${signingUrl}</a>
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background-color: #07090e; padding: 18px 30px; border-top: 1px solid #1a202c; color: #6b7280; font-size: 11.5px; line-height: 1.5;">
              <table width="100%" border="0" cellspacing="0" cellpadding="0">
                <tr>
                  <td>
                    Sent from <strong>Obscura Rec LLC Legal Department</strong><br>
                    Official Legal & Rights Management Portal
                  </td>
                  <td align="right" style="color: #4b5563;">
                    © 2026 Obscura Rec LLC<br>All rights reserved.
                  </td>
                </tr>
              </table>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `;

  try {
    const info = await transporter.sendMail({
      from: '"Obscura Rec LLC" <ocr.agreements@gmail.com>',
      to: recipientEmail,
      replyTo: 'ocr.agreements@gmail.com',
      subject: `[ACTION REQUIRED] Obscura Rec LLC: Agreement Ready for Signature (${artistName})`,
      html: htmlContent
    });

    console.log(`Email delivered to ${recipientEmail}, messageId: ${info.messageId}`);
    res.json({ success: true, messageId: info.messageId });
  } catch (err) {
    console.error('Nodemailer error:', err);
    res.status(500).json({ error: `Failed to dispatch email via Gmail: ${err.message}` });
  }
});

// 4. Artist Submits Signed Agreement -> Delivered directly to ocr.agreements@gmail.com
app.post('/api/submit-signed-agreement', async (req, res) => {
  const { state, hostUrl } = req.body;

  if (!state || !state.id) {
    return res.status(400).json({ error: 'Missing agreement state.' });
  }

  const file = path.join(AGREEMENTS_DIR, `${state.id}.json`);

  // Check if agreement is already locked/expired
  if (fs.existsSync(file)) {
    try {
      const existing = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (existing && existing.isLockedForArtist) {
        return res.status(403).json({
          error: 'This signing link has expired. The agreement has already been digitally executed and sealed. No further changes can be submitted.',
          isLocked: true
        });
      }
    } catch (e) {
      console.warn('Error reading existing contract during submit check:', e);
    }
  }

  // Stamp contract as locked and executed
  state.isLockedForArtist = true;
  state.artistSignedAt = new Date().toISOString();
  state.status = 'artist_signed';

  // Save locked contract on server
  fs.writeFileSync(file, JSON.stringify(state, null, 2), 'utf8');

  const transporter = getTransporter();
  const artistName = state.artist.stageName || state.artist.legalName || 'Artist';
  const counterSignUrl = `${hostUrl || 'http://localhost:3000'}/?mode=counter-sign&id=${state.id}`;

  if (transporter) {
    const notifyHtml = `
      <div style="font-family: sans-serif; background: #0c0f17; color: #ffffff; padding: 24px; border-radius: 10px; border: 1px solid #10b981;">
        <div style="font-size: 20px; font-weight: bold; color: #10b981; margin-bottom: 8px;">
          ✓ Agreement Digitally Signed by ${artistName}
        </div>
        <p style="color: #d1d5db; font-size: 14px;">
          The artist has reviewed and applied their digital signature to the Act of Acceptance and Transfer of Objects (Ref: <strong>${state.id}</strong>).
        </p>
        <div style="background: #131722; padding: 14px; border-radius: 8px; margin: 16px 0; border: 1px solid #252c3d;">
          <div style="color: #9ca3af; font-size: 12px; margin-bottom: 4px;">SIGNATURE VERIFICATION:</div>
          <div style="color: #ffffff; font-size: 13px;"><strong>Signer:</strong> ${state.artist.legalName || artistName} (${artistName})</div>
          <div style="color: #ffffff; font-size: 13px;"><strong>Timestamp:</strong> ${state.artist.signature?.timestamp || new Date().toISOString()}</div>
          <div style="color: #ffffff; font-size: 13px;"><strong>Hash:</strong> ${state.artist.signature?.hash || 'Verified'}</div>
          <div style="color: #10b981; font-size: 12px; margin-top: 4px;">🔒 Status: Sealed & Link Expired for Artist</div>
        </div>
        <div style="margin: 20px 0;">
          <a href="${counterSignUrl}" target="_blank" style="background: #c9a050; color: #000000; font-weight: bold; text-decoration: none; padding: 12px 24px; border-radius: 6px; display: inline-block;">
            ⚖️ Open Agreement & Counter-Sign
          </a>
        </div>
        <div style="font-size: 11px; color: #6b7280;">
          Ref ID: ${state.id} • Delivered to ocr.agreements@gmail.com
        </div>
      </div>
    `;

    try {
      await transporter.sendMail({
        from: '"Obscura Rec Agreements Portal" <ocr.agreements@gmail.com>',
        to: 'ocr.agreements@gmail.com',
        subject: `[SIGNED BY ARTIST] Obscura Rec LLC Agreement - ${artistName} (Ref: ${state.id})`,
        html: notifyHtml
      });
      console.log(`Signed notification sent to ocr.agreements@gmail.com for agreement ${state.id}`);
    } catch (e) {
      console.error('Failed to notify ocr.agreements@gmail.com:', e);
    }
  }

  res.json({ success: true, id: state.id, counterSignUrl, isLocked: true });
});

// Serve static frontend files
app.use(express.static(__dirname));

// Fallback to index.html for client routing
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Start listening
app.listen(PORT, () => {
  console.log(`\n======================================================`);
  console.log(`  OBSCURA REC LLC - AGREEMENT CREATOR & SIGNING SERVER`);
  console.log(`  Running at: http://localhost:${PORT}`);
  console.log(`  Official Label Email: ocr.agreements@gmail.com`);
  console.log(`======================================================\n`);
});
