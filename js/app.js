/**
 * Main Application Orchestrator for Obscura Rec LLC Agreement Creator
 */

import { agreementStore, getDefaultAgreementState, sanitizeStateForNewAgreement } from './agreement-data.js';
import { renderDocument } from './document-renderer.js';
import { SignatureEngine } from './signature-pad.js';
import { exportToPdf, triggerPrint } from './pdf-export.js';
import { EmailSender } from './email-sender.js';
import { VaultManager } from './vault-manager.js';
import { AuthManager } from './auth-manager.js';
import { saveAgreementToVault } from './firebase-config.js';
import { showToast } from './toast.js';

class AgreementApp {
  constructor() {
    this.store = agreementStore;
    this.zoomLevel = 1.0;
    this.documentViewport = document.getElementById('document-viewport');
    this.pagesWrapper = null;

    // Components
    try {
      this.authManager = new AuthManager(this.store);
    } catch (authErr) {
      console.warn('AuthManager initialization error:', authErr);
    }
    this.sigEngine = new SignatureEngine(this.store, (party) => this.onSignatureUpdated(party));
    this.emailSender = new EmailSender(this.store);
    this.vaultManager = new VaultManager(this.store, (archived) => this.loadArchivedContract(archived));

    this.init();
  }

  init() {
    this.applyRoleMode();
    this.initAccordions();
    this.initSidebarResizer();
    this.bindStaticInputs();
    this.bindTopActions();
    this.bindZoomControls();
    this.bindTemplateModal();
    this.initMobileTabs();

    // Auto-fit document on startup for laptop and mobile screens
    setTimeout(() => {
      if (window.innerWidth <= 1366 || this.store.getMode() === 'artist-sign') {
        this.fitToWidth();
      }
    }, 120);

    // Initial render from loaded store state only when link is active
    const linkStatus = this.store.getLinkStatus();
    if (linkStatus === 'loading') {
      this.showInvalidLinkScreen('loading', this.store.getInvalidRefId());
    } else if (linkStatus && linkStatus !== 'active') {
      this.showInvalidLinkScreen(linkStatus, this.store.getInvalidRefId(), this.store.getInvalidReason());
    } else {
      const initialState = this.store.getState();
      this.syncInputsFromState(initialState);
      this.renderTracksList(initialState, true);
      this.updateSidebarSignatures(initialState);
      this.renderDocumentView(initialState);
      this.updateStatusBadge();
    }

    // Subscribe to state updates
    this.store.subscribe((state, options = {}) => {
      const currentLinkStatus = this.store.getLinkStatus();
      if (currentLinkStatus && currentLinkStatus !== 'active') {
        this.showInvalidLinkScreen(currentLinkStatus, this.store.getInvalidRefId(), this.store.getInvalidReason());
        return;
      }
      this.hideInvalidLinkScreen();
      this.applyRoleMode();

      // Only sync inputs & tracks when explicitly requested (load, reset, template, external sync)
      // NEVER overwrite inputs while the user is actively typing in the form!
      if (options.syncInputs) {
        this.syncInputsFromState(state);
      }
      if (options.rebuildTracks || options.syncInputs) {
        this.renderTracksList(state, options.forceRebuildTracks || false);
      }

      // Always update sidebar signature indicators and badges in Section 4!
      this.updateSidebarSignatures(state);

      this.renderDocumentView(state);
      this.updateStatusBadge();
    });
  }

  showInvalidLinkScreen(status, refId, reason) {
    const loader = document.getElementById('artist-initial-loader');
    if (loader && status !== 'loading') {
      loader.classList.add('fade-out');
    }

    document.body.classList.add('state-invalid-link');
    const screen = document.getElementById('invalid-link-screen');
    if (!screen) return;
    screen.style.display = 'flex';

    // Strictly ensure all header action buttons are hidden on expired/executed/invalid links
    const submitBtn = document.getElementById('btn-submit-artist-agreement');
    const sealedBtn = document.getElementById('btn-artist-sealed-status');
    const finalizeBtn = document.getElementById('btn-finalize-countersign');
    const sendBtn = document.getElementById('btn-send-to-artist');
    if (submitBtn) submitBtn.style.display = 'none';
    if (sealedBtn) sealedBtn.style.display = 'none';
    if (finalizeBtn) finalizeBtn.style.display = 'none';
    if (sendBtn) sendBtn.style.display = 'none';

    const iconWrap = document.getElementById('invalid-icon-wrap');
    const iconEl = document.getElementById('invalid-screen-icon');
    const pillEl = document.getElementById('invalid-screen-pill');
    const titleEl = document.getElementById('invalid-screen-title');
    const refEl = document.getElementById('invalid-screen-ref');
    const descEl = document.getElementById('invalid-screen-desc');
    const detailText = document.getElementById('invalid-detail-text');
    const actions = document.querySelector('.invalid-actions');

    if (refEl) refEl.textContent = refId || 'OBS-AGR-UNKNOWN';

    const urlParams = new URLSearchParams(window.location.search);
    const urlMode = urlParams.get('mode');
    const isArtist = (this.store.getMode() === 'artist-sign') ||
      (urlMode === 'artist-sign') ||
      status === 'just_submitted' ||
      status === 'artist_already_signed';

    const returnBtn = document.getElementById('btn-invalid-return-home');
    const downloadPdfBtn = document.getElementById('btn-invalid-download-pdf');
    const artistNotice = document.getElementById('artist-safe-close-notice');

    if (isArtist) {
      document.body.classList.add('is-artist-screen');
      if (returnBtn) returnBtn.style.display = 'none';
      if (downloadPdfBtn) downloadPdfBtn.style.display = 'none';
      if (artistNotice) artistNotice.style.display = 'block';
    } else {
      document.body.classList.remove('is-artist-screen');
      if (artistNotice) artistNotice.style.display = 'none';
      if (returnBtn) returnBtn.style.display = 'inline-flex';
      if (downloadPdfBtn) {
        if (status === 'already_finalized') {
          downloadPdfBtn.style.display = 'inline-flex';
        } else {
          downloadPdfBtn.style.display = 'none';
        }
      }
    }

    if (status === 'loading') {
      if (iconWrap) iconWrap.className = 'invalid-icon-wrap vault';
      if (iconEl) iconEl.textContent = '⏳';
      if (pillEl) {
        pillEl.className = 'invalid-pill vault';
        pillEl.textContent = 'VERIFYING SESSION...';
      }
      if (titleEl) titleEl.textContent = 'Verifying Agreement Session...';
      if (descEl) descEl.textContent = 'Connecting to Obscura Rec LLC legal server to verify contract status...';
      if (detailText) detailText.textContent = 'Please wait while we verify your digital signing session.';
      if (actions) actions.style.display = 'none';
      return;
    }

    if (actions) actions.style.display = 'flex';

    if (status === 'just_submitted' || status === 'artist_already_signed') {
      if (iconWrap) iconWrap.className = 'invalid-icon-wrap success';
      if (iconEl) iconEl.textContent = '🎉';
      if (pillEl) {
        pillEl.className = 'invalid-pill success';
        pillEl.textContent = 'AGREEMENT SIGNED & EXPIRED';
      }
      if (titleEl) titleEl.textContent = 'Agreement Digitally Executed & Delivered!';
      if (descEl) descEl.textContent = reason || 'Your signature has been securely recorded and your executed agreement has been securely delivered to Obscura Rec LLC for counter-signature.';
      if (detailText) detailText.textContent = 'This temporary signing link is now closed and terminated. No further changes can be made.';
    } else if (status === 'already_finalized') {
      if (iconWrap) iconWrap.className = 'invalid-icon-wrap vault';
      if (iconEl) iconEl.textContent = '🏛️';
      if (pillEl) {
        pillEl.className = 'invalid-pill vault';
        pillEl.textContent = 'FINALIZED & ARCHIVED TO VAULT';
      }
      if (titleEl) titleEl.textContent = 'Agreement Fully Executed & Archived';
      if (descEl) descEl.textContent = reason || `Agreement ${refId} has been fully counter-signed by Obscura Rec LLC and permanently stored in the Agreement Vault. The temporary signing link has been purged to optimize hosting storage.`;
      if (detailText) detailText.textContent = 'Label managers can examine this contract and download the official PDF from the Agreement Vault on the main creator dashboard.';
    } else {
      if (iconWrap) iconWrap.className = 'invalid-icon-wrap';
      if (iconEl) iconEl.textContent = '🚫';
      if (pillEl) {
        pillEl.className = 'invalid-pill';
        pillEl.textContent = 'URL INVALID / LINK EXPIRED';
      }
      if (titleEl) titleEl.textContent = 'Signing Link Expired or URL Invalid';
      if (descEl) descEl.textContent = reason || `The agreement link for Reference ID ${refId} does not exist or has been permanently deleted from the server.`;
      if (detailText) detailText.textContent = 'This link cannot be loaded. Please ensure the reference ID is correct or request a new agreement link from Obscura Rec LLC.';
    }
  }

  hideInvalidLinkScreen() {
    document.body.classList.remove('state-invalid-link');
    const screen = document.getElementById('invalid-link-screen');
    if (screen) screen.style.display = 'none';
  }

  applyRoleMode() {
    const mode = this.store.getMode();
    const linkStatus = this.store.getLinkStatus();
    const isLocked = this.store.isArtistLocked();
    const artistBanner = document.getElementById('banner-artist-mode');
    const lockedBanner = document.getElementById('banner-artist-locked');
    const counterBanner = document.getElementById('banner-counter-mode');
    const btnSubmitArtist = document.getElementById('btn-submit-artist-agreement');
    const btnArtistSealed = document.getElementById('btn-artist-sealed-status');
    const btnFinalize = document.getElementById('btn-finalize-countersign');

    // If link is loading or not active, strictly hide all signing action buttons and banners
    if (linkStatus !== 'active') {
      if (artistBanner) artistBanner.style.display = 'none';
      if (lockedBanner) lockedBanner.style.display = 'none';
      if (counterBanner) counterBanner.style.display = 'none';
      if (btnSubmitArtist) btnSubmitArtist.style.display = 'none';
      if (btnArtistSealed) btnArtistSealed.style.display = 'none';
      if (btnFinalize) btnFinalize.style.display = 'none';
      return;
    }

    if (mode === 'artist-sign') {
      document.body.classList.add('mode-artist-sign');
      document.body.classList.remove('mode-counter-sign');
      document.body.classList.toggle('artist-locked', isLocked);
      if (counterBanner) counterBanner.style.display = 'none';

      if (isLocked) {
        if (artistBanner) artistBanner.style.display = 'none';
        if (lockedBanner) lockedBanner.style.display = 'flex';
        if (btnSubmitArtist) btnSubmitArtist.style.display = 'none';
        if (btnArtistSealed) btnArtistSealed.style.display = 'inline-flex';
      } else {
        if (artistBanner) {
          artistBanner.style.display = 'flex';
          const currentId = this.store.getCurrentSignerId();
          const hasSigned = this.store.isArtistSigned(currentId);
          const bannerText = artistBanner.querySelector('.role-banner-text');
          if (bannerText) {
            if (hasSigned) {
              bannerText.innerHTML = `
                <strong>✍️ SIGNATURE RECORDED:</strong>
                Your digital signature has been placed on the agreement. You can click on your signature below to change or re-draw it at any time. When you are satisfied, click <strong>"✓ Submit Signed Agreement"</strong> above to officially deliver your contract to Obscura Rec LLC.
              `;
            } else {
              bannerText.innerHTML = `
                <strong>ARTIST SIGNING PORTAL:</strong>
                Obscura Rec LLC has prepared this agreement for your digital execution. All contract terms & track allocations are locked for review. Please review all pages, click <strong>"✍️ Click to Sign as Artist"</strong> to add your signature, and then click <strong>"✓ Submit Signed Agreement"</strong> above.
              `;
            }
          }
        }
        if (lockedBanner) lockedBanner.style.display = 'none';
        if (btnSubmitArtist) btnSubmitArtist.style.display = 'inline-flex';
        if (btnArtistSealed) btnArtistSealed.style.display = 'none';
      }
    } else if (mode === 'counter-sign') {
      document.body.classList.add('mode-counter-sign');
      document.body.classList.remove('mode-artist-sign');
      if (artistBanner) artistBanner.style.display = 'none';
      if (lockedBanner) lockedBanner.style.display = 'none';
      if (counterBanner) counterBanner.style.display = 'flex';
      if (btnSubmitArtist) btnSubmitArtist.style.display = 'none';
      if (btnArtistSealed) btnArtistSealed.style.display = 'none';
      if (btnFinalize) btnFinalize.style.display = 'inline-flex';
    } else {
      document.body.classList.remove('mode-artist-sign', 'mode-counter-sign');
      if (artistBanner) artistBanner.style.display = 'none';
      if (lockedBanner) lockedBanner.style.display = 'none';
      if (counterBanner) counterBanner.style.display = 'none';
      if (btnSubmitArtist) btnSubmitArtist.style.display = 'none';
      if (btnArtistSealed) btnArtistSealed.style.display = 'none';
    }
  }

  // Accordion UI Logic
  initAccordions() {
    document.querySelectorAll('.accordion-header').forEach(header => {
      header.addEventListener('click', () => {
        const item = header.closest('.accordion-item');
        item.classList.toggle('open');
      });
    });
  }

  // Draggable Sidebar Resizer Logic
  initSidebarResizer() {
    const resizer = document.getElementById('sidebar-resizer');
    const sidebar = document.querySelector('.sidebar-configurator');
    if (!resizer || !sidebar) return;

    let isResizing = false;
    let startX = 0;
    let startWidth = 0;

    // Restore saved width from localStorage
    try {
      const savedWidth = localStorage.getItem('obscura_sidebar_width');
      if (savedWidth) {
        const parsed = parseInt(savedWidth, 10);
        if (parsed >= 320 && parsed <= 950) {
          sidebar.style.width = `${parsed}px`;
        }
      }
    } catch (e) { }

    const onStart = (clientX) => {
      isResizing = true;
      startX = clientX;
      startWidth = sidebar.getBoundingClientRect().width;
      resizer.classList.add('is-dragging');
      document.body.classList.add('is-resizing-sidebar');
    };

    const onMove = (clientX) => {
      if (!isResizing) return;
      const deltaX = clientX - startX;
      let newWidth = startWidth + deltaX;

      const minW = 320;
      const maxW = Math.min(window.innerWidth * 0.7, 950);
      if (newWidth < minW) newWidth = minW;
      if (newWidth > maxW) newWidth = maxW;

      sidebar.style.width = `${newWidth}px`;
    };

    const onEnd = () => {
      if (isResizing) {
        isResizing = false;
        resizer.classList.remove('is-dragging');
        document.body.classList.remove('is-resizing-sidebar');
        try {
          localStorage.setItem('obscura_sidebar_width', sidebar.getBoundingClientRect().width);
        } catch (e) { }
      }
    };

    // Mouse drag
    resizer.addEventListener('mousedown', (e) => {
      onStart(e.clientX);
      e.preventDefault();
    });

    window.addEventListener('mousemove', (e) => {
      onMove(e.clientX);
    });

    window.addEventListener('mouseup', onEnd);

    // Touch drag
    resizer.addEventListener('touchstart', (e) => {
      if (e.touches && e.touches[0]) {
        onStart(e.touches[0].clientX);
      }
    }, { passive: true });

    window.addEventListener('touchmove', (e) => {
      if (e.touches && e.touches[0]) {
        onMove(e.touches[0].clientX);
      }
    }, { passive: true });

    window.addEventListener('touchend', onEnd);

    // Double click to reset to standard 480px
    resizer.addEventListener('dblclick', () => {
      sidebar.style.width = '480px';
      try {
        localStorage.setItem('obscura_sidebar_width', '480px');
      } catch (e) { }
    });
  }

  // Static Form Inputs Binding
  bindStaticInputs() {
    const bindField = (elemId, statePath) => {
      const el = document.getElementById(elemId);
      if (!el) return;
      el.addEventListener('input', () => {
        this.store.update(statePath, el.value);
      });
    };

    // Label Info
    bindField('input-label-rep', 'label.representative');
    bindField('input-label-title', 'label.representativeTitle');
    bindField('input-label-date', 'label.date');

    // Artist Info
    bindField('input-artist-legal', 'artist.legalName');
    bindField('input-artist-stage', 'artist.stageName');
    bindField('input-artist-email', 'artist.email');
    bindField('input-artist-date', 'artist.date');

    // Terms
    const termInput = document.getElementById('input-term-years');
    if (termInput) {
      const onTermChange = () => {
        if (!this.store.state.terms) this.store.state.terms = {};
        this.store.state.terms.termYearsEdited = true;
        this.store.update('terms.termYears', termInput.value);
      };
      termInput.addEventListener('input', onTermChange);
      termInput.addEventListener('change', onTermChange);
    }

    const renewalInput = document.getElementById('input-renewal-years');
    if (renewalInput) {
      const onRenewalChange = () => {
        if (!this.store.state.terms) this.store.state.terms = {};
        this.store.state.terms.renewalYearsEdited = true;
        this.store.update('terms.renewalYears', renewalInput.value);
      };
      renewalInput.addEventListener('input', onRenewalChange);
      renewalInput.addEventListener('change', onRenewalChange);
    }

    bindField('input-notice-days', 'terms.noticeDays');

    // Signature Trigger Buttons in Sidebar
    document.getElementById('btn-sidebar-sign-label')?.addEventListener('click', () => {
      this.sigEngine.open('label');
    });

    document.getElementById('btn-sidebar-sign-artist')?.addEventListener('click', () => {
      this.sigEngine.open('artist');
    });

    document.getElementById('btn-clear-label-sig')?.addEventListener('click', () => {
      this.sigEngine.removeSignature('label');
    });

    document.getElementById('btn-clear-artist-sig')?.addEventListener('click', () => {
      this.sigEngine.removeSignature('artist');
    });

    // Add another artist/collaborator button
    document.getElementById('btn-add-artist')?.addEventListener('click', () => {
      this.store.addArtist();
    });
  }

  // Render Additional Artists in Section 1
  renderAdditionalArtists(state) {
    const container = document.getElementById('additional-artists-container');
    if (!container) return;

    const artists = Array.isArray(state.artists) ? state.artists.slice(1) : [];
    if (artists.length === 0) {
      container.innerHTML = '';
      return;
    }

    container.innerHTML = artists.map((a, idx) => {
      const artNum = idx + 2; // Artist 2, Artist 3, etc.
      return `
        <div class="additional-artist-card" data-artist-id="${a.id}" style="background:#11141e; border:1px solid #24293c; border-radius:8px; padding:10px;">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
            <div style="font-size:11px; font-weight:700; color:#c9a050; text-transform:uppercase;">
              Artist ${artNum} (${a.role || 'Collaborator'})
            </div>
            <button type="button" class="btn-ghost-icon btn-remove-artist" data-artist-id="${a.id}" title="Remove this collaborator" style="background:transparent; border:none; color:#ef4444; cursor:pointer; font-size:11px; padding:2px 6px;">
              ✕ Remove
            </button>
          </div>

          <div class="form-row">
            <div class="form-group">
              <label class="form-label">Legal Name</label>
              <input type="text" class="form-control input-extra-artist-legal" data-artist-id="${a.id}" value="${a.legalName || ''}" placeholder="Legal Name" />
            </div>
            <div class="form-group">
              <label class="form-label">Stage Alias</label>
              <input type="text" class="form-control input-extra-artist-stage" data-artist-id="${a.id}" value="${a.stageName || ''}" placeholder="Stage Name" />
            </div>
          </div>

          <div class="form-row" style="margin-top:4px;">
            <div class="form-group" style="flex:1;">
              <label class="form-label">Email Address</label>
              <input type="email" class="form-control input-extra-artist-email" data-artist-id="${a.id}" value="${a.email || ''}" placeholder="artist@example.com" />
            </div>
            <div class="form-group" style="flex:1;">
              <label class="form-label">Role</label>
              <input type="text" class="form-control input-extra-artist-role" data-artist-id="${a.id}" value="${a.role || 'Featured Artist'}" placeholder="e.g. Featured, Producer" />
            </div>
          </div>
        </div>
      `;
    }).join('');

    // Bind remove buttons
    container.querySelectorAll('.btn-remove-artist').forEach(btn => {
      btn.onclick = () => {
        this.store.removeArtist(btn.dataset.artistId);
      };
    });

    // Bind input listeners
    const bindFieldInput = (selector, field) => {
      container.querySelectorAll(selector).forEach(input => {
        const artId = input.dataset.artistId;
        input.oninput = (e) => {
          const target = this.store.state.artists?.find(a => a.id === artId);
          if (target) {
            target[field] = e.target.value;
            this.store.save({ syncInputs: false, rebuildTracks: false });
          }
        };
      });
    };

    bindFieldInput('.input-extra-artist-legal', 'legalName');
    bindFieldInput('.input-extra-artist-stage', 'stageName');
    bindFieldInput('.input-extra-artist-email', 'email');
    bindFieldInput('.input-extra-artist-role', 'role');
  }

  // Sync inputs when state changes (e.g. on load, reset, or import)
  syncInputsFromState(state) {
    const setVal = (id, val) => {
      const el = document.getElementById(id);
      // NEVER overwrite an input that the user is actively typing in!
      if (el && el !== document.activeElement && el.value !== String(val || '')) {
        el.value = val || '';
      }
    };

    setVal('input-label-rep', state.label.representative);
    setVal('input-label-title', state.label.representativeTitle);
    setVal('input-label-date', state.label.date);

    setVal('input-artist-legal', state.artist.legalName);
    setVal('input-artist-stage', state.artist.stageName);
    setVal('input-artist-email', state.artist.email);
    setVal('input-artist-date', state.artist.date);

    // Render any additional collaborators
    this.renderAdditionalArtists(state);

    setVal('input-term-years', state.terms.termYears);
    setVal('input-renewal-years', state.terms.renewalYears);
    setVal('input-notice-days', state.terms.noticeDays);

    // Update sidebar signature indicators
    this.updateSidebarSignatures(state);
  }

  // Real-Time Sidebar Signatures Station Updater (Section 4)
  updateSidebarSignatures(state) {
    if (!state) return;

    // 1. Update Record Label Execution signature indicators
    const labelSigPill = document.getElementById('sidebar-label-sig-pill');
    const labelSigThumb = document.getElementById('sidebar-label-sig-thumb');
    const labelClearBtn = document.getElementById('btn-clear-label-sig');
    const labelSignBtn = document.getElementById('btn-sidebar-sign-label');

    const hasLabelSig = Boolean(state.label && state.label.signature);

    if (hasLabelSig) {
      if (labelSigPill) {
        labelSigPill.textContent = '✓ Signed';
        labelSigPill.className = 'sig-status-pill signed';
      }
      if (labelClearBtn) {
        labelClearBtn.style.display = 'inline-flex';
        labelClearBtn.innerHTML = '🗑️ Remove';
      }
      if (labelSignBtn) {
        labelSignBtn.textContent = '✍️ Re-sign as Label';
      }
      if (labelSigThumb) {
        labelSigThumb.style.display = 'flex';
        labelSigThumb.innerHTML = state.label.signature.type === 'type'
          ? `<span style="font-family:'${state.label.signature.font}', cursive; font-size:20px; color:#000;">${escapeHtml(state.label.signature.data)}</span>`
          : `<img src="${state.label.signature.data}" style="max-height:40px; max-width:100%;" onerror="this.style.display='none';" />`;
      }
    } else {
      if (labelSigPill) {
        labelSigPill.textContent = 'Pending';
        labelSigPill.className = 'sig-status-pill pending';
      }
      if (labelClearBtn) labelClearBtn.style.display = 'none';
      if (labelSigThumb) labelSigThumb.style.display = 'none';
      if (labelSignBtn) {
        labelSignBtn.textContent = '✍️ Sign as Label';
      }
    }

    // 2. Update dynamic artist signature cards for all collaborators in Section 4
    const artistsSigContainer = document.getElementById('sidebar-artists-sig-container');
    if (artistsSigContainer) {
      const artists = (Array.isArray(state.artists) && state.artists.length > 0)
        ? state.artists
        : [{ id: 'art-1', role: 'Recording Artist', ...(state.artist || {}) }];

      artistsSigContainer.innerHTML = artists.map((art, idx) => {
        const hasSig = Boolean(art.signature || art.status === 'signed' || art.submitted);
        const artName = (art.legalName && art.legalName.trim())
          ? `${art.legalName.trim()}${art.stageName ? ` (${art.stageName.trim()})` : ''}`
          : (art.stageName || `Artist ${idx + 1}`);
        const artRole = art.role || (idx === 0 ? 'Recording Artist' : 'Featured Artist / Collaborator');

        let thumbHtml = '';
        if (hasSig && art.signature) {
          thumbHtml = art.signature.type === 'type'
            ? `<span style="font-family:'${art.signature.font}', cursive; font-size:18px; color:#000;">${escapeHtml(art.signature.data)}</span>`
            : `<img src="${art.signature.data}" style="max-height:36px; max-width:100%;" onerror="this.style.display='none';" />`;
        }

        return `
          <div class="signing-party-card" data-artist-id="${art.id}" style="margin-top:6px;">
            <div class="signing-party-header">
              <div class="signing-party-name" style="display:flex; flex-direction:column; gap:2px;">
                <span>${idx + 1}. ${escapeHtml(artName)}</span>
                <span style="font-size:10px; color:#9ca3af; font-weight:normal;">Role: ${escapeHtml(artRole)}</span>
              </div>
              <span class="sig-status-pill ${hasSig ? 'signed' : 'pending'}" style="font-weight:800; font-size:10.5px;">
                ${hasSig ? '✓ Signed' : 'Pending'}
              </span>
            </div>
            <div class="sig-preview-thumb" style="display:${(hasSig && thumbHtml) ? 'flex' : 'none'};">
              ${thumbHtml}
            </div>
            <div style="display:flex; gap:8px; margin-top:6px;">
              <button type="button" class="btn ${hasSig ? 'btn-secondary' : 'btn-emerald'} btn-sign-artist-target" data-artist-id="${art.id}" style="flex:1; font-size:11.5px; padding:6px 10px;">
                ${hasSig ? '✍️ Re-sign as ' : '✍️ Sign as '} ${escapeHtml((art.legalName && art.legalName.trim()) || art.stageName || `Artist ${idx + 1}`)}
              </button>
              <button type="button" class="btn btn-danger-ghost btn-remove-artist-target" data-artist-id="${art.id}" style="display:${hasSig ? 'inline-flex' : 'none'}; font-size:11px; padding:6px 10px; background:rgba(239,68,68,0.12); color:#ef4444; border:1px solid rgba(239,68,68,0.3); border-radius:6px; cursor:pointer;" title="Remove signature so artist can re-sign">
                🗑️ Remove
              </button>
            </div>
          </div>
        `;
      }).join('');

      artistsSigContainer.querySelectorAll('.btn-sign-artist-target').forEach(btn => {
        btn.onclick = () => {
          this.sigEngine.open('artist', btn.dataset.artistId);
        };
      });

      artistsSigContainer.querySelectorAll('.btn-remove-artist-target').forEach(btn => {
        btn.onclick = async () => {
          await this.store.removeArtistSignature(btn.dataset.artistId);
        };
      });
    }
  }

  // Dynamic Tracks List in Sidebar
  renderTracksList(state, force = false) {
    const container = document.getElementById('tracks-container');
    if (!container) return;

    // Check if track structure (count or IDs) changed
    const currentTrackIds = state.tracks.map(t => t.id).join(',');
    if (!force && this.lastRenderedTrackIds === currentTrackIds) {
      // Structure didn't change! Update values without destroying inputs or losing focus
      state.tracks.forEach((track, idx) => {
        const card = container.querySelector(`.track-card[data-index="${idx}"]`);
        if (card) {
          const titleBadge = card.querySelector('.track-card-header-title');
          if (titleBadge) {
            const rawTitle = track.title || '[Track Name]';
            const fullTitle = track.versionTag ? `${rawTitle} ${track.versionTag}` : rawTitle;
            titleBadge.textContent = fullTitle;
          }
          ['title', 'versionTag', 'year', 'royaltyShare', 'musicAuthors', 'lyricsAuthors', 'phonogramProducers', 'transferDate'].forEach(prop => {
            const input = card.querySelector(`.track-input[data-prop="${prop}"]`);
            if (input && input !== document.activeElement && input.value !== String(track[prop] || '')) {
              input.value = track[prop] || '';
            }
          });
        }
      });
      return;
    }

    this.lastRenderedTrackIds = currentTrackIds;

    // Preserve active focus & cursor if user was typing
    const activeEl = document.activeElement;
    let focusIndex = null;
    let focusProp = null;
    let cursorStart = 0;
    let cursorEnd = 0;
    if (activeEl && activeEl.classList.contains('track-input')) {
      focusIndex = activeEl.dataset.index;
      focusProp = activeEl.dataset.prop;
      cursorStart = activeEl.selectionStart || 0;
      cursorEnd = activeEl.selectionEnd || 0;
    }

    container.innerHTML = state.tracks.map((track, idx) => `
      <div class="track-card" data-index="${idx}">
        <div class="track-card-header">
          <div style="display:flex; align-items:center; gap:8px;">
            <span class="track-index-badge">#${idx + 1}</span>
            <span class="track-card-header-title" style="font-size:12px; font-weight:700; color:#fff;">
              ${escapeHtml(track.title || '[Track Name]')} ${escapeHtml(track.versionTag || '')}
            </span>
          </div>
          <div class="track-card-actions">
            ${state.tracks.length > 1 ? `
              <button type="button" class="btn-copy-details-all" data-index="${idx}" title="Apply this track's authors, producers & dates to ALL other tracks">
                ⚡ Apply to All Tracks
              </button>
            ` : ''}
            <button type="button" class="btn btn-icon-only btn-secondary btn-duplicate-track" data-index="${idx}" title="Duplicate track">
              📋
            </button>
            <button type="button" class="btn btn-icon-only btn-danger-ghost btn-remove-track" data-index="${idx}" title="Delete track">
              🗑️
            </button>
          </div>
        </div>
        <div class="track-card-body">
          <div class="form-row">
            <div class="form-group">
              <label class="form-label">Track Title</label>
              <input type="text" class="form-control track-input" data-index="${idx}" data-prop="title" value="${escapeHtml(track.title || '')}" placeholder="[Track Name]" />
            </div>
            <div class="form-group">
              <label class="form-label">Version Tag (e.g. Slowed)</label>
              <input type="text" class="form-control track-input" data-index="${idx}" data-prop="versionTag" value="${escapeHtml(track.versionTag || '')}" placeholder="e.g. (Slowed) or (Sped Up)" />
            </div>
          </div>

          <div class="form-row">
            <div class="form-group">
              <div class="form-label-row">
                <label class="form-label">Release Year</label>
                ${state.tracks.length > 1 ? `<button type="button" class="btn-field-apply-all" data-index="${idx}" data-prop="year" title="Apply this year to all tracks">Apply to all</button>` : ''}
              </div>
              <input type="text" class="form-control track-input" data-index="${idx}" data-prop="year" value="${escapeHtml(track.year || '2026')}" placeholder="2026" />
            </div>
            <div class="form-group">
              <div class="form-label-row">
                <label class="form-label">Royalty Share (%)</label>
                ${state.tracks.length > 1 ? `<button type="button" class="btn-field-apply-all" data-index="${idx}" data-prop="royaltyShare" title="Apply this royalty % to all tracks">Apply to all</button>` : ''}
              </div>
              <input type="number" class="form-control track-input" data-index="${idx}" data-prop="royaltyShare" value="${track.royaltyShare || 50}" min="1" max="100" />
            </div>
          </div>

          <div class="form-row">
            <div class="form-group">
              <div class="form-label-row">
                <label class="form-label">Author(s) of Music</label>
                ${state.tracks.length > 1 ? `<button type="button" class="btn-field-apply-all" data-index="${idx}" data-prop="musicAuthors" title="Apply these music authors to all tracks">Apply to all</button>` : ''}
              </div>
              <input type="text" class="form-control track-input" data-index="${idx}" data-prop="musicAuthors" value="${escapeHtml(track.musicAuthors || '')}" placeholder="[Producer Names]" />
            </div>
            <div class="form-group">
              <div class="form-label-row">
                <label class="form-label">Author(s) of Lyrics</label>
                ${state.tracks.length > 1 ? `<button type="button" class="btn-field-apply-all" data-index="${idx}" data-prop="lyricsAuthors" title="Apply these lyricists to all tracks">Apply to all</button>` : ''}
              </div>
              <input type="text" class="form-control track-input" data-index="${idx}" data-prop="lyricsAuthors" value="${escapeHtml(track.lyricsAuthors || '')}" placeholder="[Lyricist Names]" />
            </div>
          </div>

          <div class="form-group full-width">
            <div class="form-label-row">
              <label class="form-label">Producer(s)</label>
              ${state.tracks.length > 1 ? `<button type="button" class="btn-field-apply-all" data-index="${idx}" data-prop="phonogramProducers" title="Apply these producers to all tracks">Apply to all</button>` : ''}
            </div>
            <input type="text" class="form-control track-input" data-index="${idx}" data-prop="phonogramProducers" value="${escapeHtml(track.phonogramProducers || '')}" placeholder="[Producer Names]" />
          </div>

          <div class="form-group full-width">
            <div class="form-label-row">
              <label class="form-label">Transfer Date</label>
              ${state.tracks.length > 1 ? `<button type="button" class="btn-field-apply-all" data-index="${idx}" data-prop="transferDate" title="Apply this transfer date to all tracks">Apply to all</button>` : ''}
            </div>
            <input type="date" class="form-control track-input" data-index="${idx}" data-prop="transferDate" value="${escapeHtml(track.transferDate || '')}" />
          </div>
        </div>
      </div>
    `).join('');

    // Bind track input changes
    container.querySelectorAll('.track-input').forEach(input => {
      input.addEventListener('input', () => {
        const index = parseInt(input.dataset.index, 10);
        const prop = input.dataset.prop;
        const curState = this.store.getState();
        if (curState.tracks && curState.tracks[index]) {
          curState.tracks[index][prop] = input.value;
        }

        // Live update card title if editing title or versionTag
        const card = input.closest('.track-card');
        if (card && (prop === 'title' || prop === 'versionTag')) {
          const titleBadge = card.querySelector('.track-card-header-title');
          if (titleBadge && curState.tracks[index]) {
            const trk = curState.tracks[index];
            const rawTitle = trk.title || '[Track Name]';
            titleBadge.textContent = trk.versionTag ? `${rawTitle} ${trk.versionTag}` : rawTitle;
          }
        }

        this.store.save({ syncInputs: false, rebuildTracks: false });
      });
    });

    // Batch apply full track details across all tracks
    container.querySelectorAll('.btn-copy-details-all').forEach(btn => {
      btn.addEventListener('click', () => {
        const sourceIndex = parseInt(btn.dataset.index, 10);
        const source = state.tracks[sourceIndex];
        if (!source) return;

        state.tracks.forEach((t, i) => {
          if (i !== sourceIndex) {
            t.musicAuthors = source.musicAuthors;
            t.lyricsAuthors = source.lyricsAuthors;
            t.phonogramProducers = source.phonogramProducers;
            t.year = source.year;
            t.royaltyShare = source.royaltyShare;
            t.transferDate = source.transferDate;
          }
        });

        this.store.save();
        this.renderTracksList(state);
        showToast(`⚡ Applied authors, producers & dates from Track #${sourceIndex + 1} to all tracks!`, 'success');
      });
    });

    // Batch apply single field across all tracks
    container.querySelectorAll('.btn-field-apply-all').forEach(btn => {
      btn.addEventListener('click', () => {
        const sourceIndex = parseInt(btn.dataset.index, 10);
        const prop = btn.dataset.prop;
        const sourceVal = state.tracks[sourceIndex]?.[prop];

        state.tracks.forEach((t, i) => {
          if (i !== sourceIndex) {
            t[prop] = sourceVal;
          }
        });

        this.store.save();
        this.renderTracksList(state);
        showToast(`✓ Applied ${prop} to all ${state.tracks.length} tracks!`, 'success');
      });
    });

    // Bind Duplicate & Remove buttons
    container.querySelectorAll('.btn-duplicate-track').forEach(btn => {
      btn.addEventListener('click', () => {
        const index = parseInt(btn.dataset.index, 10);
        this.store.duplicateTrack(index);
      });
    });

    container.querySelectorAll('.btn-remove-track').forEach(btn => {
      btn.addEventListener('click', () => {
        const index = parseInt(btn.dataset.index, 10);
        this.store.removeTrack(index);
      });
    });

    this.bindTrackButtons();

    // Restore focus if element was being typed into
    if (focusIndex !== null && focusProp !== null) {
      const elToFocus = container.querySelector(`.track-input[data-index="${focusIndex}"][data-prop="${focusProp}"]`);
      if (elToFocus) {
        elToFocus.focus();
        try {
          elToFocus.setSelectionRange(cursorStart, cursorEnd);
        } catch (e) { }
      }
    }
  }

  bindTrackButtons() {
    const addTrackBtn = document.getElementById('btn-add-track');
    if (addTrackBtn) {
      addTrackBtn.onclick = () => {
        this.store.addTrack();
      };
    }

    const bundleBtn = document.getElementById('btn-preset-slowed-spedup');
    if (bundleBtn) {
      bundleBtn.onclick = () => {
        const state = this.store.getState();
        const baseTitle = state.tracks[0]?.title || 'Track Name';
        this.store.addStandardBundle(baseTitle);
      };
    }

    const instBtn = document.getElementById('btn-preset-instrumental');
    if (instBtn) {
      instBtn.onclick = () => {
        const state = this.store.getState();
        const baseTitle = state.tracks[0]?.title || 'Track Name';
        const today = new Date().toISOString().split('T')[0];
        this.store.addTrack({
          id: 'trk-' + Math.random().toString(36).substring(2, 7),
          title: baseTitle,
          versionTag: '(Instrumental)',
          year: new Date().getFullYear().toString(),
          musicAuthors: state.artist.legalName || 'Author(s) of Music',
          lyricsAuthors: 'N/A (Instrumental)',
          phonogramProducers: 'Obscura Rec LLC',
          royaltyShare: 50,
          royaltyDetails: '50% of Label Net Income',
          transferDate: today
        });
      };
    }
  }

  // Render Document A4 Preview
  renderDocumentView(state) {
    const container = document.getElementById('document-render-target');
    if (!container) return;

    renderDocument(state, container, (party, artistId) => {
      // In artist mode, if agreement or this specific signer is locked/submitted, block clicking
      if (this.store.getMode() === 'artist-sign' && party === 'artist') {
        const targetId = artistId || this.store.getCurrentSignerId();
        const artistObj = this.store.getArtist(targetId);
        if (this.store.isArtistLocked() || (artistObj && (artistObj.submitted === true || (artistObj.status === 'signed' && artistObj.signedAt)))) {
          return;
        }
      }
      this.sigEngine.open(party, artistId);
    }, this.store.getMode());

    this.pagesWrapper = document.getElementById('printable-document');
    this.applyZoom();

    const loader = document.getElementById('artist-initial-loader');
    if (loader && this.store.getLinkStatus() === 'active' && !loader.classList.contains('fade-out')) {
      setTimeout(() => {
        loader.classList.add('fade-out');
      }, 150);
    }
  }

  // Status Badge Updater
  updateStatusBadge() {
    const badge = document.getElementById('header-status-badge');
    const headerRefCode = document.getElementById('header-ref-code');
    const sidebarRefCode = document.getElementById('sidebar-ref-code');
    const state = this.store.getState();

    if (headerRefCode) headerRefCode.textContent = state.id || 'OBS-AGR';
    if (sidebarRefCode) sidebarRefCode.textContent = state.id || 'OBS-AGR';

    if (!badge) return;
    const mode = this.store.getMode();

    if (mode === 'artist-sign') {
      if (this.store.isArtistLocked()) {
        badge.innerHTML = '<span class="status-dot"></span> 🔒 Sealed & Executed (Link Expired)';
        badge.className = 'doc-status-badge status-executed';
      } else if (state.artist.signature) {
        badge.innerHTML = '<span class="status-dot"></span> Artist Signed ✓ (Ready to Submit)';
        badge.className = 'doc-status-badge status-executed';
      } else {
        badge.innerHTML = '<span class="status-dot"></span> Action Required: Artist Signature';
        badge.className = 'doc-status-badge status-partial';
      }
      return;
    }

    if (mode === 'counter-sign') {
      if (state.label.signature) {
        badge.innerHTML = '<span class="status-dot"></span> Fully Executed ✓';
        badge.className = 'doc-status-badge status-executed';
      } else {
        badge.innerHTML = '<span class="status-dot"></span> Awaiting Label Counter-Signature';
        badge.className = 'doc-status-badge status-partial';
      }
      return;
    }

    const status = this.store.getStatus();
    badge.textContent = status.label;
    badge.className = `doc-status-badge ${status.class}`;
  }

  // Zoom Controls
  bindZoomControls() {
    const zoomText = document.getElementById('zoom-display-val');

    document.getElementById('btn-zoom-in')?.addEventListener('click', () => {
      if (this.zoomLevel < 1.6) {
        this.zoomLevel += 0.1;
        this.zoomLevel = parseFloat(this.zoomLevel.toFixed(2));
        this.applyZoom();
      }
    });

    document.getElementById('btn-zoom-out')?.addEventListener('click', () => {
      if (this.zoomLevel > 0.6) {
        this.zoomLevel -= 0.1;
        this.zoomLevel = parseFloat(this.zoomLevel.toFixed(2));
        this.applyZoom();
      }
    });

    document.getElementById('btn-zoom-reset')?.addEventListener('click', () => {
      this.zoomLevel = 1.0;
      this.applyZoom();
    });

    document.getElementById('btn-zoom-fit')?.addEventListener('click', () => {
      this.fitToWidth();
    });

    // Auto-fit document on window resize
    window.addEventListener('resize', () => {
      if (window.innerWidth <= 1366 || this.store.getMode() === 'artist-sign') {
        this.fitToWidth();
      }
    });
  }

  fitToWidth() {
    if (!this.documentViewport || !this.pagesWrapper) return;
    const containerWidth = this.documentViewport.clientWidth || window.innerWidth;
    const margin = window.innerWidth <= 768 ? 20 : (window.innerWidth <= 1366 ? 36 : 60);
    const targetScale = Math.min(1.25, Math.max(0.35, (containerWidth - margin) / 794));
    this.zoomLevel = parseFloat(targetScale.toFixed(2));
    this.applyZoom();
  }

  applyZoom() {
    if (!this.pagesWrapper) return;
    this.pagesWrapper.style.transform = `scale(${this.zoomLevel})`;
    const zoomText = document.getElementById('zoom-display-val');
    if (zoomText) {
      zoomText.textContent = `${Math.round(this.zoomLevel * 100)}%`;
    }
  }

  initMobileTabs() {
    const tabEditor = document.getElementById('tab-btn-editor');
    const tabPreview = document.getElementById('tab-btn-preview');
    const appContainer = document.querySelector('.app-container');

    tabEditor?.addEventListener('click', () => {
      tabEditor.classList.add('active');
      tabPreview?.classList.remove('active');
      appContainer?.classList.remove('show-preview');
    });

    tabPreview?.addEventListener('click', () => {
      tabPreview.classList.add('active');
      tabEditor?.classList.remove('active');
      appContainer?.classList.add('show-preview');
      setTimeout(() => this.fitToWidth(), 50);
    });
  }

  exportPdf() {
    exportToPdf(this.store.getState());
  }

  loadArchivedContract(contract) {
    if (!contract) return;
    this.store.mode = 'label';
    this.store.setLinkStatus('active');
    this.store.isLocked = false;
    this.store.state = JSON.parse(JSON.stringify(contract));
    this.store.save({ syncInputs: true, rebuildTracks: true, forceRebuildTracks: true });

    // Clear any signing query params from the browser address bar
    if (window.history && window.history.replaceState) {
      window.history.replaceState({}, document.title, window.location.pathname);
    }

    this.hideInvalidLinkScreen();
    this.applyRoleMode();
    this.store.notify();
    alert(`Loaded Archived Agreement #${contract.id} (${contract.artist?.legalName || 'Artist'} - ${contract.tracks?.[0]?.title || 'Track'}). You can examine the contract and download the official PDF.`);
  }

  // Top Nav Actions (Export, Print, Send to Artist, Submit, Reset)
  bindTopActions() {
    // Copy Unified Agreement Ref ID
    document.getElementById('header-ref-chip')?.addEventListener('click', () => {
      const refId = this.store.getState().id;
      navigator.clipboard.writeText(refId);
      showToast(`Copied Agreement Reference ID: ${refId}`, 'success');
    });

    document.getElementById('btn-copy-sidebar-ref')?.addEventListener('click', () => {
      const refId = this.store.getState().id;
      navigator.clipboard.writeText(refId);
      showToast(`Copied Agreement Reference ID: ${refId}`, 'success');
    });

    document.getElementById('btn-print-doc')?.addEventListener('click', () => {
      triggerPrint();
    });

    document.getElementById('btn-export-pdf')?.addEventListener('click', () => {
      this.exportPdf();
    });

    // Label: Send to Artist modal
    document.getElementById('btn-send-to-artist')?.addEventListener('click', () => {
      this.emailSender.openSendToArtistModal();
    });

    // Artist: Submit executed contract
    document.getElementById('btn-submit-artist-agreement')?.addEventListener('click', () => {
      const state = this.store.getState();
      const currentSignerId = this.store.getCurrentSignerId();
      const hasSigned = this.store.isArtistSigned(currentSignerId) || Boolean(state.artist?.signature);
      if (!hasSigned) {
        const sigTarget = document.querySelector(`.doc-signature-box[data-party="artist"][data-artist-id="${currentSignerId}"]`) ||
                          document.querySelector('.doc-signature-box[data-party="artist"]');
        if (sigTarget) {
          sigTarget.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
        alert('Please add your signature in the Signatures section before submitting.');
        return;
      }
      this.emailSender.openArtistSubmitModal();
    });

    // Counter-Sign: Finalize, archive to vault, and download
    document.getElementById('btn-finalize-countersign')?.addEventListener('click', async () => {
      const state = this.store.getState();
      if (!state.label.signature) {
        const sigTarget = document.querySelector('.doc-signature-box[data-party="label"]');
        if (sigTarget) {
          sigTarget.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
        alert('Please apply the Obscura Rec LLC Signature on Page 2 before finalizing.');
        return;
      }

      const btn = document.getElementById('btn-finalize-countersign');
      const originalText = btn ? btn.innerHTML : '';
      if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<span>Archiving to Vault...</span>';
      }

      try {
        await this.vaultManager.finalizeAgreement(state);
        // Manual download is available on the finalized screen - no automatic forced download!
        this.store.setLinkStatus('already_finalized', `Agreement ${state.id} has been fully counter-signed and archived into the Agreement Vault. The temporary signing link has been permanently deleted.`);
      } catch (err) {
        console.error('Vault archival failed:', err);
      } finally {
        if (btn) {
          btn.disabled = false;
          btn.innerHTML = originalText;
        }
      }
    });

    // Finalized screen optional manual PDF download
    document.getElementById('btn-invalid-download-pdf')?.addEventListener('click', () => {
      this.exportPdf();
    });

    // Save to Vault (Persist full agreement & sync signatures in real time)
    document.getElementById('btn-save-to-vault')?.addEventListener('click', () => {
      this.saveCurrentAgreementToVault();
    });

    document.getElementById('btn-reset-agreement')?.addEventListener('click', () => {
      if (confirm('Create a brand new blank agreement? All form fields and signatures will be cleared, and a new unique Agreement Reference ID will be generated.')) {
        this.store.resetAll();
        showToast(`✓ Started fresh agreement #${this.store.state.id} with clean signatures!`, 'success');
      }
    });
  }

  async saveCurrentAgreementToVault() {
    const btn = document.getElementById('btn-save-to-vault');
    const state = this.store.getState();
    const originalText = btn ? btn.innerHTML : '💾 Save to Vault';

    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<span>⏳ Saving to Vault...</span>';
    }

    try {
      // 1. Save directly to Firebase RTDB vault/ and vault_meta/
      await saveAgreementToVault(state);

      // 2. Also save to server backend VAULT_DIR if running
      try {
        await fetch('/api/vault/save', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(state)
        });
      } catch (srvErr) {
        console.warn('Backend server save warning (non-fatal):', srvErr);
      }

      // 3. Refresh vault count badge
      if (this.vaultManager) {
        await this.vaultManager.refreshCount();
      }

      showToast(`✓ Agreement ${state.id} successfully saved to Vault!`, 'success');
      if (btn) {
        btn.innerHTML = '<span>✓ Saved in Vault</span>';
        btn.style.background = '#10b981';
      }
    } catch (err) {
      console.error('Error saving agreement to vault:', err);
      showToast('Failed to save to vault: ' + (err.message || err), 'error');
    } finally {
      setTimeout(() => {
        if (btn) {
          btn.disabled = false;
          btn.innerHTML = originalText;
          btn.style.background = '';
        }
      }, 2500);
    }
  }

  onSignatureUpdated(party) {
    this.updateStatusBadge();
    this.updateSidebarSignatures(this.store.getState());
  }

  // Template Manager (Save & Load)
  bindTemplateModal() {
    const modal = document.getElementById('template-modal');
    const openBtn = document.getElementById('btn-open-templates');
    const closeBtn = document.getElementById('close-template-modal-btn');
    const saveBtn = document.getElementById('btn-save-current-template');
    const tplNameInput = document.getElementById('input-new-template-name');
    const tplList = document.getElementById('saved-templates-list');
    const exportJsonBtn = document.getElementById('btn-export-json');
    const importFileInput = document.getElementById('input-import-json-file');

    const renderTpls = () => {
      if (!tplList) return;
      const templates = this.store.getSavedTemplates();
      if (templates.length === 0) {
        tplList.innerHTML = `<div style="text-align:center; color:#6b7280; font-size:12px; padding:20px;">No saved custom templates yet.</div>`;
        return;
      }
      tplList.innerHTML = templates.map(t => `
        <div style="display:flex; justify-content:space-between; align-items:center; background:#11141e; padding:10px 14px; border-radius:8px; border:1px solid #24293c;">
          <div>
            <div style="font-size:13px; font-weight:700; color:#fff;">${escapeHtml(t.name)}</div>
            <div style="font-size:11px; color:#6b7280;">Saved on ${t.savedAt} • ${t.data?.tracks?.length || 0} tracks</div>
          </div>
          <div style="display:flex; gap:6px;">
            <button class="btn btn-secondary btn-load-tpl" data-id="${t.id}">Load</button>
            <button class="btn btn-danger-ghost btn-delete-tpl" data-id="${t.id}">🗑️</button>
          </div>
        </div>
      `).join('');

      tplList.querySelectorAll('.btn-load-tpl').forEach(b => {
        b.onclick = () => {
          if (confirm('Load this template as a new agreement? A fresh Reference ID will be generated and all signatures will be blank for signing.')) {
            this.store.loadTemplate(b.dataset.id);
            modal.classList.remove('active');
            showToast(`✓ Template loaded as fresh agreement #${this.store.state.id} with clean signatures!`, 'success');
          }
        };
      });

      tplList.querySelectorAll('.btn-delete-tpl').forEach(b => {
        b.onclick = () => {
          this.store.deleteTemplate(b.dataset.id);
          renderTpls();
        };
      });
    };

    // Official Quick Presets
    document.querySelectorAll('.btn-preset-choice').forEach(btn => {
      btn.addEventListener('click', () => {
        const presetType = btn.dataset.preset;
        const label = btn.querySelector('strong')?.textContent || presetType;
        if (confirm(`Load the "${label}" preset as a new agreement? A fresh Reference ID will be generated and all signatures will be blank for signing.`)) {
          this.store.loadPreset(presetType);
          modal.classList.remove('active');
          showToast(`✓ Loaded ${label} as fresh agreement #${this.store.state.id}!`, 'success');
        }
      });
    });

    openBtn?.addEventListener('click', () => {
      renderTpls();
      modal.classList.add('active');
    });

    closeBtn?.addEventListener('click', () => {
      modal.classList.remove('active');
    });

    saveBtn?.addEventListener('click', () => {
      const name = tplNameInput.value.trim();
      if (!name) {
        alert('Please enter a template name.');
        return;
      }
      this.store.saveTemplate(name);
      tplNameInput.value = '';
      renderTpls();
      showToast('✓ Template blueprint saved (signatures excluded)!', 'success');
    });

    // JSON Export
    exportJsonBtn?.addEventListener('click', () => {
      const state = this.store.getState();
      const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Obscura_Agreement_${state.id || 'draft'}.json`;
      a.click();
      URL.revokeObjectURL(url);
    });

    // JSON Import
    importFileInput?.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (evt) => {
        try {
          const parsed = JSON.parse(evt.target.result);
          // Always sanitize signatures & assign fresh Ref ID when importing a template/preset!
          const cleanData = sanitizeStateForNewAgreement(parsed);
          this.store.state = this.store.normalizeArtistsState({ ...getDefaultAgreementState(), ...cleanData });
          if (typeof window !== 'undefined' && window.history && window.history.replaceState) {
            window.history.replaceState({}, document.title, window.location.pathname);
          }
          this.store.restartAgreementListener();
          this.store.save({ syncInputs: true, rebuildTracks: true, forceRebuildTracks: true });
          modal.classList.remove('active');
          showToast(`✓ Imported as new agreement #${this.store.state.id} with clean signatures!`, 'success');
        } catch (err) {
          alert('Invalid JSON file format.');
        }
      };
      reader.readAsText(file);
    });
  }
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function startApp() {
  try {
    window.app = new AgreementApp();
  } catch (err) {
    console.error('AgreementApp initialization error:', err);
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', startApp);
} else {
  startApp();
}
