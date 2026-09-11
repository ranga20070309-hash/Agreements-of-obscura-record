/**
 * Obscura Rec LLC - Automated In-Site Email Dispatcher
 * Directly sends emails from ocr.agreements@gmail.com without opening desktop mail apps.
 */

import { saveAgreementToFirebase } from './firebase-config.js';

export class EmailSender {
  constructor(agreementStore) {
    this.store = agreementStore;
    this.sendModal = document.getElementById('send-artist-modal');
    this.submitModal = document.getElementById('submit-artist-modal');
    this.hasServerPassword = false;
    this.init();
  }

  async init() {
    this.bindEvents();
    await this.checkMailConfig();
  }

  async checkMailConfig() {
    try {
      const res = await fetch('/api/mail-config');
      if (res.ok) {
        const data = await res.json();
        this.hasServerPassword = Boolean(data.hasPassword);
        this.updateConfigUi();
      }
    } catch (e) {
      console.warn('Could not check mail server config:', e);
    }
  }

  updateConfigUi() {
    const configBox = document.getElementById('gmail-config-box');
    const statusText = document.getElementById('gmail-status-indicator');
    if (!configBox || !statusText) return;

    if (this.hasServerPassword) {
      statusText.innerHTML = '<span style="color:#10b981;">🟢 Connected: ocr.agreements@gmail.com</span>';
      configBox.style.display = 'none';
    } else {
      statusText.innerHTML = '<span style="color:#f59e0b;">🟡 Password Required for ocr.agreements@gmail.com</span>';
      configBox.style.display = 'block';
    }
  }

  async saveAppPassword() {
    const input = document.getElementById('input-gmail-app-password');
    if (!input || !input.value.trim()) {
      alert('Please paste the 16-character Google App Password for ocr.agreements@gmail.com.');
      return;
    }

    try {
      const res = await fetch('/api/mail-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ appPassword: input.value.trim() })
      });
      const data = await res.json();
      if (data.success) {
        this.hasServerPassword = true;
        this.updateConfigUi();
        input.value = '';
        showToast('Gmail credentials connected successfully!', 'success');
      } else {
        alert(data.error || 'Failed to save App Password.');
      }
    } catch (e) {
      alert('Server communication error: ' + e.message);
    }
  }

  // ================= LABEL -> ARTIST: SEND INVITATION =================
  async openSendToArtistModal() {
    const state = this.store.getState();
    const artistName = state.artist.stageName || state.artist.legalName || 'Artist';
    const artistEmail = state.artist.email || '';
    
    // Clean signing URL: http://localhost:3000/?mode=artist-sign&id=OBS-AGR-XXXXXX
    const baseUrl = window.location.origin + window.location.pathname;
    const cleanSigningUrl = `${baseUrl}?mode=artist-sign&id=${state.id}`;

    // Fill modal fields
    const emailInput = document.getElementById('send-artist-email-input');
    if (emailInput) emailInput.value = artistEmail;

    const linkInput = document.getElementById('send-artist-url-display');
    if (linkInput) linkInput.value = cleanSigningUrl;

    // Render live branded email preview
    this.renderEmailPreview(state, cleanSigningUrl);

    // Refresh mail server status
    await this.checkMailConfig();

    this.sendModal?.classList.add('active');
  }

  closeSendToArtistModal() {
    this.sendModal?.classList.remove('active');
  }

  renderEmailPreview(state, signingUrl) {
    const container = document.getElementById('email-template-preview-box');
    if (!container) return;

    const artistName = state.artist.stageName || state.artist.legalName || 'Artist';
    const tracksList = state.tracks.map((t, idx) => `
      <div style="display:flex; justify-content:space-between; padding:6px 0; border-bottom:1px solid #1f2434; font-size:12px;">
        <span style="color:#ffffff; font-weight:600;">${idx + 1}. ${escapeHtml(t.title || '[Track Name]')} ${escapeHtml(t.versionTag || '')} (${escapeHtml(t.year || '2026')})</span>
        <span style="color:#c9a050; font-weight:700;">${t.royaltyShare || 50}% Net Royalty</span>
      </div>
    `).join('');

    container.innerHTML = `
      <div style="background:#090b10; border:1px solid #c9a050; border-radius:10px; overflow:hidden; font-family:'Inter',sans-serif; max-width:560px; margin:0 auto; box-shadow:0 12px 30px rgba(0,0,0,0.6);">
        <!-- Email Header Banner -->
        <div style="background:#000000; padding:18px 24px; border-bottom:2px solid #c9a050; display:flex; align-items:center; justify-content:space-between;">
          <div style="display:flex; align-items:center; gap:12px;">
            <img src="./assets/ocr-logo.jpeg" alt="CR" style="width:38px; height:38px; border-radius:50%; border:1px solid #c9a050;" />
            <div>
              <div style="font-size:15px; font-weight:900; letter-spacing:1.5px; color:#ffffff;">OBSCURA REC LLC</div>
              <div style="font-size:10.5px; color:#9ca3af;">ACT OF ACCEPTANCE AND TRANSFER OF OBJECTS</div>
            </div>
          </div>
          <span style="font-size:11px; color:#c9a050; background:#141722; padding:3px 8px; border-radius:12px; border:1px solid #c9a050;">
            ocr.agreements@gmail.com
          </span>
        </div>

        <!-- Email Body -->
        <div style="padding:22px; color:#d1d5db; line-height:1.6; font-size:13px;">
          <p style="margin:0 0 12px 0; font-size:14px; color:#ffffff;">
            Dear <strong>${escapeHtml(artistName)}</strong>,
          </p>
          <p style="margin:0 0 14px 0;">
            Obscura Rec LLC has prepared the official <strong>Act of Acceptance and Transfer of Objects</strong> agreement for your upcoming music release(s).
          </p>

          <!-- Tracks Schedule Box -->
          <div style="background:#11141e; border:1px solid #24293c; border-radius:8px; padding:12px; margin:14px 0;">
            <div style="font-size:10.5px; font-weight:800; text-transform:uppercase; letter-spacing:0.8px; color:#c9a050; margin-bottom:8px;">
              DELIVERED SOUND RECORDINGS & ROYALTY ALLOCATION
            </div>
            ${tracksList}
            <div style="margin-top:10px; font-size:11.5px; color:#9ca3af;">
              • License Term: <strong>${state.terms.termYears || 10} Years Exclusive</strong> (30-day renewal notice)
            </div>
          </div>

          <p style="margin:0 0 16px 0; font-size:12px; color:#9ca3af;">
            Please click the button below to review your contract and apply your digital signature. All terms are locked for your review.
          </p>

          <!-- Golden Call-to-Action Button -->
          <div style="text-align:center; margin:20px 0 14px;">
            <span style="display:inline-block; background:linear-gradient(135deg, #c9a050 0%, #b38b38 100%); color:#000000; font-weight:800; font-size:13.5px; letter-spacing:0.5px; text-decoration:none; padding:12px 28px; border-radius:30px; box-shadow:0 4px 15px rgba(201,160,80,0.35);">
              ✍️ Review & Sign Agreement
            </span>
          </div>

          <div style="font-size:11px; color:#6b7280; text-align:center; word-break:break-all;">
            Direct Link: <span style="color:#60a5fa;">${signingUrl}</span>
          </div>
        </div>

        <!-- Email Footer -->
        <div style="background:#07090e; padding:12px 24px; border-top:1px solid #1f2434; font-size:11px; color:#6b7280; display:flex; justify-content:space-between; align-items:center;">
          <span>Ref ID: ${escapeHtml(state.id)}</span>
          <span>From: ocr.agreements@gmail.com</span>
        </div>
      </div>
    `;
  }

  async sendDirectEmail() {
    const state = this.store.getState();
    const emailInput = document.getElementById('send-artist-email-input');
    const recipient = emailInput ? emailInput.value.trim() : '';

    if (!recipient || !recipient.includes('@')) {
      alert('Please enter a valid Artist email address.');
      return;
    }

    // Save recipient to state
    this.store.update('artist.email', recipient);

    // Clean signing link for the email
    const baseUrl = window.location.origin + window.location.pathname;
    const cleanSigningUrl = `${baseUrl}?mode=artist-sign&id=${state.id}`;

    // Prepare clean state without artist signature for sending to artist
    const cleanPayload = JSON.parse(JSON.stringify(state));
    if (cleanPayload.artist) {
      cleanPayload.artist.signature = null;
    }
    cleanPayload.isLockedForArtist = false;
    cleanPayload.status = 'awaiting_artist_signature';

    const sendBtn = document.getElementById('btn-send-direct-email');
    const originalBtnText = sendBtn ? sendBtn.innerHTML : '';
    if (sendBtn) {
      sendBtn.disabled = true;
      sendBtn.innerHTML = '⏳ Dispatching from ocr.agreements@gmail.com...';
    }

    try {
      // 1. Immediately persist clean agreement state to Firebase Realtime Database
      await saveAgreementToFirebase(cleanPayload);

      const res = await fetch('/api/send-artist-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          state: cleanPayload,
          recipientEmail: recipient,
          signingUrl: cleanSigningUrl
        })
      });

      const data = await res.json();

      if (res.ok && data.success) {
        showToast(`Email delivered directly to ${recipient}!`, 'success');
        if (sendBtn) {
          sendBtn.innerHTML = '✓ Sent Successfully!';
          sendBtn.style.background = '#10b981';
        }
        setTimeout(() => {
          this.closeSendToArtistModal();
          if (sendBtn) {
            sendBtn.disabled = false;
            sendBtn.innerHTML = originalBtnText;
            sendBtn.style.background = '';
          }
        }, 1500);
      } else {
        alert(data.error || 'Failed to dispatch email.');
        // If password issue, show config box
        if (data.error && data.error.includes('App Password')) {
          this.hasServerPassword = false;
          this.updateConfigUi();
        }
        if (sendBtn) {
          sendBtn.disabled = false;
          sendBtn.innerHTML = originalBtnText;
        }
      }
    } catch (err) {
      console.error('Email dispatch error:', err);
      alert('Failed to contact server: ' + err.message);
      if (sendBtn) {
        sendBtn.disabled = false;
        sendBtn.innerHTML = originalBtnText;
      }
    }
  }

  copyArtistSigningLink() {
    const baseUrl = window.location.origin + window.location.pathname;
    const cleanSigningUrl = `${baseUrl}?mode=artist-sign&id=${this.store.getState().id}`;
    navigator.clipboard.writeText(cleanSigningUrl).then(() => {
      showToast('Clean signing link copied to clipboard!', 'success');
    });
  }

  // ================= ARTIST -> LABEL: SUBMIT SIGNED CONTRACT =================
  openArtistSubmitModal() {
    const state = this.store.getState();
    const artistName = state.artist.stageName || state.artist.legalName || 'Artist';
    const baseUrl = window.location.origin + window.location.pathname;
    const counterSignUrl = `${baseUrl}?mode=counter-sign&id=${state.id}`;

    const returnUrlInput = document.getElementById('submit-return-url-display');
    if (returnUrlInput) returnUrlInput.value = counterSignUrl;

    const summaryBox = document.getElementById('submit-artist-summary-box');
    if (summaryBox) {
      summaryBox.innerHTML = `
        <div style="background:#11141e; border:1px solid #10b981; border-radius:8px; padding:16px; text-align:center;">
          <div style="font-size:26px; margin-bottom:6px;">🎉</div>
          <div style="font-size:15px; font-weight:800; color:#10b981; margin-bottom:4px;">
            Agreement Signed by ${escapeHtml(artistName)}!
          </div>
          <div style="font-size:12px; color:#9ca3af;">
            Your signature has been sealed with verified timestamp: <strong style="color:#ffffff;">${state.artist.signature?.timestamp || 'Just Now'}</strong>
          </div>
        </div>
      `;
    }

    this.submitModal?.classList.add('active');
  }

  closeArtistSubmitModal() {
    this.submitModal?.classList.remove('active');
  }

  async submitSignedAgreementDirect() {
    const state = this.store.getState();
    const submitBtn = document.getElementById('btn-submit-direct-to-label');
    const originalText = submitBtn ? submitBtn.innerHTML : '';

    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.innerHTML = '⏳ Delivering to Obscura Rec LLC...';
    }

    try {
      // 1. Immediately sync signed state to Firebase Realtime Database
      const signedPayload = {
        ...state,
        isLockedForArtist: true,
        status: 'artist_signed'
      };
      await saveAgreementToFirebase(signedPayload);

      const res = await fetch('/api/submit-signed-agreement', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          state,
          hostUrl: window.location.origin
        })
      });

      const data = await res.json();
      if (res.ok && data.success) {
        showToast('Delivered to Obscura Rec LLC!', 'success');
        if (submitBtn) {
          submitBtn.innerHTML = '✓ Executed & Delivered to Label!';
          submitBtn.style.background = '#10b981';
        }
        this.store.update('isLockedForArtist', true);
        this.store.update('status', 'artist_signed');
        setTimeout(() => {
          this.closeArtistSubmitModal();
          this.store.setLinkStatus('just_submitted', 'Your digital signature has been recorded and your executed agreement has been securely delivered to Obscura Rec LLC for counter-signature.');
        }, 1000);
      } else {
        if (data.isLocked) {
          this.store.update('isLockedForArtist', true);
          this.closeArtistSubmitModal();
        }
        alert(data.error || 'Failed to submit agreement.');
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.innerHTML = originalText;
        }
      }
    } catch (err) {
      console.error('Submission error:', err);
      alert('Submission error: ' + err.message);
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.innerHTML = originalText;
      }
    }
  }

  copyCounterSignLink() {
    const baseUrl = window.location.origin + window.location.pathname;
    const counterSignUrl = `${baseUrl}?mode=counter-sign&id=${this.store.getState().id}`;
    navigator.clipboard.writeText(counterSignUrl).then(() => {
      showToast('Counter-sign link copied to clipboard!', 'success');
    });
  }

  bindEvents() {
    // Label modal buttons
    document.getElementById('close-send-modal-btn')?.addEventListener('click', () => this.closeSendToArtistModal());
    document.getElementById('btn-send-direct-email')?.addEventListener('click', () => this.sendDirectEmail());
    document.getElementById('btn-copy-artist-link')?.addEventListener('click', () => this.copyArtistSigningLink());
    document.getElementById('btn-save-gmail-password')?.addEventListener('click', () => this.saveAppPassword());

    // Toggle mail settings
    document.getElementById('btn-toggle-mail-settings')?.addEventListener('click', () => {
      const box = document.getElementById('gmail-config-box');
      if (box) {
        box.style.display = box.style.display === 'none' ? 'block' : 'none';
      }
    });

    // Artist submit modal buttons
    document.getElementById('close-submit-modal-btn')?.addEventListener('click', () => this.closeArtistSubmitModal());
    document.getElementById('btn-submit-direct-to-label')?.addEventListener('click', () => this.submitSignedAgreementDirect());
    document.getElementById('btn-copy-return-link')?.addEventListener('click', () => this.copyCounterSignLink());
  }
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function showToast(msg, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const toast = document.createElement('div');
  toast.className = `toast ${type === 'success' ? 'toast-success' : ''}`;
  toast.innerHTML = `<span>${type === 'success' ? '✓' : 'ℹ'}</span> <span>${msg}</span>`;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 4000);
}
