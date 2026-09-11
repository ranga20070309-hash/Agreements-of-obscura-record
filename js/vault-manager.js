/**
 * Agreement Vault Manager
 * Provides searchable archive for finalized executed contracts,
 * enables Reference ID lookup, PDF download, and hosting storage optimization (purging).
 */

import { generatePdfFileName, exportToPdf } from './pdf-export.js';
import {
  finalizeToFirebaseVault,
  getVaultFromFirebase,
  getAgreementFromFirebase,
  deleteFromFirebaseVault
} from './firebase-config.js';

export class VaultManager {
  constructor(store, onExamineCallback) {
    this.store = store;
    this.onExamineCallback = onExamineCallback;
    this.records = [];
    this.filteredRecords = [];
    this.modal = document.getElementById('vault-modal');
    this.searchInput = document.getElementById('vault-search-input');
    this.container = document.getElementById('vault-records-container');
    this.countBadge = document.getElementById('vault-count-badge');
    this.statsLabel = document.getElementById('vault-stats-label');

    this.init();
  }

  init() {
    this.bindEvents();
    if (this.store.getMode() !== 'artist-sign') {
      setTimeout(() => this.refreshCount(), 1200);
    }
  }

  bindEvents() {
    // Open modal
    document.getElementById('btn-open-vault')?.addEventListener('click', () => {
      this.open();
    });

    // Close modal
    document.getElementById('close-vault-modal-btn')?.addEventListener('click', () => {
      this.close();
    });

    // Search input
    this.searchInput?.addEventListener('input', (e) => {
      this.filter(e.target.value);
    });

    // Clear search
    document.getElementById('btn-clear-vault-search')?.addEventListener('click', () => {
      if (this.searchInput) {
        this.searchInput.value = '';
        this.filter('');
      }
    });

    // Refresh button
    document.getElementById('btn-refresh-vault')?.addEventListener('click', () => {
      this.loadRecords(true);
    });
  }

  async refreshCount() {
    if (this.store.getMode() === 'artist-sign') return;

    try {
      // 1. Try Firebase Realtime Database
      const fbRecords = await getVaultFromFirebase();
      if (fbRecords && fbRecords.length > 0) {
        this.records = fbRecords;
        if (this.countBadge) {
          this.countBadge.textContent = fbRecords.length;
        }
        return;
      }

      // 2. Fallback to server API
      const res = await fetch('/api/vault');
      if (res.ok) {
        const data = await res.json();
        const count = data.count || (data.records ? data.records.length : 0);
        if (this.countBadge) {
          this.countBadge.textContent = count;
        }
      }
    } catch (e) {
      console.warn('Could not refresh vault count:', e);
    }
  }

  open() {
    this.modal?.classList.add('active');
    if (this.searchInput) {
      this.searchInput.value = '';
    }
    this.loadRecords(false);
  }

  close() {
    this.modal?.classList.remove('active');
  }

  async loadRecords(force = false) {
    if (!force && this.records && this.records.length > 0) {
      this.filteredRecords = [...this.records];
      this.render();
      this.updateStats();
      return;
    }

    if (this.container) {
      this.container.innerHTML = `
        <div style="text-align:center; padding:30px; color:#9ca3af; font-size:13px;">
          ⏳ Loading Vault archives from Firebase Cloud...
        </div>
      `;
    }

    try {
      // 1. Fetch from Firebase Realtime Database
      let records = await getVaultFromFirebase();

      // 2. Fallback to server API if needed
      if (!records || records.length === 0) {
        try {
          const res = await fetch('/api/vault');
          if (res.ok) {
            const data = await res.json();
            records = data.records || [];
          }
        } catch (serverErr) {
          console.warn('Vault server fetch fallback note:', serverErr);
        }
      }

      this.records = records || [];
      this.filteredRecords = [...this.records];
      this.render();
      this.updateStats();
      if (this.countBadge) {
        this.countBadge.textContent = this.records.length;
      }
    } catch (err) {
      console.error('Vault load error:', err);
      if (this.container) {
        this.container.innerHTML = `
          <div style="text-align:center; padding:30px; color:#ef4444; font-size:13px;">
            ⚠️ Could not load agreements: ${err.message}
          </div>
        `;
      }
    }
  }

  filter(query) {
    const q = (query || '').trim().toLowerCase();
    if (!q) {
      this.filteredRecords = [...this.records];
    } else {
      this.filteredRecords = this.records.filter(r => {
        const idMatch = (r.id || '').toLowerCase().includes(q);
        const artistMatch = (r.artistStageName || '').toLowerCase().includes(q) ||
                            (r.artistLegalName || '').toLowerCase().includes(q) ||
                            (r.artistEmail || '').toLowerCase().includes(q);
        const trackMatch = (r.firstTrackTitle || '').toLowerCase().includes(q) ||
                           (r.tracksList || []).some(t => (t || '').toLowerCase().includes(q));
        const labelMatch = (r.labelRepresentative || '').toLowerCase().includes(q);
        const dateMatch = (r.finalizedAt || '').toLowerCase().includes(q);

        return idMatch || artistMatch || trackMatch || labelMatch || dateMatch;
      });
    }
    this.render();
    this.updateStats();
  }

  updateStats() {
    if (this.statsLabel) {
      this.statsLabel.textContent = `Showing ${this.filteredRecords.length} of ${this.records.length} archived agreements`;
    }
  }

  render() {
    if (!this.container) return;

    if (this.filteredRecords.length === 0) {
      this.container.innerHTML = `
        <div style="text-align:center; padding:45px 20px; background:#0e111a; border-radius:10px; border:1px dashed #282f44;">
          <div style="font-size:32px; margin-bottom:8px;">🏛️</div>
          <div style="font-size:14px; font-weight:700; color:#e5e7eb; margin-bottom:4px;">No Vault Records Found</div>
          <div style="font-size:12px; color:#9ca3af; max-width:380px; margin:0 auto;">
            ${this.records.length === 0 
              ? 'When agreements are signed by the artist and finalized by the label, they are permanently archived here for instant search and PDF download.'
              : 'No archived agreements match your search criteria. Try searching with a different Reference ID, Artist, or Track name.'}
          </div>
        </div>
      `;
      return;
    }

    const html = this.filteredRecords.map(r => {
      const artist = r.artistStageName || r.artistLegalName || 'Unknown Artist';
      const track = r.firstTrackTitle || 'Sound Recording';
      const extraTracks = (r.trackCount > 1) ? ` +${r.trackCount - 1} more track(s)` : '';
      const dateStr = r.finalizedAt ? new Date(r.finalizedAt).toLocaleDateString() : 'Executed';

      return `
        <div class="vault-card" data-id="${r.id}">
          <div class="vault-card-left">
            <div class="vault-ref-row">
              <span class="vault-ref-chip" title="Click to copy Reference ID" onclick="navigator.clipboard.writeText('${r.id}'); window.showVaultToast('Copied Reference ID: ${r.id}');">
                📋 ${r.id}
              </span>
              <span class="vault-status-pill">
                ✓ Executed & Archived
              </span>
              <span class="vault-date-tag">
                📅 ${dateStr}
              </span>
            </div>

            <div class="vault-info-grid">
              <div>
                <span class="vault-info-label">ARTIST:</span>
                <span class="vault-info-val">${escapeHtml(artist)} ${r.artistLegalName && r.artistStageName ? `(${escapeHtml(r.artistLegalName)})` : ''}</span>
              </div>
              <div>
                <span class="vault-info-label">TRACK:</span>
                <span class="vault-info-val">${escapeHtml(track)}${extraTracks}</span>
              </div>
              <div>
                <span class="vault-info-label">HASH:</span>
                <span class="vault-info-val monospace">${escapeHtml(r.artistSigHash || 'VERIFIED')}</span>
              </div>
            </div>
          </div>

          <div class="vault-card-actions">
            <button class="btn btn-secondary btn-sm btn-vault-examine" data-id="${r.id}" title="Examine and preview full agreement on screen">
              👁️ Examine
            </button>
            <button class="btn btn-emerald btn-sm btn-vault-download" data-id="${r.id}" title="Download standard named PDF">
              ⬇️ PDF
            </button>
            <button class="btn btn-danger-ghost btn-sm btn-vault-delete" data-id="${r.id}" title="Permanently delete from vault to save storage quota">
              🗑️
            </button>
          </div>
        </div>
      `;
    }).join('');

    this.container.innerHTML = `
      <div class="vault-cards-list">
        ${html}
      </div>
    `;

    // Bind action buttons
    this.container.querySelectorAll('.btn-vault-examine').forEach(btn => {
      btn.onclick = () => this.examine(btn.dataset.id);
    });

    this.container.querySelectorAll('.btn-vault-download').forEach(btn => {
      btn.onclick = () => this.downloadPdf(btn.dataset.id);
    });

    this.container.querySelectorAll('.btn-vault-delete').forEach(btn => {
      btn.onclick = () => this.purge(btn.dataset.id);
    });
  }

  async examine(id) {
    try {
      // 1. Try Firebase Realtime Database
      let data = await getAgreementFromFirebase(id);

      // 2. Fallback to server API
      if (!data) {
        const res = await fetch(`/api/vault/${encodeURIComponent(id)}`);
        if (res.ok) {
          data = await res.json();
        }
      }

      if (!data) throw new Error('Could not find vault agreement in Firebase or server.');
      
      if (this.onExamineCallback) {
        this.onExamineCallback(data);
      }
      this.close();
      window.showVaultToast(`Loaded agreement ${id} into Document Viewer.`);
    } catch (err) {
      alert('Error examining agreement: ' + err.message);
    }
  }

  async downloadPdf(id) {
    try {
      // 1. Try Firebase Realtime Database
      let data = await getAgreementFromFirebase(id);

      // 2. Fallback to server API
      if (!data) {
        const res = await fetch(`/api/vault/${encodeURIComponent(id)}`);
        if (res.ok) {
          data = await res.json();
        }
      }

      if (!data) throw new Error('Could not fetch agreement data.');

      // Temporarily load into store or render target to export
      if (this.onExamineCallback) {
        this.onExamineCallback(data);
      }
      this.close();

      setTimeout(() => {
        exportToPdf(data);
      }, 300);
    } catch (err) {
      alert('Error downloading PDF from vault: ' + err.message);
    }
  }

  async purge(id) {
    if (!confirm(`Are you sure you want to permanently delete agreement ${id} from the Vault?\n\nThis permanently deletes the contract from Firebase Realtime Database and the server.`)) {
      return;
    }

    try {
      // 1. Delete from Firebase Realtime Database
      await deleteFromFirebaseVault(id);

      // 2. Also delete from server API
      try {
        await fetch(`/api/vault/${encodeURIComponent(id)}`, {
          method: 'DELETE'
        });
      } catch (e) {}

      window.showVaultToast(`Agreement ${id} permanently purged from vault.`);
      this.loadRecords();
    } catch (err) {
      alert('Error deleting agreement: ' + err.message);
    }
  }

  // Finalize an active agreement to the vault
  async finalizeAgreement(state) {
    try {
      // 1. Save directly to Firebase Realtime Database Vault
      await finalizeToFirebaseVault(state);

      // 2. Also sync to server API
      try {
        await fetch('/api/finalize-to-vault', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(state)
        });
      } catch (serverErr) {
        console.warn('Server finalize note:', serverErr);
      }

      this.refreshCount();
      return { success: true, id: state.id };
    } catch (err) {
      console.error('Finalize error:', err);
      throw err;
    }
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

if (typeof window !== 'undefined') {
  window.showVaultToast = function(msg) {
    const container = document.getElementById('toast-container');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = 'toast toast-success';
    toast.innerHTML = `<span>✓</span> <span>${msg}</span>`;
    container.appendChild(toast);
    setTimeout(() => toast.remove(), 4000);
  };
}
