/**
 * Obscura Rec LLC - Corporate Seal Manager
 * Handles seal selection, positioning, and interactive drag-and-resize on the agreement document.
 */

export const SEAL_CATALOG = [
  {
    id: 'seal-1-bw-classic-stamp.svg',
    title: '1. Classic B&W Rubber Stamp',
    category: 'Monochrome Black & White',
    desc: 'Dense black ink, natural burst rays, official reference styling.'
  },
  {
    id: 'seal-ocr-1-classic-heritage.svg',
    title: '2. Official OCR Notary Seal',
    category: 'Official Logo Emblem',
    desc: 'Features the official OCR logo emblem with laurels & beaded rim.'
  },
  {
    id: 'seal-2-bw-modern-soundburst.svg',
    title: '3. Modern Soundburst Record Seal',
    category: 'Monochrome Black & White',
    desc: 'Radial sound burst lines, bold record label typography.'
  },
  {
    id: 'seal-3-bw-court-notary.svg',
    title: '4. Legal Court & Notary Seal',
    category: 'Monochrome Black & White',
    desc: 'Classical courthouse aesthetic, notary border, official legal stamp.'
  },
  {
    id: 'seal-4-bw-executive-monochrome.svg',
    title: '5. Executive Corporate IP Stamp',
    category: 'Monochrome Black & White',
    desc: 'Minimalist executive frame, high-contrast security lines.'
  },
  {
    id: 'seal-6-bw-distressed-stamp.svg',
    title: '6. Vintage Distressed Rubber Stamp',
    category: 'Monochrome Black & White',
    desc: 'Authentic wet-ink texture, distressed rubber stamp effect.'
  },
  {
    id: 'seal-7-bw-prestige-crested.svg',
    title: '7. Prestige Crested Seal',
    category: 'Monochrome Black & White',
    desc: 'Heraldic crest styling, dense circular legal tracks.'
  },
  {
    id: 'seal-8-bw-radial-burst.svg',
    title: '8. Dense Radial Studio Stamp',
    category: 'Monochrome Black & White',
    desc: 'High-density radial needle rays, studio master stamp.'
  },
  {
    id: 'seal-ocr-2-master-vinyl.svg',
    title: '9. OCR Master Vinyl Spindle Seal',
    category: 'Official Logo Emblem',
    desc: 'Turntable strobe teeth, vinyl grooves, OCR spindle center.'
  },
  {
    id: 'seal-ocr-3-executive-sunburst.svg',
    title: '10. OCR Executive Sunburst Seal',
    category: 'Official Logo Emblem',
    desc: '36-point certificate starburst with OCR logo emblem.'
  },
  {
    id: 'seal-ocr-4-authentic-stamp.svg',
    title: '11. OCR Authentic Inked Stamp',
    category: 'Official Logo Emblem',
    desc: 'Inked rubber stamp texture with official OCR monogram.'
  },
  {
    id: 'seal-ocr-5-luxury-monogram.svg',
    title: '12. OCR Modern Luxury Seal',
    category: 'Official Logo Emblem',
    desc: 'Minimalist Swiss layout, compass crosshairs, OCR logo.'
  },
  {
    id: 'seal-1-blue-rubber-stamp.svg',
    title: '13. Classic Blue Rubber Stamp',
    category: 'Authentic Colored Ink',
    desc: 'Official bank notary blue ink (#1d4ed8).'
  },
  {
    id: 'seal-2-royal-blue-records.svg',
    title: '14. Royal Blue Music Stamp',
    category: 'Authentic Colored Ink',
    desc: 'Vibrant royal blue recording studio seal.'
  },
  {
    id: 'seal-3-crimson-notary-stamp.svg',
    title: '15. Crimson Legal Notary Stamp',
    category: 'Authentic Colored Ink',
    desc: 'Deep legal crimson (#991b1b) official stamp.'
  },
  {
    id: 'seal-4-deep-navy-security-stamp.svg',
    title: '16. Deep Navy Corporate Stamp',
    category: 'Authentic Colored Ink',
    desc: 'Executive navy blue security seal.'
  },
  {
    id: 'seal-1-executive-gold.svg',
    title: '17. Executive Corporate Gold',
    category: 'Gold & Metallic Medallions',
    desc: 'Metallic gold foil emboss finish.'
  },
  {
    id: 'seal-2-modern-vinyl-gold.svg',
    title: '18. Vinyl & Soundwave Gold',
    category: 'Gold & Metallic Medallions',
    desc: 'Radiant metallic vinyl disc gold seal.'
  },
  {
    id: 'seal-3-crimson-legal-seal.svg',
    title: '19. Crimson Legal Medallion',
    category: 'Gold & Metallic Medallions',
    desc: 'Two-tone crimson and gold legal seal.'
  },
  {
    id: 'seal-4-navy-blue-stamp.svg',
    title: '20. Executive Navy Shield Seal',
    category: 'Gold & Metallic Medallions',
    desc: 'Navy and gold heraldic shield medallion.'
  }
];

export class SealManager {
  constructor(store) {
    this.store = store;
    this.modalEl = document.getElementById('seal-vault-modal');
    this.activeCategory = 'all';
    this.init();
  }

  init() {
    this.bindSidebarEvents();
    this.bindModalEvents();
  }

  bindSidebarEvents() {
    // Open Seal Vault Modal Button
    document.getElementById('btn-open-seal-vault')?.addEventListener('click', () => {
      this.openVault();
    });

    // Remove Placed Seal Button
    document.getElementById('btn-remove-placed-seal')?.addEventListener('click', () => {
      this.removeSeal();
    });

    // Sidebar Size Slider
    const sizeSlider = document.getElementById('seal-size-slider');
    const sizeVal = document.getElementById('seal-size-val');
    if (sizeSlider) {
      sizeSlider.addEventListener('input', (e) => {
        const sz = parseInt(e.target.value, 10);
        if (sizeVal) sizeVal.textContent = `${sz}px`;
        this.updateSealProp('size', sz);
      });
    }

    // Sidebar Opacity Slider
    const opacitySlider = document.getElementById('seal-opacity-slider');
    const opacityVal = document.getElementById('seal-opacity-val');
    if (opacitySlider) {
      opacitySlider.addEventListener('input', (e) => {
        const op = parseInt(e.target.value, 10);
        if (opacityVal) opacityVal.textContent = `${op}%`;
        this.updateSealProp('opacity', op);
      });
    }

    // Sidebar Rotation Slider
    const rotSlider = document.getElementById('seal-rotation-slider');
    const rotVal = document.getElementById('seal-rotation-val');
    if (rotSlider) {
      rotSlider.addEventListener('input', (e) => {
        const deg = parseInt(e.target.value, 10);
        if (rotVal) rotVal.textContent = `${deg}°`;
        this.updateSealProp('rotation', deg);
      });
    }

    // Reset Position Button
    document.getElementById('btn-reset-seal-pos')?.addEventListener('click', () => {
      this.resetPositionToSignature();
    });
  }

  bindModalEvents() {
    // Close Modal Button
    document.getElementById('btn-close-seal-vault')?.addEventListener('click', () => {
      this.closeVault();
    });

    // Backdrop click
    this.modalEl?.addEventListener('click', (e) => {
      if (e.target === this.modalEl) {
        this.closeVault();
      }
    });

    // Category filter tabs in modal
    const filterButtons = document.querySelectorAll('.seal-filter-btn');
    filterButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        filterButtons.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.activeCategory = btn.dataset.cat || 'all';
        this.renderCatalogGrid();
      });
    });
  }

  openVault() {
    if (!this.modalEl) return;
    this.renderCatalogGrid();
    this.modalEl.style.display = 'flex';
    document.body.style.overflow = 'hidden';
  }

  closeVault() {
    if (!this.modalEl) return;
    this.modalEl.style.display = 'none';
    document.body.style.overflow = '';
  }

  renderCatalogGrid() {
    const grid = document.getElementById('seal-vault-grid');
    if (!grid) return;

    const currentSealFile = this.store.state.label?.sealFile || '';
    const isApplied = Boolean(this.store.state.label?.sealApplied);

    const filtered = this.activeCategory === 'all'
      ? SEAL_CATALOG
      : SEAL_CATALOG.filter(s => s.category.toLowerCase().includes(this.activeCategory.toLowerCase()));

    grid.innerHTML = filtered.map(item => {
      const isSelected = isApplied && currentSealFile === item.id;
      return `
        <div class="seal-vault-card ${isSelected ? 'selected' : ''}" data-seal-id="${item.id}">
          <div class="seal-vault-preview">
            <img src="./assets/seals/${item.id}" alt="${item.title}" loading="lazy" />
          </div>
          <div class="seal-vault-info">
            <div class="seal-vault-title">${item.title}</div>
            <div class="seal-vault-cat">${item.category}</div>
            <div class="seal-vault-desc">${item.desc}</div>
            <button type="button" class="btn ${isSelected ? 'btn-emerald' : 'btn-outline-gold'} btn-sm seal-select-btn" data-seal-id="${item.id}" style="width:100%; margin-top:8px;">
              ${isSelected ? '✓ Selected (Placed)' : 'Apply to Agreement'}
            </button>
          </div>
        </div>
      `;
    }).join('');

    // Attach click listeners to all cards & select buttons
    grid.querySelectorAll('.seal-select-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const sealId = btn.dataset.sealId;
        this.selectSeal(sealId);
      });
    });

    grid.querySelectorAll('.seal-vault-card').forEach(card => {
      card.addEventListener('click', () => {
        const sealId = card.dataset.sealId;
        this.selectSeal(sealId);
      });
    });
  }

  selectSeal(sealId) {
    if (!this.store.state.label) this.store.state.label = {};
    
    // Default positioning on page 2 over Obscura signature area
    const current = this.store.state.label;
    const isFirstTime = !current.sealApplied;

    this.store.state.label.sealApplied = true;
    this.store.state.label.sealFile = sealId;
    if (isFirstTime || !current.sealSize) this.store.state.label.sealSize = 135;
    if (isFirstTime || current.sealOpacity === undefined) this.store.state.label.sealOpacity = 90;
    if (isFirstTime || current.sealRotation === undefined) this.store.state.label.sealRotation = -2;
    if (isFirstTime || current.sealX === undefined) this.store.state.label.sealX = 430; // approx px from left on A4 page
    if (isFirstTime || current.sealY === undefined) this.store.state.label.sealY = 560; // approx px from top on A4 page

    this.store.save({ syncInputs: true });
    this.closeVault();
    this.updateSidebarControls(this.store.state);
  }

  removeSeal() {
    if (!this.store.state.label) return;
    this.store.state.label.sealApplied = false;
    this.store.save({ syncInputs: true });
    this.updateSidebarControls(this.store.state);
  }

  resetPositionToSignature() {
    if (!this.store.state.label || !this.store.state.label.sealApplied) return;
    this.store.state.label.sealX = 430;
    this.store.state.label.sealY = 560;
    this.store.state.label.sealSize = 135;
    this.store.state.label.sealRotation = -2;
    this.store.state.label.sealOpacity = 90;
    this.store.save({ syncInputs: true });
    this.updateSidebarControls(this.store.state);
  }

  updateSealProp(prop, val) {
    if (!this.store.state.label || !this.store.state.label.sealApplied) return;
    if (prop === 'size') this.store.state.label.sealSize = val;
    if (prop === 'opacity') this.store.state.label.sealOpacity = val;
    if (prop === 'rotation') this.store.state.label.sealRotation = val;
    if (prop === 'x') this.store.state.label.sealX = val;
    if (prop === 'y') this.store.state.label.sealY = val;

    // Fast DOM update on the live seal element without full re-render
    const sealEl = document.getElementById('draggable-corporate-seal');
    if (sealEl) {
      const sz = this.store.state.label.sealSize || 135;
      const op = (this.store.state.label.sealOpacity !== undefined ? this.store.state.label.sealOpacity : 90) / 100;
      const rot = this.store.state.label.sealRotation || 0;
      const x = this.store.state.label.sealX !== undefined ? this.store.state.label.sealX : 430;
      const y = this.store.state.label.sealY !== undefined ? this.store.state.label.sealY : 560;

      sealEl.style.width = `${sz}px`;
      sealEl.style.height = `${sz}px`;
      sealEl.style.left = `${x}px`;
      sealEl.style.top = `${y}px`;
      sealEl.style.opacity = op;
      sealEl.style.transform = `rotate(${rot}deg)`;
    }

    // Persist silently without rebuild
    this.store.save({ syncInputs: false, rebuildTracks: false });
  }

  updateSidebarControls(state) {
    const isApplied = Boolean(state.label?.sealApplied);
    const noSealNotice = document.getElementById('sidebar-no-seal-notice');
    const sealActiveBox = document.getElementById('sidebar-seal-active-box');
    const activeTitle = document.getElementById('sidebar-active-seal-title');
    const activeThumb = document.getElementById('sidebar-active-seal-thumb');
    const sizeSlider = document.getElementById('seal-size-slider');
    const sizeVal = document.getElementById('seal-size-val');
    const opacitySlider = document.getElementById('seal-opacity-slider');
    const opacityVal = document.getElementById('seal-opacity-val');
    const rotSlider = document.getElementById('seal-rotation-slider');
    const rotVal = document.getElementById('seal-rotation-val');

    if (noSealNotice && sealActiveBox) {
      if (isApplied) {
        noSealNotice.style.display = 'none';
        sealActiveBox.style.display = 'block';

        const file = state.label.sealFile || 'seal-1-bw-classic-stamp.svg';
        const item = SEAL_CATALOG.find(s => s.id === file) || { title: file };
        if (activeTitle) activeTitle.textContent = item.title;
        if (activeThumb) activeThumb.src = `./assets/seals/${file}`;

        const sz = state.label.sealSize || 135;
        const op = state.label.sealOpacity !== undefined ? state.label.sealOpacity : 90;
        const rot = state.label.sealRotation !== undefined ? state.label.sealRotation : -2;

        if (sizeSlider) sizeSlider.value = sz;
        if (sizeVal) sizeVal.textContent = `${sz}px`;
        if (opacitySlider) opacitySlider.value = op;
        if (opacityVal) opacityVal.textContent = `${op}%`;
        if (rotSlider) rotSlider.value = rot;
        if (rotVal) rotVal.textContent = `${rot}°`;
      } else {
        noSealNotice.style.display = 'block';
        sealActiveBox.style.display = 'none';
      }
    }
  }

  /**
   * Initializes drag & resize interaction on the agreement page
   */
  attachDraggableEvents() {
    const sealEl = document.getElementById('draggable-corporate-seal');
    if (!sealEl) return;

    // Check if locked/archived
    const isLocked = document.body.classList.contains('mode-artist-sign') ||
                     document.body.classList.contains('state-invalid-link') ||
                     this.store.state.isArchivedInVault ||
                     this.store.state.status === 'fully_executed';

    if (isLocked) {
      sealEl.classList.add('locked-seal');
      return;
    }

    const parentPage = sealEl.closest('.a4-page') || sealEl.parentElement;

    let isDragging = false;
    let isResizing = false;
    let startX = 0;
    let startY = 0;
    let initialLeft = 0;
    let initialTop = 0;
    let initialWidth = 0;

    // Drag handler
    sealEl.addEventListener('mousedown', (e) => {
      // If clicking on resize handle, handle resize instead
      if (e.target.classList.contains('seal-resize-handle')) {
        return;
      }
      e.preventDefault();
      e.stopPropagation();

      isDragging = true;
      startX = e.clientX;
      startY = e.clientY;

      const rect = sealEl.getBoundingClientRect();
      const parentRect = parentPage.getBoundingClientRect();

      // Scale factor if zoom is active
      const zoom = (rect.width / (sealEl.offsetWidth || 1)) || 1;

      initialLeft = parseFloat(sealEl.style.left) || (rect.left - parentRect.left) / zoom;
      initialTop = parseFloat(sealEl.style.top) || (rect.top - parentRect.top) / zoom;

      sealEl.classList.add('is-dragging');

      const onMouseMove = (moveEvent) => {
        if (!isDragging) return;
        const currentZoom = (sealEl.getBoundingClientRect().width / (sealEl.offsetWidth || 1)) || 1;
        const dx = (moveEvent.clientX - startX) / currentZoom;
        const dy = (moveEvent.clientY - startY) / currentZoom;

        let newX = Math.round(initialLeft + dx);
        let newY = Math.round(initialTop + dy);

        // Constrain within page bounds (A4 page approx 794 x 1123 px)
        const pageWidth = parentPage.clientWidth || 794;
        const pageHeight = parentPage.clientHeight || 1123;
        const curSize = sealEl.offsetWidth || 135;

        newX = Math.max(10, Math.min(pageWidth - curSize - 10, newX));
        newY = Math.max(10, Math.min(pageHeight - curSize - 10, newY));

        sealEl.style.left = `${newX}px`;
        sealEl.style.top = `${newY}px`;

        this.updateSealProp('x', newX);
        this.updateSealProp('y', newY);
      };

      const onMouseUp = () => {
        isDragging = false;
        sealEl.classList.remove('is-dragging');
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
      };

      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    });

    // Resize Handle handler
    const resizeHandle = sealEl.querySelector('.seal-resize-handle');
    if (resizeHandle) {
      resizeHandle.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();

        isResizing = true;
        startX = e.clientX;
        initialWidth = sealEl.offsetWidth || 135;
        sealEl.classList.add('is-resizing');

        const onMouseMove = (moveEvent) => {
          if (!isResizing) return;
          const currentZoom = (sealEl.getBoundingClientRect().width / (sealEl.offsetWidth || 1)) || 1;
          const dx = (moveEvent.clientX - startX) / currentZoom;
          let newSize = Math.round(initialWidth + dx);
          newSize = Math.max(70, Math.min(260, newSize)); // constrain 70px to 260px

          sealEl.style.width = `${newSize}px`;
          sealEl.style.height = `${newSize}px`;

          const sizeSlider = document.getElementById('seal-size-slider');
          const sizeVal = document.getElementById('seal-size-val');
          if (sizeSlider) sizeSlider.value = newSize;
          if (sizeVal) sizeVal.textContent = `${newSize}px`;

          this.updateSealProp('size', newSize);
        };

        const onMouseUp = () => {
          isResizing = false;
          sealEl.classList.remove('is-resizing');
          document.removeEventListener('mousemove', onMouseMove);
          document.removeEventListener('mouseup', onMouseUp);
        };

        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
      });
    }
  }
}
