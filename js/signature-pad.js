/**
 * Digital Signature Pad System (Draw, Type, Upload)
 */

export class SignatureEngine {
  constructor(agreementStore, onSignatureApplied) {
    this.store = agreementStore;
    this.onApplied = onSignatureApplied;
    this.currentParty = 'artist'; // 'artist' or 'label'
    this.currentTab = 'draw'; // 'draw', 'type', 'upload'
    this.canvas = null;
    this.ctx = null;
    this.isDrawing = false;
    this.strokes = [];
    this.currentStroke = [];
    this.penColor = '#0b1a3d';
    this.lineWidth = 2.5;
    this.selectedFont = 'Great Vibes';
    this.uploadedDataUrl = null;

    this.initElements();
    this.bindEvents();
  }

  initElements() {
    this.modal = document.getElementById('signature-modal');
    this.modalTitle = document.getElementById('sig-modal-party-title');
    this.signerNameInput = document.getElementById('type-sig-name-input');
    this.consentCheck = document.getElementById('sig-consent-checkbox');
    this.applyBtn = document.getElementById('apply-sig-btn');
    this.clearBtn = document.getElementById('clear-canvas-btn');
    this.undoBtn = document.getElementById('undo-canvas-btn');
    this.uploadInput = document.getElementById('sig-file-input');
    this.uploadPreview = document.getElementById('sig-upload-preview');

    this.canvas = document.getElementById('signature-canvas');
    if (this.canvas) {
      this.ctx = this.canvas.getContext('2d');
      this.resizeCanvas();
    }
  }

  resizeCanvas() {
    if (!this.canvas) return;
    const rect = this.canvas.parentElement.getBoundingClientRect();
    // High DPI scaling for crisp smooth lines
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = (rect.width || 520) * dpr;
    this.canvas.height = 190 * dpr;
    this.ctx.scale(dpr, dpr);
    this.redrawStrokes();
  }

  open(party = 'artist') {
    const mode = this.store.getMode();
    const state = this.store.getState();

    // If in artist mode and agreement is sealed/locked, block modal completely!
    if (mode === 'artist-sign' && party === 'artist') {
      if (this.store.isArtistLocked()) {
        return;
      }
    }

    this.currentParty = party;

    // Set modal title & default name
    if (party === 'label') {
      this.modalTitle.textContent = `Sign for Obscura Rec LLC (Label)`;
      this.signerNameInput.value = state.label.representative || 'Director / Founder';
    } else {
      this.modalTitle.textContent = `Sign as Artist: ${state.artist.stageName || state.artist.legalName || 'Artist'}`;
      this.signerNameInput.value = state.artist.legalName || state.artist.stageName || '';
    }

    this.consentCheck.checked = false;
    this.applyBtn.disabled = true;

    // Reset canvas strokes
    this.strokes = [];
    this.currentStroke = [];
    this.clearCanvas();
    this.uploadedDataUrl = null;
    if (this.uploadPreview) {
      this.uploadPreview.innerHTML = '<span style="color:#6b7280; font-size:12px;">Drag & drop image or click to browse</span>';
    }

    this.switchTab('draw');
    this.renderFontChoices();
    this.modal.classList.add('active');

    setTimeout(() => this.resizeCanvas(), 50);
  }

  close() {
    this.modal.classList.remove('active');
  }

  switchTab(tab) {
    this.currentTab = tab;
    document.querySelectorAll('.sig-tab-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tab === tab);
    });

    document.getElementById('sig-tab-draw').style.display = tab === 'draw' ? 'block' : 'none';
    document.getElementById('sig-tab-type').style.display = tab === 'type' ? 'block' : 'none';
    document.getElementById('sig-tab-upload').style.display = tab === 'upload' ? 'block' : 'none';

    if (tab === 'draw') {
      setTimeout(() => this.resizeCanvas(), 20);
    }
  }

  renderFontChoices() {
    const list = document.getElementById('cursive-fonts-list');
    if (!list) return;

    const fonts = [
      { name: 'Great Vibes', label: 'Classic Luxury Calligraphy' },
      { name: 'Dancing Script', label: 'Modern Expressive Script' },
      { name: 'Alex Brush', label: 'Formal Executive Signature' },
      { name: 'Caveat', label: 'Casual Freehand Signature' }
    ];

    const currentText = this.signerNameInput.value.trim() || 'Obscura Signature';

    list.innerHTML = fonts.map(f => `
      <div class="font-choice-card ${f.name === this.selectedFont ? 'selected' : ''}" data-font="${f.name}">
        <div>
          <div class="font-choice-preview" style="font-family: '${f.name}', cursive;">
            ${escapeHtml(currentText)}
          </div>
          <span style="font-size:11px; color:#6b7280;">${f.label}</span>
        </div>
        ${f.name === this.selectedFont ? '<span style="color:#c9a050; font-size:16px;">✓</span>' : ''}
      </div>
    `).join('');

    list.querySelectorAll('.font-choice-card').forEach(card => {
      card.addEventListener('click', () => {
        this.selectedFont = card.dataset.font;
        this.renderFontChoices();
      });
    });
  }

  bindEvents() {
    // Tab switching
    document.querySelectorAll('.sig-tab-btn').forEach(btn => {
      btn.addEventListener('click', () => this.switchTab(btn.dataset.tab));
    });

    // Close button
    document.getElementById('close-sig-modal-btn')?.addEventListener('click', () => this.close());
    document.getElementById('cancel-sig-btn')?.addEventListener('click', () => this.close());

    // Checkbox validation
    this.consentCheck?.addEventListener('change', () => {
      this.applyBtn.disabled = !this.consentCheck.checked;
    });

    // Name input live update for font preview
    this.signerNameInput?.addEventListener('input', () => {
      this.renderFontChoices();
    });

    // Canvas drawing events (Mouse & Touch)
    if (this.canvas) {
      const getPos = (e) => {
        const rect = this.canvas.getBoundingClientRect();
        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        const clientY = e.touches ? e.touches[0].clientY : e.clientY;
        return {
          x: clientX - rect.left,
          y: clientY - rect.top
        };
      };

      const startDrawing = (e) => {
        e.preventDefault();
        this.isDrawing = true;
        const pos = getPos(e);
        this.currentStroke = [pos];
        this.ctx.beginPath();
        this.ctx.moveTo(pos.x, pos.y);
      };

      const draw = (e) => {
        if (!this.isDrawing) return;
        e.preventDefault();
        const pos = getPos(e);
        this.currentStroke.push(pos);

        this.ctx.strokeStyle = this.penColor;
        this.ctx.lineWidth = this.lineWidth;
        this.ctx.lineCap = 'round';
        this.ctx.lineJoin = 'round';

        // Smooth curve
        if (this.currentStroke.length > 2) {
          const xc = (this.currentStroke[this.currentStroke.length - 2].x + pos.x) / 2;
          const yc = (this.currentStroke[this.currentStroke.length - 2].y + pos.y) / 2;
          this.ctx.quadraticCurveTo(
            this.currentStroke[this.currentStroke.length - 2].x,
            this.currentStroke[this.currentStroke.length - 2].y,
            xc,
            yc
          );
        } else {
          this.ctx.lineTo(pos.x, pos.y);
        }
        this.ctx.stroke();
      };

      const stopDrawing = () => {
        if (this.isDrawing) {
          this.isDrawing = false;
          if (this.currentStroke.length > 0) {
            this.strokes.push([...this.currentStroke]);
            this.currentStroke = [];
          }
        }
      };

      this.canvas.addEventListener('mousedown', startDrawing);
      this.canvas.addEventListener('mousemove', draw);
      window.addEventListener('mouseup', stopDrawing);

      this.canvas.addEventListener('touchstart', startDrawing, { passive: false });
      this.canvas.addEventListener('touchmove', draw, { passive: false });
      window.addEventListener('touchend', stopDrawing);
    }

    // Clear & Undo
    this.clearBtn?.addEventListener('click', () => {
      this.strokes = [];
      this.clearCanvas();
    });

    this.undoBtn?.addEventListener('click', () => {
      this.strokes.pop();
      this.redrawStrokes();
    });

    // Pen colors
    document.querySelectorAll('.sig-color-swatch').forEach(swatch => {
      swatch.addEventListener('click', () => {
        document.querySelectorAll('.sig-color-swatch').forEach(s => s.classList.remove('active'));
        swatch.classList.add('active');
        this.penColor = swatch.dataset.color;
      });
    });

    // Image Upload
    this.uploadInput?.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) {
        const reader = new FileReader();
        reader.onload = (loadEvt) => {
          this.uploadedDataUrl = loadEvt.target.result;
          this.uploadPreview.innerHTML = `
            <img src="${this.uploadedDataUrl}" style="max-height:80px; max-width:100%; object-fit:contain;" />
          `;
        };
        reader.readAsDataURL(file);
      }
    });

    // Apply Signature Button
    this.applyBtn?.addEventListener('click', () => {
      this.applySignature();
    });
  }

  clearCanvas() {
    if (!this.ctx || !this.canvas) return;
    const dpr = window.devicePixelRatio || 1;
    this.ctx.clearRect(0, 0, this.canvas.width / dpr, this.canvas.height / dpr);
  }

  redrawStrokes() {
    this.clearCanvas();
    if (!this.ctx) return;

    this.ctx.strokeStyle = this.penColor;
    this.ctx.lineWidth = this.lineWidth;
    this.ctx.lineCap = 'round';
    this.ctx.lineJoin = 'round';

    this.strokes.forEach(stroke => {
      if (stroke.length < 2) return;
      this.ctx.beginPath();
      this.ctx.moveTo(stroke[0].x, stroke[0].y);
      for (let i = 1; i < stroke.length; i++) {
        const p1 = stroke[i - 1];
        const p2 = stroke[i];
        const xc = (p1.x + p2.x) / 2;
        const yc = (p1.y + p2.y) / 2;
        this.ctx.quadraticCurveTo(p1.x, p1.y, xc, yc);
      }
      this.ctx.stroke();
    });
  }

  applySignature() {
    const timestamp = new Date().toLocaleString();
    const hash = 'OBS-' + Math.random().toString(36).substring(2, 9).toUpperCase();
    let signatureObj = null;

    if (this.currentTab === 'draw') {
      if (this.strokes.length === 0) {
        alert('Please draw your signature first.');
        return;
      }
      const dataUrl = this.canvas.toDataURL('image/png');
      signatureObj = {
        type: 'draw',
        data: dataUrl,
        timestamp,
        hash
      };
    } else if (this.currentTab === 'type') {
      const text = this.signerNameInput.value.trim();
      if (!text) {
        alert('Please type a name for the signature.');
        return;
      }
      signatureObj = {
        type: 'type',
        data: text,
        font: this.selectedFont,
        timestamp,
        hash
      };
    } else if (this.currentTab === 'upload') {
      if (!this.uploadedDataUrl) {
        alert('Please upload a signature image file first.');
        return;
      }
      signatureObj = {
        type: 'upload',
        data: this.uploadedDataUrl,
        timestamp,
        hash
      };
    }

    if (signatureObj) {
      if (this.currentParty === 'label') {
        this.store.update('label.signature', signatureObj);
      } else {
        this.store.update('artist.signature', signatureObj);
      }
      this.close();
      if (this.onApplied) this.onApplied(this.currentParty, signatureObj);
    }
  }

  removeSignature(party) {
    if (confirm(`Remove digital signature for ${party === 'label' ? 'Label' : 'Artist'}?`)) {
      if (party === 'label') {
        this.store.update('label.signature', null);
      } else {
        this.store.update('artist.signature', null);
      }
    }
  }
}

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
