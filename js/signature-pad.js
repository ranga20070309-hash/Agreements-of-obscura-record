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
    this.removeBtn = document.getElementById('remove-current-sig-btn');

    this.canvas = document.getElementById('signature-canvas');
    if (this.canvas) {
      this.ctx = this.canvas.getContext('2d');
      this.resizeCanvas();
    }
  }

  resizeCanvas() {
    if (!this.canvas) return;
    const parent = this.canvas.parentElement;
    const rect = parent ? parent.getBoundingClientRect() : this.canvas.getBoundingClientRect();
    // High DPI scaling for ultra-smooth, crisp lines (min 2x for crispness on Retina/mobile)
    const dpr = Math.max(window.devicePixelRatio || 1, 2);
    const cssWidth = Math.floor(rect.width || 520);
    const cssHeight = window.innerWidth <= 600 ? 210 : 190;

    this.canvas.style.width = '100%';
    this.canvas.style.height = `${cssHeight}px`;
    this.canvas.style.touchAction = 'none';
    this.canvas.width = cssWidth * dpr;
    this.canvas.height = cssHeight * dpr;

    if (this.ctx) {
      this.ctx.setTransform(1, 0, 0, 1, 0, 0);
      this.ctx.scale(dpr, dpr);
    }
    this.redrawStrokes();
  }

  open(party = 'artist', artistId = null) {
    const mode = this.store.getMode();
    const state = this.store.getState();

    // If in artist mode, ONLY block opening if this signer has officially submitted and sealed!
    if (mode === 'artist-sign' && party === 'artist') {
      const targetId = artistId || this.store.getCurrentSignerId?.() || 'art-1';
      const artistObj = this.store.getArtist?.(targetId);
      if (state.status === 'fully_executed' || (artistObj && (artistObj.submitted === true || (artistObj.status === 'signed' && artistObj.signedAt)))) {
        return;
      }
    }

    this.currentParty = party;
    this.currentArtistId = artistId || this.store.getCurrentSignerId?.() || 'art-1';

    const targetArtist = this.store.getArtist?.(this.currentArtistId) || state.artist || {};
    const existingSig = party === 'label' ? state.label?.signature : targetArtist.signature;

    // Set modal title & default name
    if (party === 'label') {
      this.modalTitle.textContent = existingSig 
        ? `Change / Re-draw Signature: Obscura Rec LLC`
        : `Sign for Obscura Rec LLC (Label)`;
      this.signerNameInput.value = state.label.representative || 'Director / Founder';
    } else {
      const name = (targetArtist.legalName && targetArtist.legalName.trim()) || targetArtist.stageName || 'Artist';
      const role = targetArtist.role || 'Recording Artist';
      this.modalTitle.textContent = existingSig
        ? `Change / Re-draw Signature: ${name}`
        : `Sign as ${role}: ${name}`;
      this.signerNameInput.value = (targetArtist.legalName && targetArtist.legalName.trim()) || '';
    }

    if (this.applyBtn) {
      this.applyBtn.textContent = existingSig ? '✓ Update Digital Signature' : '✓ Apply Digital Signature';
    }

    if (this.removeBtn) {
      this.removeBtn.style.display = existingSig ? 'inline-flex' : 'none';
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

    // Canvas drawing events (Modern Pointer Events with Touch/Mouse Fallback)
    if (this.canvas) {
      this.canvas.style.touchAction = 'none';

      const getPos = (e) => {
        const rect = this.canvas.getBoundingClientRect();
        const clientX = e.clientX !== undefined ? e.clientX : (e.touches && e.touches[0] ? e.touches[0].clientX : 0);
        const clientY = e.clientY !== undefined ? e.clientY : (e.touches && e.touches[0] ? e.touches[0].clientY : 0);
        return {
          x: Math.max(0, Math.min(rect.width, clientX - rect.left)),
          y: Math.max(0, Math.min(rect.height, clientY - rect.top))
        };
      };

      const startDrawing = (e) => {
        if (e.pointerType && e.button !== undefined && e.button !== 0) return;
        e.preventDefault();
        this.isDrawing = true;
        if (e.pointerId !== undefined && typeof this.canvas.setPointerCapture === 'function') {
          try { this.canvas.setPointerCapture(e.pointerId); } catch (_) {}
        }
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

        // Smooth curve interpolation
        if (this.currentStroke.length > 2) {
          const p1 = this.currentStroke[this.currentStroke.length - 2];
          const xc = (p1.x + pos.x) / 2;
          const yc = (p1.y + pos.y) / 2;
          this.ctx.quadraticCurveTo(p1.x, p1.y, xc, yc);
          this.ctx.stroke();
        } else if (this.currentStroke.length === 2) {
          this.ctx.beginPath();
          this.ctx.moveTo(this.currentStroke[0].x, this.currentStroke[0].y);
          this.ctx.lineTo(pos.x, pos.y);
          this.ctx.stroke();
        }
      };

      const stopDrawing = (e) => {
        if (!this.isDrawing) return;
        this.isDrawing = false;
        if (e && e.pointerId !== undefined && typeof this.canvas.releasePointerCapture === 'function') {
          try { this.canvas.releasePointerCapture(e.pointerId); } catch (_) {}
        }
        if (this.currentStroke.length === 1) {
          // Render a clean dot for single tap
          const p = this.currentStroke[0];
          this.ctx.fillStyle = this.penColor;
          this.ctx.beginPath();
          this.ctx.arc(p.x, p.y, this.lineWidth / 1.5, 0, Math.PI * 2);
          this.ctx.fill();
          this.strokes.push([...this.currentStroke]);
        } else if (this.currentStroke.length > 1) {
          this.strokes.push([...this.currentStroke]);
        }
        this.currentStroke = [];
      };

      // Pointer Events (Modern low-latency Standard for Touch, Stylus & Mouse)
      if (window.PointerEvent) {
        this.canvas.addEventListener('pointerdown', startDrawing);
        this.canvas.addEventListener('pointermove', draw);
        this.canvas.addEventListener('pointerup', stopDrawing);
        this.canvas.addEventListener('pointercancel', stopDrawing);
      } else {
        // Fallback for legacy browsers
        this.canvas.addEventListener('mousedown', startDrawing);
        this.canvas.addEventListener('mousemove', draw);
        window.addEventListener('mouseup', stopDrawing);

        this.canvas.addEventListener('touchstart', startDrawing, { passive: false });
        this.canvas.addEventListener('touchmove', draw, { passive: false });
        window.addEventListener('touchend', stopDrawing);
      }
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

    // Remove / Clear Signature Button (when signature already exists)
    this.removeBtn?.addEventListener('click', () => {
      this.removeSignature(this.currentParty, this.currentArtistId);
      this.close();
    });
  }

  clearCanvas() {
    if (!this.ctx || !this.canvas) return;
    this.ctx.save();
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.ctx.restore();
  }

  redrawStrokes() {
    this.clearCanvas();
    if (!this.ctx) return;

    this.ctx.strokeStyle = this.penColor;
    this.ctx.lineWidth = this.lineWidth;
    this.ctx.lineCap = 'round';
    this.ctx.lineJoin = 'round';

    this.strokes.forEach(stroke => {
      if (!stroke || stroke.length === 0) return;
      if (stroke.length === 1) {
        this.ctx.fillStyle = this.penColor;
        this.ctx.beginPath();
        this.ctx.arc(stroke[0].x, stroke[0].y, this.lineWidth / 1.5, 0, Math.PI * 2);
        this.ctx.fill();
        return;
      }
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
    const hash = 'SEAL-' + Math.random().toString(36).substring(2, 9).toUpperCase();
    let signatureObj = null;

    if (this.currentTab === 'draw') {
      if (this.strokes.length === 0) {
        alert('Please draw your signature first.');
        return;
      }
      // Compress canvas to compact WebP/PNG (~2KB-4KB)
      const dataUrl = compressSignatureCanvas(this.canvas, this.strokes);
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
        if (typeof this.store.applyArtistSignature === 'function') {
          this.store.applyArtistSignature(this.currentArtistId, signatureObj);
        } else {
          this.store.update('artist.signature', signatureObj);
        }
      }
      this.close();
      if (this.onApplied) this.onApplied(this.currentParty, signatureObj, this.currentArtistId);
    }
  }

  async removeSignature(party, artistId = null) {
    if (party === 'label') {
      if (typeof this.store.removeLabelSignature === 'function') {
        await this.store.removeLabelSignature();
      } else {
        this.store.update('label.signature', null);
      }
    } else {
      const targetId = artistId || this.currentArtistId || 'art-1';
      if (typeof this.store.removeArtistSignature === 'function') {
        await this.store.removeArtistSignature(targetId);
      } else if (typeof this.store.applyArtistSignature === 'function') {
        this.store.applyArtistSignature(targetId, null);
      } else {
        this.store.update('artist.signature', null);
      }
    }
    if (this.onApplied) this.onApplied(party, null, artistId);
  }
}

/**
 * Ultra-Lightweight Signature Canvas Compression
 * Crops whitespace and renders to a max 280x90 canvas, returning a compressed WebP/PNG (~2-4 KB).
 * Keeps Firebase RTDB storage and bandwidth usage practically at zero!
 */
function compressSignatureCanvas(srcCanvas, strokes) {
  try {
    if (!strokes || strokes.length === 0) {
      return srcCanvas.toDataURL('image/webp', 0.7);
    }

    // High-resolution canvas dimensions
    const dpr = Math.max(window.devicePixelRatio || 1, 2);
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

    strokes.forEach(stroke => {
      stroke.forEach(p => {
        const px = p.x * dpr;
        const py = p.y * dpr;
        if (px < minX) minX = px;
        if (py < minY) minY = py;
        if (px > maxX) maxX = px;
        if (py > maxY) maxY = py;
      });
    });

    const pad = 10 * dpr;
    minX = Math.max(0, Math.floor(minX - pad));
    minY = Math.max(0, Math.floor(minY - pad));
    maxX = Math.min(srcCanvas.width, Math.ceil(maxX + pad));
    maxY = Math.min(srcCanvas.height, Math.ceil(maxY + pad));

    const cropW = Math.max(20, maxX - minX);
    const cropH = Math.max(20, maxY - minY);

    // Target dimensions matching signature boxes (up to 290px x 94px)
    const maxW = 290;
    const maxH = 94;
    let targetW = Math.round(cropW / dpr);
    let targetH = Math.round(cropH / dpr);

    if (targetW > maxW || targetH > maxH) {
      const ratio = Math.min(maxW / targetW, maxH / targetH);
      targetW = Math.round(targetW * ratio);
      targetH = Math.round(targetH * ratio);
    }

    const offCanvas = document.createElement('canvas');
    offCanvas.width = targetW;
    offCanvas.height = targetH;
    const offCtx = offCanvas.getContext('2d');

    offCtx.drawImage(srcCanvas, minX, minY, cropW, cropH, 0, 0, targetW, targetH);
    return offCanvas.toDataURL('image/webp', 0.7);
  } catch (err) {
    console.warn('Canvas compression fallback:', err);
    return srcCanvas.toDataURL('image/png');
  }
}

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
