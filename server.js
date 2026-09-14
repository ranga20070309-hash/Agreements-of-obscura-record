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

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

const IS_VERCEL = Boolean(process.env.VERCEL);
const DATA_DIR = IS_VERCEL ? path.join('/tmp', 'data') : path.join(__dirname, 'data');
const BUNDLE_DATA_DIR = path.join(__dirname, 'data');
const AGREEMENTS_DIR = path.join(DATA_DIR, 'agreements');
const VAULT_DIR = path.join(DATA_DIR, 'vault');
const CONFIG_FILE = path.join(DATA_DIR, 'mail-config.json');

const FIREBASE_RTDB_URL = 'https://ocr-llc-song-agreements-default-rtdb.asia-southeast1.firebasedatabase.app';

async function firebaseGet(resourcePath) {
  try {
    const res = await fetch(`${FIREBASE_RTDB_URL}/${resourcePath}.json`);
    if (res.ok) {
      return await res.json();
    }
  } catch (e) {
    console.warn(`[Firebase REST] GET ${resourcePath} note:`, e.message);
  }
  return null;
}

async function firebaseSet(resourcePath, data) {
  try {
    const res = await fetch(`${FIREBASE_RTDB_URL}/${resourcePath}.json`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    return res.ok;
  } catch (e) {
    console.warn(`[Firebase REST] PUT ${resourcePath} note:`, e.message);
    return false;
  }
}

async function firebaseDelete(resourcePath) {
  try {
    const res = await fetch(`${FIREBASE_RTDB_URL}/${resourcePath}.json`, {
      method: 'DELETE'
    });
    return res.ok;
  } catch (e) {
    console.warn(`[Firebase REST] DELETE ${resourcePath} note:`, e.message);
    return false;
  }
}

try {
  fs.mkdirSync(AGREEMENTS_DIR, { recursive: true });
  fs.mkdirSync(VAULT_DIR, { recursive: true });
} catch (e) {
  console.warn('Directory init note:', e.message);
}

// Read or initialize mail config
function getMailConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    }
    const bundleConfigFile = path.join(BUNDLE_DATA_DIR, 'mail-config.json');
    if (fs.existsSync(bundleConfigFile)) {
      return JSON.parse(fs.readFileSync(bundleConfigFile, 'utf8'));
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
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2), 'utf8');
  } catch (e) {
    console.error('Error saving mail config:', e);
  }
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
app.get('/api/agreements/:id', async (req, res) => {
  const id = req.params.id;

  // 1. Try Firebase Realtime Database first
  try {
    const fbAgreement = await firebaseGet(`agreements/${id}`);
    if (fbAgreement && fbAgreement.id) {
      return res.json(fbAgreement);
    }
    const fbVault = await firebaseGet(`vault/${id}`);
    if (fbVault && fbVault.id) {
      return res.json({ ...fbVault, isArchivedInVault: true, isLockedForArtist: Boolean(fbVault.status === 'fully_executed') });
    }
  } catch (e) {}

  // 2. Fallback to local filesystem
  const tempFile = path.join(AGREEMENTS_DIR, `${id}.json`);
  const bundleTempFile = path.join(BUNDLE_DATA_DIR, 'agreements', `${id}.json`);
  const targetTemp = fs.existsSync(tempFile) ? tempFile : (fs.existsSync(bundleTempFile) ? bundleTempFile : null);

  if (targetTemp) {
    try {
      const data = JSON.parse(fs.readFileSync(targetTemp, 'utf8'));
      return res.json(data);
    } catch (e) {
      return res.status(500).json({ error: 'Failed to read contract data.' });
    }
  }

  // Also check if already archived in Vault
  const vaultFile = path.join(VAULT_DIR, `${id}.json`);
  const bundleVaultFile = path.join(BUNDLE_DATA_DIR, 'vault', `${id}.json`);
  const targetVault = fs.existsSync(vaultFile) ? vaultFile : (fs.existsSync(bundleVaultFile) ? bundleVaultFile : null);

  if (targetVault) {
    try {
      const data = JSON.parse(fs.readFileSync(targetVault, 'utf8'));
      return res.json({ ...data, isArchivedInVault: true, isLockedForArtist: Boolean(data.status === 'fully_executed') });
    } catch (e) {
      return res.status(500).json({ error: 'Failed to read vault data.' });
    }
  }

  res.status(404).json({ error: 'Agreement not found.' });
});

app.post('/api/agreements', async (req, res) => {
  const state = req.body;
  if (!state || !state.id) {
    return res.status(400).json({ error: 'Invalid agreement data (missing id).' });
  }

  // 1. Sync to Firebase Realtime Database
  await firebaseSet(`agreements/${state.id}`, state);

  // 2. Local fallback
  try {
    fs.mkdirSync(AGREEMENTS_DIR, { recursive: true });
  } catch (e) {}
  const file = path.join(AGREEMENTS_DIR, `${state.id}.json`);
  fs.writeFileSync(file, JSON.stringify(state, null, 2), 'utf8');

  // 3. Auto-sync into Vault if this agreement is archived in Vault
  try {
    const vaultFile = path.join(VAULT_DIR, `${state.id}.json`);
    const inVault = state.isArchivedInVault || (await firebaseGet(`vault/${state.id}`)) || fs.existsSync(vaultFile);
    if (inVault) {
      await firebaseSet(`vault/${state.id}`, state);
      try {
        fs.mkdirSync(VAULT_DIR, { recursive: true });
        fs.writeFileSync(vaultFile, JSON.stringify(state, null, 2), 'utf8');
      } catch (e) {}
      console.log(`[Auto-Sync] Synced agreement ${state.id} with latest signatures to Vault`);
    }
  } catch (e) {}

  res.json({ success: true, id: state.id });
});

// ----------------- AGREEMENT VAULT & LIFECYCLE -----------------

// Finalize contract: Save into permanent Vault and PURGE temporary link file
app.post('/api/finalize-to-vault', async (req, res) => {
  const state = req.body;
  if (!state || !state.id) {
    return res.status(400).json({ error: 'Missing agreement state.' });
  }

  state.finalizedAt = new Date().toISOString();
  state.isArchivedInVault = true;
  state.isLockedForArtist = true;
  state.status = 'fully_executed';

  // 1. Sync to Firebase Realtime Database Vault and purge from active queue
  await firebaseSet(`vault/${state.id}`, state);

  // 1b. Write lightweight metadata to vault_meta to optimize Firebase bandwidth
  const metaRecord = {
    id: state.id,
    finalizedAt: state.finalizedAt,
    artistLegalName: state.artist?.legalName || '',
    artistStageName: state.artist?.stageName || '',
    artistEmail: state.artist?.email || '',
    labelRepresentative: state.label?.representative || '',
    labelTitle: state.label?.representativeTitle || 'Director / Founder',
    trackCount: Array.isArray(state.tracks) ? state.tracks.length : 0,
    firstTrackTitle: state.tracks?.[0]?.title || '',
    tracksList: Array.isArray(state.tracks) ? state.tracks.map(t => t.title).filter(Boolean) : [],
    hasArtistSignature: Boolean(state.artist?.signature),
    hasLabelSignature: Boolean(state.label?.signature),
    artistSigHash: state.artist?.signature?.hash || 'Verified',
    artistSigTimestamp: state.artist?.signature?.timestamp || '',
    labelSigTimestamp: state.label?.signature?.timestamp || '',
    labelSigHash: state.label?.signature?.hash || 'OBS-LABEL-SEALED',
    artists: Array.isArray(state.artists) ? state.artists.map(a => ({
      id: a.id,
      role: a.role || 'Recording Artist',
      legalName: a.legalName || '',
      stageName: a.stageName || '',
      email: a.email || '',
      hasSignature: Boolean(a.signature),
      sigHash: a.signature?.hash || 'Verified',
      sigTimestamp: a.signature?.timestamp || a.date || ''
    })) : []
  };
  await firebaseSet(`vault_meta/${state.id}`, metaRecord);
  await firebaseDelete(`agreements/${state.id}`);

  // 2. Local fallback
  try {
    fs.mkdirSync(VAULT_DIR, { recursive: true });
  } catch (e) {}

  const vaultFile = path.join(VAULT_DIR, `${state.id}.json`);
  fs.writeFileSync(vaultFile, JSON.stringify(state, null, 2), 'utf8');

  // Permanently delete temporary signing link file to save hosting storage quota
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

// Save agreement directly to Vault (without purging active signing link)
app.post('/api/vault/save', async (req, res) => {
  const state = req.body;
  if (!state || !state.id) {
    return res.status(400).json({ error: 'Missing agreement state.' });
  }

  state.savedToVaultAt = state.savedToVaultAt || new Date().toISOString();
  state.lastUpdatedInVaultAt = new Date().toISOString();
  state.isArchivedInVault = true;

  // 1. Sync to Firebase Vault and vault_meta
  await firebaseSet(`vault/${state.id}`, state);
  const metaRecord = {
    id: state.id,
    finalizedAt: state.savedToVaultAt,
    artistLegalName: state.artist?.legalName || '',
    artistStageName: state.artist?.stageName || '',
    artistEmail: state.artist?.email || '',
    labelRepresentative: state.label?.representative || '',
    labelTitle: state.label?.representativeTitle || 'Director / Founder',
    trackCount: Array.isArray(state.tracks) ? state.tracks.length : 0,
    firstTrackTitle: state.tracks?.[0]?.title || '',
    tracksList: Array.isArray(state.tracks) ? state.tracks.map(t => t.title).filter(Boolean) : [],
    hasArtistSignature: Boolean(state.artist?.signature),
    hasLabelSignature: Boolean(state.label?.signature),
    artistSigHash: state.artist?.signature?.hash || 'Verified',
    artistSigTimestamp: state.artist?.signature?.timestamp || '',
    labelSigTimestamp: state.label?.signature?.timestamp || '',
    labelSigHash: state.label?.signature?.hash || 'OBS-LABEL-SEALED',
    artists: Array.isArray(state.artists) ? state.artists.map(a => ({
      id: a.id,
      role: a.role || 'Recording Artist',
      legalName: a.legalName || '',
      stageName: a.stageName || '',
      email: a.email || '',
      hasSignature: Boolean(a.signature),
      sigHash: a.signature?.hash || 'Verified',
      sigTimestamp: a.signature?.timestamp || a.date || ''
    })) : []
  };
  await firebaseSet(`vault_meta/${state.id}`, metaRecord);

  // 2. Keep active agreements in sync so artists can still sign
  await firebaseSet(`agreements/${state.id}`, state);

  // 3. Local fallback
  try {
    fs.mkdirSync(VAULT_DIR, { recursive: true });
    fs.mkdirSync(AGREEMENTS_DIR, { recursive: true });
  } catch (e) {}

  const vaultFile = path.join(VAULT_DIR, `${state.id}.json`);
  fs.writeFileSync(vaultFile, JSON.stringify(state, null, 2), 'utf8');

  const activeFile = path.join(AGREEMENTS_DIR, `${state.id}.json`);
  fs.writeFileSync(activeFile, JSON.stringify(state, null, 2), 'utf8');

  console.log(`[Vault Saved] Agreement ${state.id} saved to permanent vault archive.`);
  res.json({ success: true, id: state.id, savedToVaultAt: state.savedToVaultAt });
});

// List all agreements in the Vault for search & management
app.get('/api/vault', async (req, res) => {
  try {
    // 1. Fetch from Firebase Realtime Database vault directly
    let fbVault = await firebaseGet('vault');

    if (fbVault && typeof fbVault === 'object') {
      const records = [];
      Object.keys(fbVault).forEach(key => {
        const c = fbVault[key];
        if (c && typeof c === 'object') {
          records.push({
            id: c.id || key,
            finalizedAt: c.finalizedAt || c.savedToVaultAt || c.createdAt || new Date().toISOString(),
            artistLegalName: c.artistLegalName || c.artist?.legalName || '',
            artistStageName: c.artistStageName || c.artist?.stageName || '',
            artistEmail: c.artistEmail || c.artist?.email || '',
            labelRepresentative: c.labelRepresentative || c.label?.representative || '',
            trackCount: typeof c.trackCount === 'number' ? c.trackCount : (Array.isArray(c.tracks) ? c.tracks.length : 0),
            firstTrackTitle: c.firstTrackTitle || c.tracks?.[0]?.title || '',
            tracksList: Array.isArray(c.tracksList) ? c.tracksList : (Array.isArray(c.tracks) ? c.tracks.map(t => t.title).filter(Boolean) : []),
            hasArtistSignature: Boolean(c.hasArtistSignature !== undefined ? c.hasArtistSignature : c.artist?.signature),
            hasLabelSignature: Boolean(c.hasLabelSignature !== undefined ? c.hasLabelSignature : c.label?.signature),
            artistSigHash: c.artistSigHash || c.artist?.signature?.hash || 'Verified',
            artistSigTimestamp: c.artistSigTimestamp || c.artist?.signature?.timestamp || '',
            labelSigTimestamp: c.labelSigTimestamp || c.label?.signature?.timestamp || '',
            artists: Array.isArray(c.artists) ? c.artists.map(a => ({
              id: a.id,
              role: a.role || 'Recording Artist',
              legalName: a.legalName || '',
              stageName: a.stageName || '',
              email: a.email || '',
              hasSignature: Boolean(a.signature),
              sigHash: a.signature?.hash || 'Verified',
              sigTimestamp: a.signature?.timestamp || a.date || ''
            })) : []
          });
        }
      });
      records.sort((a, b) => new Date(b.finalizedAt || 0) - new Date(a.finalizedAt || 0));
      return res.json({ success: true, records, count: records.length });
    }
  } catch (e) {
    console.warn('Firebase vault fetch note:', e.message);
  }

  try {
    const fileSet = new Set();
    if (fs.existsSync(VAULT_DIR)) {
      try {
        fs.readdirSync(VAULT_DIR).filter(f => f.endsWith('.json')).forEach(f => fileSet.add(f));
      } catch (e) {}
    }
    const bundleVault = path.join(BUNDLE_DATA_DIR, 'vault');
    if (fs.existsSync(bundleVault)) {
      try {
        fs.readdirSync(bundleVault).filter(f => f.endsWith('.json')).forEach(f => fileSet.add(f));
      } catch (e) {}
    }

    const records = [];
    for (const f of fileSet) {
      try {
        const filePath = fs.existsSync(path.join(VAULT_DIR, f)) ? path.join(VAULT_DIR, f) : path.join(bundleVault, f);
        const c = JSON.parse(fs.readFileSync(filePath, 'utf8'));
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
app.get('/api/vault/:id', async (req, res) => {
  const id = req.params.id;

  // 1. Check Firebase Realtime Database Vault
  try {
    const fbRecord = await firebaseGet(`vault/${id}`);
    if (fbRecord && fbRecord.id) {
      return res.json(fbRecord);
    }
  } catch (e) {}

  // 1b. Check Firebase Realtime Database Agreements queue
  try {
    const fbAgr = await firebaseGet(`agreements/${id}`);
    if (fbAgr && fbAgr.id) {
      return res.json(fbAgr);
    }
  } catch (e) {}

  const file = path.join(VAULT_DIR, `${id}.json`);
  const bundleVaultFile = path.join(BUNDLE_DATA_DIR, 'vault', `${id}.json`);
  const activeFile = path.join(AGREEMENTS_DIR, `${id}.json`);
  const bundleActiveFile = path.join(BUNDLE_DATA_DIR, 'agreements', `${id}.json`);

  const targetFile = fs.existsSync(file) ? file 
    : (fs.existsSync(bundleVaultFile) ? bundleVaultFile 
    : (fs.existsSync(activeFile) ? activeFile 
    : (fs.existsSync(bundleActiveFile) ? bundleActiveFile : null)));

  if (targetFile) {
    try {
      const data = JSON.parse(fs.readFileSync(targetFile, 'utf8'));
      return res.json(data);
    } catch (e) {
      return res.status(500).json({ error: 'Failed to read agreement file.' });
    }
  }
  res.status(404).json({ error: 'Record not found in vault.' });
});

// Delete agreement from Vault (Storage management)
app.delete('/api/vault/:id', async (req, res) => {
  const id = req.params.id;

  // 1. Delete from Firebase Realtime Database (both full vault and lightweight index)
  await firebaseDelete(`vault/${id}`);
  await firebaseDelete(`vault_meta/${id}`);

  const file = path.join(VAULT_DIR, `${id}.json`);
  if (fs.existsSync(file)) {
    try {
      fs.unlinkSync(file);
      return res.json({ success: true, message: `Agreement ${req.params.id} permanently deleted from vault.` });
    } catch (e) {
      return res.status(500).json({ error: 'Failed to delete file: ' + e.message });
    }
  }
  res.json({ success: true, message: `Agreement ${id} permanently deleted from vault.` });
});

const emailRateLimits = new Map();

// 3. Send Branded Email to Artist from ocr.agreements@gmail.com
app.post('/api/send-artist-email', async (req, res) => {
  const { state, recipientEmail, signingUrl, artistName: clientArtistName, signerId } = req.body;

  if (!state || !recipientEmail) {
    return res.status(400).json({ error: 'Missing agreement state or recipient email.' });
  }

  // Rate-limiting / Cooldown (30s window per recipient + agreement to prevent spam)
  const rateKey = `${recipientEmail.toLowerCase().trim()}_${state.id}`;
  const now = Date.now();
  const lastSent = emailRateLimits.get(rateKey);
  if (lastSent && (now - lastSent) < 30000) {
    const waitSec = Math.ceil((30000 - (now - lastSent)) / 1000);
    return res.status(429).json({
      error: `Cooldown active: An invitation was recently sent to ${recipientEmail}. Please wait ${waitSec}s to prevent spamming.`
    });
  }

  // Persist current agreement state on server and Firebase without wiping existing signatures
  await firebaseSet(`agreements/${state.id}`, state);
  try {
    fs.mkdirSync(AGREEMENTS_DIR, { recursive: true });
  } catch (e) {}
  const file = path.join(AGREEMENTS_DIR, `${state.id}.json`);
  fs.writeFileSync(file, JSON.stringify(state, null, 2), 'utf8');

  const transporter = getTransporter();
  if (!transporter) {
    return res.status(400).json({
      error: 'Gmail App Password not configured. Please configure your 16-character Gmail App Password for ocr.agreements@gmail.com in the settings box.'
    });
  }

  const artistsList = (Array.isArray(state.artists) && state.artists.length > 0)
    ? state.artists
    : (state.artist ? [state.artist] : []);

  // 1. Identify recipient artist
  let recipientArtist = null;
  if (signerId) {
    recipientArtist = artistsList.find(a => a.id === signerId);
  }
  if (!recipientArtist && recipientEmail) {
    recipientArtist = artistsList.find(a => a.email && a.email.toLowerCase().trim() === recipientEmail.toLowerCase().trim());
  }
  if (!recipientArtist && (!signerId || signerId === 'art-1')) {
    recipientArtist = artistsList[0] || state.artist;
  }

  // Resolve recipient's display greeting name without falling back to Artist 1's details
  let recipientGreetingName = '';
  if (recipientArtist) {
    const hasLegal = Boolean(recipientArtist.legalName && recipientArtist.legalName.trim());
    const hasStage = Boolean(recipientArtist.stageName && recipientArtist.stageName.trim());
    if (hasLegal && hasStage) {
      recipientGreetingName = `${recipientArtist.legalName.trim()} (${recipientArtist.stageName.trim()})`;
    } else if (hasStage) {
      recipientGreetingName = recipientArtist.stageName.trim();
    } else if (hasLegal) {
      recipientGreetingName = recipientArtist.legalName.trim();
    } else {
      // Empty collaborator fields: NEVER substitute Artist 1!
      const artIdx = artistsList.findIndex(a => a.id === recipientArtist.id);
      recipientGreetingName = artIdx > 0 ? `Artist ${artIdx + 1}` : (recipientArtist.role || 'Artist / Collaborator');
    }
  } else {
    recipientGreetingName = clientArtistName || 'Artist / Collaborator';
  }

  // 2. Track / Song Name
  const songTitle = (state.tracks && state.tracks[0]?.title && state.tracks[0].title.trim())
    ? state.tracks[0].title.trim()
    : 'Music Release';

  const trackCount = Array.isArray(state.tracks) ? state.tracks.length : 1;
  const trackDisplay = trackCount > 1 ? `${songTitle} (${trackCount} Versions)` : songTitle;

  // Luxury Compact HTML Email Template
  const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; background-color: #080a0f; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
  <table width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: #080a0f; padding: 32px 16px;">
    <tr>
      <td align="center">
        <!-- Main Card Wrapper -->
        <table width="100%" border="0" cellspacing="0" cellpadding="0" style="max-width: 580px; background-color: #0e111a; border: 1px solid #252b3d; border-radius: 12px; overflow: hidden; box-shadow: 0 10px 30px rgba(0,0,0,0.5);">
          
          <!-- Header Banner -->
          <tr>
            <td style="background-color: #07090e; padding: 20px 26px; border-bottom: 2px solid #c9a050;">
              <table width="100%" border="0" cellspacing="0" cellpadding="0">
                <tr>
                  <td>
                    <div style="font-size: 18px; font-weight: 800; letter-spacing: 1.5px; color: #ffffff;">
                      OBSCURA REC LLC
                    </div>
                    <div style="font-size: 11px; color: #c9a050; letter-spacing: 0.8px; text-transform: uppercase; margin-top: 3px;">
                      Act of Acceptance and Transfer of Objects
                    </div>
                  </td>
                  <td align="right">
                    <span style="display: inline-block; background: #141824; color: #c9a050; border: 1px solid #c9a050; padding: 4px 10px; border-radius: 16px; font-size: 10.5px; font-weight: 700;">
                      ocr.agreements@gmail.com
                    </span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Email Content Body -->
          <tr>
            <td style="padding: 26px 26px 22px 26px; color: #d1d5db; font-size: 14px; line-height: 1.6;">
              <div style="font-size: 16px; color: #ffffff; margin-bottom: 12px;">
                Dear <strong>${escapeHtml(recipientGreetingName)}</strong>,
              </div>
              <p style="margin: 0 0 16px 0; color: #d1d5db; font-size: 13.5px;">
                Obscura Rec LLC has prepared your official music release agreement for digital signature. All terms are prepared and locked for your review:
              </p>

              <!-- Compact Agreement Details Box -->
              <table width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: #121622; border: 1px solid #232a3d; border-radius: 10px; overflow: hidden; margin: 18px 0 22px 0;">
                <tr>
                  <td style="background-color: #181d2c; padding: 10px 14px; border-bottom: 1px solid #232a3d; font-size: 10.5px; font-weight: 800; color: #c9a050; letter-spacing: 1px; text-transform: uppercase;">
                    AGREEMENT OVERVIEW
                  </td>
                </tr>
                <tr>
                  <td style="padding: 12px 14px;">
                    <table width="100%" border="0" cellspacing="0" cellpadding="0">
                      <tr>
                        <td style="padding: 6px 0; font-size: 12px; color: #9ca3af; width: 36%;">🎵 Track / Release:</td>
                        <td style="padding: 6px 0; font-size: 13px; color: #ffffff; font-weight: 700;">${escapeHtml(trackDisplay)}</td>
                      </tr>
                      <tr>
                        <td style="padding: 6px 0; font-size: 12px; color: #9ca3af; border-top: 1px solid #1a202e;">👤 Artist / Signer:</td>
                        <td style="padding: 6px 0; font-size: 13px; color: #ffffff; font-weight: 600; border-top: 1px solid #1a202e;">${escapeHtml(recipientGreetingName)}</td>
                      </tr>
                      <tr>
                        <td style="padding: 6px 0; font-size: 12px; color: #9ca3af; border-top: 1px solid #1a202e;">🏛️ Record Label:</td>
                        <td style="padding: 6px 0; font-size: 13px; color: #ffffff; font-weight: 600; border-top: 1px solid #1a202e;">Obscura Rec LLC</td>
                      </tr>
                      <tr>
                        <td style="padding: 6px 0; font-size: 12px; color: #9ca3af; border-top: 1px solid #1a202e;">🔑 Reference ID:</td>
                        <td style="padding: 6px 0; font-size: 13px; color: #c9a050; font-family: monospace; font-weight: 700; border-top: 1px solid #1a202e;">${escapeHtml(state.id)}</td>
                      </tr>
                      <tr>
                        <td style="padding: 6px 0; font-size: 12px; color: #9ca3af; border-top: 1px solid #1a202e;">✍️ Action Required:</td>
                        <td style="padding: 6px 0; font-size: 12px; border-top: 1px solid #1a202e;">
                          <span style="display: inline-block; background: rgba(245, 158, 11, 0.15); color: #f59e0b; border: 1px solid rgba(245, 158, 11, 0.35); padding: 3px 8px; border-radius: 4px; font-weight: 700;">
                            Digital Signature Required
                          </span>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>

              <!-- Big Gold Call to Action Button -->
              <table width="100%" border="0" cellspacing="0" cellpadding="0" style="margin: 22px 0 18px 0;">
                <tr>
                  <td align="center">
                    <a href="${signingUrl}" target="_blank" style="display: inline-block; background: #c9a050; background: linear-gradient(135deg, #dfb461 0%, #b38b38 100%); color: #000000; font-weight: 800; font-size: 14.5px; letter-spacing: 0.5px; text-decoration: none; padding: 13px 32px; border-radius: 30px; box-shadow: 0 4px 18px rgba(201,160,80,0.35);">
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
            <td style="background-color: #07090e; padding: 16px 26px; border-top: 1px solid #1a202c; color: #6b7280; font-size: 11px; line-height: 1.5;">
              <table width="100%" border="0" cellspacing="0" cellpadding="0">
                <tr>
                  <td>
                    Sent from <strong>Obscura Rec LLC Legal Department</strong><br>
                    Official Portal • Ref ID: <strong>${state.id}</strong>
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
      from: '"Obscura Rec Agreements" <ocr.agreements@gmail.com>',
      to: recipientEmail,
      replyTo: 'ocr.agreements@gmail.com',
      subject: `[ACTION REQUIRED] Obscura Rec Agreements: Ready for Signature - "${songTitle}" (${recipientGreetingName}) [Ref: ${state.id}]`,
      html: htmlContent
    });

    // Record rate limit timestamp
    emailRateLimits.set(rateKey, Date.now());
    console.log(`Email delivered to ${recipientEmail}, messageId: ${info.messageId}`);
    res.json({ success: true, messageId: info.messageId, cooldownSeconds: 60 });
  } catch (err) {
    console.error('Nodemailer error:', err);
    res.status(500).json({ error: `Failed to dispatch email via Gmail: ${err.message}` });
  }
});

// 4. Artist Submits Signed Agreement -> Delivered directly to ocr.agreements@gmail.com
app.post('/api/submit-signed-agreement', async (req, res) => {
  const { state, hostUrl, signerId } = req.body;

  if (!state || !state.id) {
    return res.status(400).json({ error: 'Missing agreement state.' });
  }

  const file = path.join(AGREEMENTS_DIR, `${state.id}.json`);

  // Check if agreement is already fully executed and closed
  if (fs.existsSync(file)) {
    try {
      const existing = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (existing) {
        if (existing.status === 'fully_executed') {
          return res.status(403).json({
            error: 'This agreement has already been fully executed and closed by Obscura Rec LLC.',
            isLocked: true
          });
        }
      }
    } catch (e) {
      console.warn('Error reading existing contract during submit check:', e);
    }
  }

  // Stamp contract status
  const allArtists = Array.isArray(state.artists) && state.artists.length > 0 ? state.artists : [state.artist];
  const allDone = allArtists.every(a => a && (a.submitted === true || (a.status === 'signed' && a.signedAt)));
  state.isLockedForArtist = allDone;
  state.artistSignedAt = new Date().toISOString();
  state.status = allDone ? 'all_artists_signed' : 'partially_signed';

  // Save locked contract on server and Firebase Realtime Database
  await firebaseSet(`agreements/${state.id}`, state);
  try {
    fs.mkdirSync(AGREEMENTS_DIR, { recursive: true });
  } catch (e) {}
  fs.writeFileSync(file, JSON.stringify(state, null, 2), 'utf8');

  // Keep Vault 100% up to date with the latest signatures if this agreement was saved in the Vault
  const vaultFile = path.join(VAULT_DIR, `${state.id}.json`);
  const existingInVault = await firebaseGet(`vault/${state.id}`);
  if (existingInVault || fs.existsSync(vaultFile) || state.isArchivedInVault) {
    try {
      fs.mkdirSync(VAULT_DIR, { recursive: true });
      fs.writeFileSync(vaultFile, JSON.stringify(state, null, 2), 'utf8');
      await firebaseSet(`vault/${state.id}`, state);
      console.log(`[Vault Auto-Synced] Updated vault record with latest signatures for ${state.id}`);
    } catch (ve) {
      console.warn('Vault auto-sync error on submit:', ve);
    }
  }

  const transporter = getTransporter();
  let submittingArtist = null;
  if (signerId) {
    submittingArtist = allArtists.find(a => a.id === signerId);
  }
  if (!submittingArtist) {
    submittingArtist = allArtists.find(a => a.submitted || (a.status === 'signed' && a.signedAt)) || allArtists[0];
  }

  // Resolve artist name cleanly without defaulting to generic role string
  let artistName = '';
  if (submittingArtist) {
    const hasLegal = Boolean(submittingArtist.legalName && submittingArtist.legalName.trim());
    const hasStage = Boolean(submittingArtist.stageName && submittingArtist.stageName.trim());
    if (hasStage && hasLegal) {
      artistName = `${submittingArtist.stageName.trim()} (${submittingArtist.legalName.trim()})`;
    } else if (hasStage) {
      artistName = submittingArtist.stageName.trim();
    } else if (hasLegal) {
      artistName = submittingArtist.legalName.trim();
    } else {
      const artIdx = allArtists.findIndex(a => a.id === submittingArtist.id);
      artistName = artIdx > 0 ? `Artist ${artIdx + 1}` : 'Primary Artist';
    }
  } else {
    artistName = 'Artist';
  }

  const songTitle = (state.tracks && state.tracks[0]?.title && state.tracks[0].title.trim())
    ? state.tracks[0].title.trim()
    : 'Music Release';

  const artistSigHash = submittingArtist?.signature?.hash || state.artist?.signature?.hash || 'Verified';
  const artistSigTimestamp = submittingArtist?.signature?.timestamp || submittingArtist?.signedAt || new Date().toISOString();

  const counterSignUrl = `${hostUrl || 'http://localhost:3000'}/?mode=counter-sign&id=${state.id}`;

  if (transporter) {
    const notifyHtml = `
      <div style="font-family: sans-serif; background: #0c0f17; color: #ffffff; padding: 24px; border-radius: 10px; border: 1px solid #10b981;">
        <div style="font-size: 20px; font-weight: bold; color: #10b981; margin-bottom: 8px;">
          ✓ Agreement Digitally Signed by ${escapeHtml(artistName)}
        </div>
        <p style="color: #d1d5db; font-size: 14px;">
          The artist has reviewed and applied their digital signature to the Act of Acceptance and Transfer of Objects for <strong>"${escapeHtml(songTitle)}"</strong> (Ref: <strong>${state.id}</strong>).
        </p>
        <div style="background: #131722; padding: 14px; border-radius: 8px; margin: 16px 0; border: 1px solid #252c3d;">
          <div style="color: #9ca3af; font-size: 12px; margin-bottom: 4px;">DIGITAL VERIFICATION RECORD:</div>
          <div style="color: #ffffff; font-size: 13px;"><strong>Agreement Ref ID:</strong> ${state.id}</div>
          <div style="color: #ffffff; font-size: 13px;"><strong>Track / Release:</strong> "${escapeHtml(songTitle)}"</div>
          <div style="color: #ffffff; font-size: 13px;"><strong>Signer:</strong> ${escapeHtml(artistName)}</div>
          <div style="color: #ffffff; font-size: 13px;"><strong>Timestamp:</strong> ${escapeHtml(artistSigTimestamp)}</div>
          <div style="color: #ffffff; font-size: 13px;"><strong>Digital Seal Hash:</strong> ${escapeHtml(artistSigHash)}</div>
          <div style="color: #10b981; font-size: 12px; margin-top: 4px;">🔒 Status: Sealed & Link Expired for Artist</div>
        </div>
        <div style="font-size: 11px; color: #6b7280; margin-top: 14px;">
          Agreement Reference ID: ${state.id} • Delivered to ocr.agreements@gmail.com
        </div>
      </div>
    `;

    try {
      await transporter.sendMail({
        from: '"Obscura Rec Agreements Portal" <ocr.agreements@gmail.com>',
        to: 'ocr.agreements@gmail.com',
        subject: `[SIGNED BY ARTIST] Obscura Rec LLC Agreement - "${songTitle}" (${artistName}) [Ref: ${state.id}]`,
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

// Start listening locally (when not running as a Vercel serverless function)
if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`\n======================================================`);
    console.log(`  OBSCURA REC LLC - AGREEMENT CREATOR & SIGNING SERVER`);
    console.log(`  Running at: http://localhost:${PORT}`);
    console.log(`  Official Label Email: ocr.agreements@gmail.com`);
    console.log(`======================================================\n`);
  });
}

export default app;
