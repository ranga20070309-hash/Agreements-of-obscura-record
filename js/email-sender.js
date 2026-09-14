/**
 * Obscura Rec LLC - Automated In-Site Email Dispatcher
 * Directly sends emails from ocr.agreements@gmail.com without opening desktop mail apps.
 */

import { saveAgreementToFirebase, updateVaultIfArchived } from './firebase-config.js';

export class EmailSender {
  constructor(agreementStore) {
    this.store = agreementStore;
    this.sendModal = document.getElementById('send-artist-modal');
    this.submitModal = document.getElementById('submit-artist-modal');
    this.hasServerPassword = false;
    this.cooldowns = {};
    this.cooldownInterval = null;
    this.init();
  }

  // ================= COOLDOWN & SPAM PREVENTION =================
  getCooldown(key) {
    const agreementId = this.store?.getState()?.id || 'GLOBAL';
    const storageKey = `ocr_email_cd_${agreementId}_${key}`;
    let stored = 0;
    try {
      stored = parseInt(sessionStorage.getItem(storageKey) || '0', 10);
    } catch (e) {}
    const inMemory = this.cooldowns?.[key] || 0;
    const expiresAt = Math.max(stored, inMemory);
    const remaining = Math.ceil((expiresAt - Date.now()) / 1000);
    return remaining > 0 ? remaining : 0;
  }

  setCooldown(key, seconds = 60) {
    if (!this.cooldowns) this.cooldowns = {};
    const agreementId = this.store?.getState()?.id || 'GLOBAL';
    const storageKey = `ocr_email_cd_${agreementId}_${key}`;
    const expiresAt = Date.now() + seconds * 1000;
    this.cooldowns[key] = expiresAt;
    try {
      sessionStorage.setItem(storageKey, expiresAt.toString());
    } catch (e) {}
    this.startCooldownTicker();
  }

  startCooldownTicker() {
    if (this.cooldownInterval) return;
    this.cooldownInterval = setInterval(() => {
      let anyActive = false;
      const state = this.store?.getState();
      if (!state) return;

      const artists = Array.isArray(state.artists) && state.artists.length > 0 ? state.artists : [state.artist];

      artists.forEach(a => {
        const remaining = this.getCooldown(a.id);
        const btn = document.querySelector(`.btn-send-single-artist[data-artist-id="${a.id}"]`);
        const isSigned = Boolean(a.signature || a.status === 'signed' || a.submitted);
        if (isSigned) {
          if (btn) {
            btn.disabled = true;
            btn.innerHTML = '✓ Signed';
            btn.style.background = '';
            btn.style.opacity = '0.7';
          }
        } else if (remaining > 0) {
          anyActive = true;
          if (btn) {
            btn.disabled = true;
            btn.innerHTML = `⏳ Wait ${remaining}s`;
            btn.style.background = '#374151';
            btn.style.opacity = '0.85';
          }
        } else {
          if (btn && btn.innerHTML.includes('Wait')) {
            btn.disabled = false;
            btn.innerHTML = '✉️ Resend Invite';
            btn.style.background = '';
            btn.style.opacity = '1';
          }
        }
      });

      // Send-all button cooldown
      const allRem = this.getCooldown('__all__');
      const sendAllBtn = document.getElementById('btn-send-direct-email');
      if (allRem > 0) {
        anyActive = true;
        if (sendAllBtn && !sendAllBtn.innerHTML.includes('Delivering')) {
          sendAllBtn.disabled = true;
          sendAllBtn.innerHTML = `⏳ Resend All in ${allRem}s (Cooldown)`;
          sendAllBtn.style.background = '#374151';
        }
      } else if (sendAllBtn && sendAllBtn.innerHTML.includes('Resend All in')) {
        const total = artists.length;
        sendAllBtn.disabled = false;
        sendAllBtn.innerHTML = `🚀 Send Invitations to All Artists (${total})`;
        sendAllBtn.style.background = '';
      }

      if (!anyActive) {
        clearInterval(this.cooldownInterval);
        this.cooldownInterval = null;
      }
    }, 1000);
  }

  async init() {
    this.bindEvents();
    await this.checkMailConfig();

    // Auto-update send modal if open and signatures sync in
    if (this.store && typeof this.store.subscribe === 'function') {
      this.store.subscribe((state) => {
        if (this.sendModal && this.sendModal.classList.contains('active')) {
          this.renderSendModalContent(state);
        }
      });
    }
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
    // 1. Fetch latest signatures and statuses from server / Firebase FIRST
    if (this.store && typeof this.store.pollServerForSignatures === 'function') {
      await this.store.pollServerForSignatures();
    }
    const state = this.store.getState();

    // 2. Pre-activate in Firebase RTDB
    try {
      await saveAgreementToFirebase(state);
      console.log('⚡ [Firebase RTDB] Pre-activated agreement before modal open:', state.id);
    } catch (e) {
      console.warn('Pre-save to Firebase error:', e);
    }

    this.renderSendModalContent(state);

    // Refresh mail server status
    await this.checkMailConfig();

    this.sendModal?.classList.add('active');
  }

  renderSendModalContent(state) {
    const artistsList = (Array.isArray(state.artists) && state.artists.length > 0)
      ? state.artists
      : [{ id: 'art-1', role: 'Recording Artist', ...(state.artist || {}) }];

    const container = document.getElementById('send-artists-list-container');
    const baseUrl = window.location.origin + window.location.pathname;

    if (container) {
      // Prominent Single Agreement Ref ID Banner
      const refBannerHtml = `
        <div style="background:#0c0f17; border:1px solid #c9a050; border-radius:8px; padding:10px 14px; margin-bottom:14px; display:flex; justify-content:space-between; align-items:center;">
          <div>
            <div style="font-size:10px; font-weight:800; text-transform:uppercase; letter-spacing:0.8px; color:#c9a050;">
              AGREEMENT REFERENCE ID (SINGLE REF FOR ALL COLLABORATORS):
            </div>
            <div style="font-size:14px; font-weight:800; color:#ffffff; font-family:monospace; margin-top:2px;">
              ${escapeHtml(state.id)}
            </div>
          </div>
          <button type="button" class="btn btn-secondary btn-sm" id="btn-copy-modal-ref" style="font-size:11px; padding:5px 10px; white-space:nowrap;">
            📋 Copy Ref ID
          </button>
        </div>
      `;

      if (artistsList.length > 1) {
        // Multi-artist view: individual links and invite controls
        container.innerHTML = `
          ${refBannerHtml}
          <div style="font-size:12px; font-weight:800; text-transform:uppercase; letter-spacing:0.8px; color:#c9a050; margin-bottom:10px;">
            Signing Collaborators (${artistsList.length} Artists):
          </div>
          <div style="display:flex; flex-direction:column; gap:10px;">
            ${artistsList.map((a, idx) => {
              const artistUrl = `${baseUrl}?mode=artist-sign&id=${state.id}&signer=${a.id}`;
              const isSigned = Boolean(a.signature || a.status === 'signed' || a.submitted);
              const cd = this.getCooldown(a.id);
              const displayName = (a.legalName && a.legalName.trim())
                ? `${a.legalName.trim()}${a.stageName ? ` (${a.stageName.trim()})` : ''}`
                : (a.stageName || `Artist ${idx + 1}`);
              const roleTag = a.role || (idx === 0 ? 'Primary Artist' : 'Collaborator');

              let sendBtnHtml = '';
              if (isSigned) {
                sendBtnHtml = `<button type="button" class="btn btn-emerald btn-sm btn-send-single-artist" data-artist-id="${a.id}" disabled style="white-space:nowrap; font-size:11px; padding:6px 12px; opacity:0.7;">✓ Signed</button>`;
              } else if (cd > 0) {
                sendBtnHtml = `<button type="button" class="btn btn-secondary btn-sm btn-send-single-artist" data-artist-id="${a.id}" disabled style="white-space:nowrap; font-size:11px; padding:6px 12px; background:#374151;">⏳ Wait ${cd}s</button>`;
              } else {
                sendBtnHtml = `<button type="button" class="btn btn-emerald btn-sm btn-send-single-artist" data-artist-id="${a.id}" style="white-space:nowrap; font-size:11px; padding:6px 12px;">✉️ Send Invite</button>`;
              }

              return `
                <div class="artist-invite-row" style="background:#11141e; border:1px solid ${isSigned ? '#059669' : '#24293c'}; padding:12px 14px; border-radius:8px;">
                  <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
                    <div>
                      <span style="font-weight:700; color:#ffffff; font-size:13px;">${escapeHtml(displayName)}</span>
                      <span style="font-size:10px; color:#c9a050; background:rgba(201,160,80,0.12); border:1px solid rgba(201,160,80,0.25); padding:2px 6px; border-radius:4px; margin-left:6px;">
                        ${escapeHtml(roleTag)}
                      </span>
                    </div>
                    ${isSigned 
                      ? '<span style="font-size:11px; font-weight:700; color:#10b981; background:rgba(16,185,129,0.12); padding:2px 8px; border-radius:10px;">✓ Signed</span>' 
                      : '<span style="font-size:11px; font-weight:700; color:#f59e0b; background:rgba(245,158,11,0.12); padding:2px 8px; border-radius:10px;">⏳ Pending</span>'
                    }
                  </div>

                  <div style="display:flex; gap:8px; align-items:center;">
                    <input type="email" class="form-control artist-invite-email-input" data-artist-id="${a.id}" value="${escapeHtml(a.email || '')}" placeholder="${escapeHtml(displayName)}'s Email" style="flex:1; font-size:12px;" />
                    <button type="button" class="btn btn-secondary btn-sm btn-copy-single-artist" data-url="${artistUrl}" data-name="${escapeHtml(displayName)}" style="white-space:nowrap; font-size:11px; padding:6px 10px;">
                      📋 Copy Link
                    </button>
                    ${sendBtnHtml}
                  </div>
                </div>
              `;
            }).join('')}
          </div>
          <div style="margin-top:10px; font-size:11px; color:#9ca3af;">
            💡 Each artist receives a personalized link under Ref ID <strong>${escapeHtml(state.id)}</strong> that only allows them to sign their designated signature block.
          </div>
        `;

        // Bind copy Ref ID button
        const copyRefBtn = document.getElementById('btn-copy-modal-ref');
        if (copyRefBtn) {
          copyRefBtn.onclick = () => {
            navigator.clipboard.writeText(state.id);
            showToast(`Copied Agreement Ref ID: ${state.id}`, 'success');
          };
        }

        // Bind single copy buttons
        container.querySelectorAll('.btn-copy-single-artist').forEach(btn => {
          btn.onclick = () => {
            navigator.clipboard.writeText(btn.dataset.url);
            showToast(`Copied signing link for ${btn.dataset.name}!`, 'success');
          };
        });

        // Bind single email send buttons
        container.querySelectorAll('.btn-send-single-artist').forEach(btn => {
          btn.onclick = () => {
            const artId = btn.dataset.artistId;
            const rowInput = container.querySelector(`.artist-invite-email-input[data-artist-id="${artId}"]`);
            const targetEmail = rowInput ? rowInput.value.trim() : '';
            this.sendArtistEmail(artId, targetEmail, btn);
          };
        });

        // Update send-all button label & cooldown
        const sendAllBtn = document.getElementById('btn-send-direct-email');
        const allCd = this.getCooldown('__all__');
        if (sendAllBtn) {
          if (allCd > 0) {
            sendAllBtn.disabled = true;
            sendAllBtn.innerHTML = `⏳ Resend All in ${allCd}s (Cooldown)`;
            sendAllBtn.style.background = '#374151';
          } else {
            sendAllBtn.disabled = false;
            sendAllBtn.innerHTML = `🚀 Send Invitations to All Artists (${artistsList.length})`;
            sendAllBtn.style.background = '';
          }
          sendAllBtn.onclick = () => this.sendAllArtistsEmails();
        }
      } else {
        // Single artist view (backwards-compatible classic layout)
        const primaryArtist = artistsList[0];
        const singleUrl = `${baseUrl}?mode=artist-sign&id=${state.id}&signer=${primaryArtist.id}`;
        const isSigned = Boolean(primaryArtist.signature || primaryArtist.status === 'signed' || primaryArtist.submitted);
        const cd = this.getCooldown(primaryArtist.id);

        container.innerHTML = `
          ${refBannerHtml}
          <div style="background:#11141e; padding:14px; border-radius:8px; border:1px solid #24293c;">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
              <span style="font-size:12px; font-weight:700; color:#c9a050;">Primary Recording Artist</span>
              ${isSigned 
                ? '<span style="font-size:11px; font-weight:700; color:#10b981; background:rgba(16,185,129,0.12); padding:2px 8px; border-radius:10px;">✓ Signed</span>' 
                : '<span style="font-size:11px; font-weight:700; color:#f59e0b; background:rgba(245,158,11,0.12); padding:2px 8px; border-radius:10px;">⏳ Pending</span>'
              }
            </div>
            <div class="form-row">
              <div class="form-group" style="flex:1;">
                <label class="form-label" for="send-artist-email-input">Artist Email Address (Recipient):</label>
                <input type="email" id="send-artist-email-input" class="form-control" value="${escapeHtml(primaryArtist.email || '')}" placeholder="artist@example.com" />
              </div>
            </div>
            
            <div class="form-group" style="margin-top:10px;">
              <label class="form-label" for="send-artist-url-display">Unique Artist Signing Link (Ref: ${escapeHtml(state.id)}):</label>
              <div style="display:flex; gap:8px;">
                <input type="text" id="send-artist-url-display" class="form-control" readonly value="${singleUrl}" style="background:#090b10; color:#c9a050; font-family:monospace; font-size:11.5px;" />
                <button type="button" class="btn btn-secondary" id="btn-copy-artist-link" style="white-space:nowrap;">
                  📋 Copy Link
                </button>
              </div>
              <p style="font-size:11px; color:#9ca3af; margin:6px 0 0 0;">
                💡 Instant Pre-Activation: This link is active in Firebase and can be sent via WhatsApp or DM immediately!
              </p>
            </div>
          </div>
        `;

        // Bind copy Ref ID button
        const copyRefBtn = document.getElementById('btn-copy-modal-ref');
        if (copyRefBtn) {
          copyRefBtn.onclick = () => {
            navigator.clipboard.writeText(state.id);
            showToast(`Copied Agreement Ref ID: ${state.id}`, 'success');
          };
        }

        document.getElementById('btn-copy-artist-link')?.addEventListener('click', () => {
          navigator.clipboard.writeText(singleUrl);
          showToast('Copied unique artist signing link to clipboard!', 'success');
        });

        const sendAllBtn = document.getElementById('btn-send-direct-email');
        if (sendAllBtn) {
          if (isSigned) {
            sendAllBtn.innerHTML = `✓ Artist Already Signed`;
            sendAllBtn.disabled = true;
          } else if (cd > 0) {
            sendAllBtn.disabled = true;
            sendAllBtn.innerHTML = `⏳ Wait ${cd}s (Cooldown)`;
            sendAllBtn.style.background = '#374151';
          } else {
            sendAllBtn.innerHTML = `🚀 Send Agreement to Artist (via ocr.agreements@gmail.com)`;
            sendAllBtn.disabled = false;
            sendAllBtn.style.background = '';
            sendAllBtn.onclick = () => this.sendArtistEmail(primaryArtist.id);
          }
        }
      }

      // Start ticker if any cooldown is running
      this.startCooldownTicker();
    }

    // Render live branded email preview
    const firstArtistUrl = `${baseUrl}?mode=artist-sign&id=${state.id}&signer=${artistsList[0].id}`;
    this.renderEmailPreview(state, firstArtistUrl);
  }

  closeSendToArtistModal() {
    this.sendModal?.classList.remove('active');
  }

  renderEmailPreview(state, signingUrl) {
    const container = document.getElementById('email-template-preview-box');
    if (!container) return;

    const artistName = (state.artist.legalName && state.artist.legalName.trim())
      ? `${state.artist.legalName.trim()}${state.artist.stageName ? ` (${state.artist.stageName.trim()})` : ''}`
      : (state.artist.stageName || 'Artist');
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

  async sendArtistEmail(targetArtistId = null, recipientEmail = '', btnElement = null) {
    const state = this.store.getState();
    const targetId = targetArtistId || this.store.getCurrentSignerId() || 'art-1';
    const artist = this.store.getArtist(targetId) || state.artist;

    // 0. Check Cooldown to prevent spam
    const activeCd = this.getCooldown(targetId);
    if (activeCd > 0) {
      showToast(`Cooldown active: Please wait ${activeCd}s before resending invite to avoid spam.`, 'warning');
      return;
    }

    let recipient = recipientEmail;
    if (!recipient) {
      const rowInput = document.querySelector(`.artist-invite-email-input[data-artist-id="${targetId}"]`);
      if (rowInput) {
        recipient = rowInput.value.trim();
      } else {
        const emailInput = document.getElementById('send-artist-email-input');
        recipient = emailInput ? emailInput.value.trim() : (artist.email || '');
      }
    }

    const artLabel = (artist.legalName && artist.legalName.trim()) || artist.stageName || 'Artist';
    if (!recipient || !recipient.includes('@')) {
      alert(`Please enter a valid email address for ${artLabel}.`);
      return;
    }

    // Save recipient to state
    artist.email = recipient;
    if (this.store.state.artists?.[0]?.id === targetId) {
      this.store.state.artist.email = recipient;
    }
    this.store.save({ syncInputs: false });

    // Individual unique signing URL
    const baseUrl = window.location.origin + window.location.pathname;
    const cleanSigningUrl = `${baseUrl}?mode=artist-sign&id=${state.id}&signer=${targetId}`;

    const sendBtn = btnElement || document.getElementById('btn-send-direct-email');
    const originalBtnText = sendBtn ? sendBtn.innerHTML : '';
    if (sendBtn) {
      sendBtn.disabled = true;
      sendBtn.innerHTML = '⏳ Sending...';
    }

    try {
      // 1. Immediately persist agreement state to Firebase RTDB
      await saveAgreementToFirebase(this.store.getState());

      const res = await fetch('/api/send-artist-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          state: this.store.getState(),
          recipientEmail: recipient,
          signingUrl: cleanSigningUrl,
          artistName: artLabel
        })
      });

      const data = await res.json();

      if (res.ok && data.success) {
        showToast(`Invitation sent to ${artLabel} (${recipient})!`, 'success');
        // Activate 60s cooldown
        this.setCooldown(targetId, 60);
        if (sendBtn) {
          sendBtn.innerHTML = '⏳ Wait 60s';
          sendBtn.style.background = '#374151';
          sendBtn.disabled = true;
        }
        this.startCooldownTicker();
      } else {
        alert(data.error || 'Failed to dispatch email.');
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
      alert('Failed to contact mail server: ' + err.message);
      if (sendBtn) {
        sendBtn.disabled = false;
        sendBtn.innerHTML = originalBtnText;
      }
    }
  }

  async sendAllArtistsEmails() {
    const allCd = this.getCooldown('__all__');
    if (allCd > 0) {
      showToast(`Cooldown active: Please wait ${allCd}s before resending invitations to all artists.`, 'warning');
      return;
    }

    const state = this.store.getState();
    const artistsList = (Array.isArray(state.artists) && state.artists.length > 0)
      ? state.artists
      : [state.artist];

    const sendAllBtn = document.getElementById('btn-send-direct-email');
    const originalBtnText = sendAllBtn ? sendAllBtn.innerHTML : '';
    if (sendAllBtn) {
      sendAllBtn.disabled = true;
      sendAllBtn.innerHTML = '⏳ Dispatching all artist emails...';
    }

    let successCount = 0;
    for (const a of artistsList) {
      if (a.signature) continue; // skip already signed
      const rowInput = document.querySelector(`.artist-invite-email-input[data-artist-id="${a.id}"]`);
      const email = rowInput ? rowInput.value.trim() : (a.email || '');
      if (email && email.includes('@')) {
        try {
          const baseUrl = window.location.origin + window.location.pathname;
          const url = `${baseUrl}?mode=artist-sign&id=${state.id}&signer=${a.id}`;
          a.email = email;
          const res = await fetch('/api/send-artist-email', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              state: this.store.getState(),
              recipientEmail: email,
              signingUrl: url,
              artistName: (a.legalName && a.legalName.trim()) || a.stageName || 'Artist'
            })
          });
          if (res.ok) {
            successCount++;
            this.setCooldown(a.id, 60);
          }
        } catch (e) {
          console.warn('Failed to send to', a.id, e);
        }
      }
    }

    await saveAgreementToFirebase(this.store.getState());

    if (successCount > 0) {
      this.setCooldown('__all__', 60);
      this.startCooldownTicker();
    }

    if (sendAllBtn) {
      sendAllBtn.disabled = true;
      sendAllBtn.innerHTML = `✓ Dispatched (${successCount} Sent) • Cooldown (60s)`;
      sendAllBtn.style.background = '#374151';
      setTimeout(() => {
        this.renderSendModalContent(this.store.getState());
      }, 1500);
    }
    showToast(`Successfully dispatched invitations to ${successCount} artist(s)!`, 'success');
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
    const currentSignerId = this.store.getCurrentSignerId();
    const currentArtist = this.store.getArtist(currentSignerId) || state.artist;
    const artistName = (currentArtist.legalName && currentArtist.legalName.trim()) || currentArtist.stageName || 'Artist';

    const summaryBox = document.getElementById('submit-artist-summary-box');
    if (summaryBox) {
      summaryBox.innerHTML = `
        <div style="background:#11141e; border:1px solid #10b981; border-radius:8px; padding:16px; text-align:center;">
          <div style="font-size:26px; margin-bottom:6px;">🎉</div>
          <div style="font-size:15px; font-weight:800; color:#10b981; margin-bottom:4px;">
            Signature Recorded for ${escapeHtml(artistName)}!
          </div>
          <div style="font-size:12px; color:#9ca3af;">
            Your signature has been digitally sealed with verified timestamp: <strong style="color:#ffffff;">${currentArtist.signature?.timestamp || 'Just Now'}</strong>
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
    const currentSignerId = this.store.getCurrentSignerId();
    const currentArtist = this.store.getArtist(currentSignerId) || state.artist;
    const submitBtn = document.getElementById('btn-submit-direct-to-label');
    const originalText = submitBtn ? submitBtn.innerHTML : '';

    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.innerHTML = '⏳ Delivering to Obscura Rec LLC...';
    }

    try {
      if (currentArtist) {
        currentArtist.status = 'signed';
        currentArtist.submitted = true;
        currentArtist.signedAt = new Date().toISOString();
      }

      const allArtists = Array.isArray(state.artists) && state.artists.length > 0 ? state.artists : [state.artist];
      const allDone = allArtists.every(a => a && (a.submitted === true || (a.status === 'signed' && a.signedAt)));
      const signedPayload = {
        ...state,
        status: allDone ? 'all_artists_signed' : 'partially_signed',
        isLockedForArtist: allDone ? true : false
      };

      // 1. Immediately sync to Firebase RTDB (both active queue and vault)
      await saveAgreementToFirebase(signedPayload);
      try {
        await updateVaultIfArchived(signedPayload);
      } catch (vErr) {}

      // 2. Notify label server
      try {
        await fetch('/api/submit-signed-agreement', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            state: signedPayload,
            hostUrl: window.location.origin,
            signerId: currentSignerId
          })
        });
      } catch (postErr) {
        console.warn('Server notice:', postErr);
      }

      // 3. Instant local cross-tab broadcast
      try {
        const bc = new BroadcastChannel('obscura_agreements_sync');
        bc.postMessage({ type: 'ARTIST_SIGNED', id: signedPayload.id, state: signedPayload });
        bc.close();
      } catch (bcErr) {}

      try {
        localStorage.setItem('obscura_rec_last_signed_agreement', JSON.stringify(signedPayload));
      } catch (lsErr) {}

      showToast('Your digital signature has been sealed and recorded!', 'success');
      this.closeArtistSubmitModal();

      // Keep the page active, but the current signer is now locked!
      // This displays the locked sealed banner and preserves normal document reading, PDF downloading, and printing!
      this.store.notify();
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
