/**
 * Email Forwarding & Execution Dispatcher for Obscura Rec LLC
 */

const WEBHOOK_STORAGE_KEY = 'obscura_rec_webhook_url';
const LABEL_EMAIL_KEY = 'obscura_rec_label_email';

export class EmailForwarder {
  constructor(agreementStore) {
    this.store = agreementStore;
    this.modal = document.getElementById('forward-modal');
    this.init();
  }

  init() {
    this.bindEvents();
  }

  open() {
    const state = this.store.getState();
    const status = this.store.getStatus();

    const labelEmailInput = document.getElementById('forward-label-email');
    if (labelEmailInput) {
      labelEmailInput.value = localStorage.getItem(LABEL_EMAIL_KEY) || 'legal@obscurarec.com';
    }

    const webhookInput = document.getElementById('forward-webhook-url');
    if (webhookInput) {
      webhookInput.value = localStorage.getItem(WEBHOOK_STORAGE_KEY) || '';
    }

    // Update status indicators
    const statusSummary = document.getElementById('forward-status-summary');
    if (statusSummary) {
      const hasLabelSig = Boolean(state.label.signature);
      const hasArtistSig = Boolean(state.artist.signature);

      statusSummary.innerHTML = `
        <div style="display:flex; flex-direction:column; gap:8px; background:#11141e; padding:12px; border-radius:8px; border:1px solid #24293c;">
          <div style="display:flex; justify-content:space-between; align-items:center;">
            <span style="font-size:12px; color:#9ca3af;">Agreement Status:</span>
            <span class="doc-status-badge ${status.class}">${status.label}</span>
          </div>
          <div style="display:flex; justify-content:space-between; align-items:center;">
            <span style="font-size:12px; color:#9ca3af;">Label Signature:</span>
            <span style="font-size:12px; font-weight:700; color:${hasLabelSig ? '#10b981' : '#f59e0b'};">
              ${hasLabelSig ? '✓ Signed (' + state.label.signature.timestamp + ')' : '⏳ Pending'}
            </span>
          </div>
          <div style="display:flex; justify-content:space-between; align-items:center;">
            <span style="font-size:12px; color:#9ca3af;">Artist Signature:</span>
            <span style="font-size:12px; font-weight:700; color:${hasArtistSig ? '#10b981' : '#f59e0b'};">
              ${hasArtistSig ? '✓ Signed (' + state.artist.signature.timestamp + ')' : '⏳ Pending'}
            </span>
          </div>
          <div style="display:flex; justify-content:space-between; align-items:center;">
            <span style="font-size:12px; color:#9ca3af;">Tracks Included:</span>
            <span style="font-size:12px; font-weight:700; color:#f3f4f6;">${state.tracks.length} track(s)</span>
          </div>
        </div>
      `;
    }

    this.modal?.classList.add('active');
  }

  close() {
    this.modal?.classList.remove('active');
  }

  generateEmailContent(state) {
    const artist = state.artist.stageName || state.artist.legalName || 'Artist';
    const labelRep = state.label.representative || 'Director / Founder';
    const tracksList = state.tracks.map((t, idx) => 
      `  ${idx + 1}. ${t.title} ${t.versionTag || ''} (${t.year}) - Royalty: ${t.royaltyShare || 50}%`
    ).join('\n');

    const subject = encodeURIComponent(`[EXECUTED AGREEMENT] Obscura Rec LLC x ${artist} - Ref: ${state.id}`);
    
    const body = encodeURIComponent(
`DEAR OBSCURA REC LLC LEGAL TEAM,

Please find the executed Act of Acceptance and Transfer of Objects agreement details below:

========================================
AGREEMENT IDENTIFICATION
========================================
Reference ID: ${state.id}
Date of Execution: ${state.createdAt}
Term of Exclusive License: ${state.terms.termYears} Years (Renewal: ${state.terms.renewalYears} Years)

========================================
PARTIES
========================================
• LABEL: Obscura Rec LLC
  Authorized Representative: ${labelRep} (${state.label.representativeTitle})
  Digital Signature: ${state.label.signature ? 'SIGNED (Verified Ref: ' + state.label.signature.hash + ' at ' + state.label.signature.timestamp + ')' : 'PENDING'}

• ARTIST:
  Legal Name: ${state.artist.legalName || 'N/A'}
  Stage / Performance Name: ${state.artist.stageName || 'N/A'}
  Contact Email: ${state.artist.email || 'N/A'}
  Digital Signature: ${state.artist.signature ? 'SIGNED (Verified Ref: ' + state.artist.signature.hash + ' at ' + state.artist.signature.timestamp + ')' : 'PENDING'}

========================================
DELIVERED OBJECTS & ROYALTY ALLOCATION
========================================
${tracksList}

========================================
DELIVERY VERIFICATION
========================================
• Master Audio Files, Stems & Metadata Delivered: YES
• Technical Quality Standard Met: YES

----------------------------------------
This notification was automatically prepared by the Obscura Rec LLC Agreement Creator Platform.
`
    );

    return { subject, body };
  }

  launchMailto() {
    const state = this.store.getState();
    const emailInput = document.getElementById('forward-label-email');
    const recipient = emailInput ? emailInput.value.trim() : 'legal@obscurarec.com';
    
    if (recipient) {
      localStorage.setItem(LABEL_EMAIL_KEY, recipient);
    }

    const { subject, body } = this.generateEmailContent(state);
    const mailtoUrl = `mailto:${recipient}?subject=${subject}&body=${body}`;
    window.location.href = mailtoUrl;
  }

  async sendWebhook() {
    const state = this.store.getState();
    const webhookInput = document.getElementById('forward-webhook-url');
    const url = webhookInput ? webhookInput.value.trim() : '';

    if (!url) {
      alert('Please enter a valid Webhook URL (e.g., Zapier, Make, Discord, or your API endpoint).');
      return;
    }

    localStorage.setItem(WEBHOOK_STORAGE_KEY, url);

    const payload = {
      event: 'agreement.executed',
      agreementId: state.id,
      timestamp: new Date().toISOString(),
      label: {
        name: state.label.companyName,
        representative: state.label.representative,
        signed: Boolean(state.label.signature),
        signatureRef: state.label.signature?.hash
      },
      artist: {
        legalName: state.artist.legalName,
        stageName: state.artist.stageName,
        email: state.artist.email,
        signed: Boolean(state.artist.signature),
        signatureRef: state.artist.signature?.hash
      },
      tracksCount: state.tracks.length,
      tracks: state.tracks,
      terms: state.terms
    };

    try {
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (resp.ok) {
        alert('Agreement data sent via Webhook successfully!');
        this.close();
      } else {
        alert(`Webhook responded with status: ${resp.status}`);
      }
    } catch (err) {
      console.error('Webhook dispatch failed:', err);
      alert('Webhook dispatch failed. Please verify the URL and CORS permissions.');
    }
  }

  copySummary() {
    const state = this.store.getState();
    const artist = state.artist.stageName || state.artist.legalName || 'Artist';
    const text = `Obscura Rec LLC Agreement executed for ${artist} (Ref: ${state.id}). ${state.tracks.length} track(s) delivered.`;
    navigator.clipboard.writeText(text).then(() => {
      alert('Summary copied to clipboard!');
    });
  }

  bindEvents() {
    document.getElementById('close-forward-modal-btn')?.addEventListener('click', () => this.close());
    document.getElementById('btn-send-email-mailto')?.addEventListener('click', () => this.launchMailto());
    document.getElementById('btn-send-webhook')?.addEventListener('click', () => this.sendWebhook());
    document.getElementById('btn-copy-agreement-summary')?.addEventListener('click', () => this.copySummary());
  }
}
