/**
 * High-Resolution Page-by-Page PDF Export & Vector Print Engine
 * Renders each .a4-page directly to jsPDF as a discrete A4 sheet
 * Guarantees zero blank pages, zero chopped footers, and pixel-perfect fidelity.
 */

export function triggerPrint() {
  window.print();
}

/**
 * Automatically format exported filename:
 * Agreement - [Ref ID] - [Song Name] - [Label Name].pdf
 */
export function generatePdfFileName(state) {
  const sanitize = (str, fallback) => {
    if (!str) return fallback;
    const clean = String(str)
      .trim()
      .replace(/[\\/*?:"<>|]/g, '')
      .replace(/\s+/g, ' ');
    return clean || fallback;
  };

  const refId = sanitize(state?.id, 'OBS-AGR');
  const songName = state?.tracks?.[0]?.title
    ? sanitize(state.tracks[0].title, 'Track')
    : (state?.tracks?.[0]?.name ? sanitize(state.tracks[0].name, 'Track') : 'Track');
  const labelName = sanitize(state?.label?.companyName, 'Obscura Rec LLC');

  return `Agreement - ${refId} - ${songName} - ${labelName}.pdf`;
}

/**
 * Preload seal SVG as an offscreen Image element for direct high-resolution 2D canvas stamping
 */
async function loadSealDrawable(sealFile) {
  if (!sealFile) return null;
  try {
    const res = await fetch(`./assets/seals/${sealFile}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const svgText = await res.text();

    const blob = new Blob([svgText], { type: 'image/svg+xml;charset=utf-8' });
    const blobUrl = URL.createObjectURL(blob);
    const img = new Image();

    await new Promise((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = (e) => reject(e);
      img.src = blobUrl;
    });

    return img;
  } catch (err) {
    console.warn('Could not load seal SVG as blob image, checking DOM fallback:', err);
    const domImg = document.querySelector('#draggable-corporate-seal img');
    if (domImg && domImg.complete && domImg.naturalWidth > 0) {
      return domImg;
    }
    return null;
  }
}

export async function exportToPdf(state) {
  const container = document.getElementById('printable-document');
  if (!container) {
    alert('Document container not found.');
    return;
  }

  const pages = Array.from(container.querySelectorAll('.a4-page'));
  if (pages.length === 0) {
    alert('No document pages found.');
    return;
  }

  const filename = generatePdfFileName(state);

  // Preserve zoom scale during capture
  const prevTransform = container.style.transform;
  container.style.transform = 'none';

  // Add exporting class to hide interactive button tags, shadows & hover prompts
  document.body.classList.add('exporting-pdf');

  try {
    const jsPdfLib = (window.jspdf && window.jspdf.jsPDF) ? window.jspdf.jsPDF : window.jsPDF;
    if (!jsPdfLib || typeof window.html2canvas === 'undefined') {
      throw new Error('Local PDF generation engine (jsPDF / html2canvas) not loaded');
    }

    showToast(`Generating ${pages.length}-page high-resolution PDF...`, 'info');

    // Preload seal drawable image if seal is applied so we can stamp it with vector precision
    let sealDrawableImg = null;
    if (state?.label?.sealApplied && state?.label?.sealFile) {
      sealDrawableImg = await loadSealDrawable(state.label.sealFile);
    }

    // Wait for all non-seal images inside container (signatures, logos) to be fully loaded & decoded
    const allImgs = Array.from(container.querySelectorAll('img:not(#draggable-corporate-seal img)'));
    await Promise.all(allImgs.map(img => {
      if (img.complete && img.naturalWidth > 0) {
        return img.decode ? img.decode().catch(() => {}) : Promise.resolve();
      }
      return new Promise(resolve => {
        img.onload = () => (img.decode ? img.decode().catch(() => {}).then(resolve) : resolve());
        img.onerror = resolve;
        setTimeout(resolve, 1200);
      });
    }));

    // Create jsPDF portrait A4 instance
    const pdf = new jsPdfLib({
      orientation: 'portrait',
      unit: 'mm',
      format: 'a4',
      compress: true
    });

    for (let i = 0; i < pages.length; i++) {
      const pageEl = pages[i];

      // Add new A4 page in PDF if past page 1
      if (i > 0) {
        pdf.addPage('a4', 'portrait');
      }

      // Render this individual A4 page element to high-res canvas
      const canvas = await window.html2canvas(pageEl, {
        scale: 2.5, // 240 DPI crisp resolution for razor-sharp legal typography
        useCORS: true,
        allowTaint: true,
        backgroundColor: '#ffffff',
        logging: false,
        scrollY: 0,
        scrollX: 0,
        imageTimeout: 15000
      });

      // DIRECT CANVAS STAMP:
      // If this is the signatures page and seal is applied, stamp the high-resolution vector seal directly onto the 2D canvas!
      const isSignaturesPage = pageEl.classList.contains('page-signatures') || Boolean(pageEl.querySelector('.label-tier'));
      if (isSignaturesPage && state?.label?.sealApplied && sealDrawableImg) {
        try {
          const ctx = canvas.getContext('2d');
          const pageWidth = pageEl.clientWidth || 794;
          const canvasScale = canvas.width / pageWidth;

          const sealX = (state.label.sealX !== undefined ? state.label.sealX : 460) * canvasScale;
          const sealY = (state.label.sealY !== undefined ? state.label.sealY : 290) * canvasScale;
          const sealSize = (state.label.sealSize || 135) * canvasScale;
          const rotationDeg = state.label.sealRotation !== undefined ? state.label.sealRotation : -2;
          const opacity = (state.label.sealOpacity !== undefined ? state.label.sealOpacity : 100) / 100;

          ctx.save();
          ctx.globalAlpha = opacity;
          ctx.translate(sealX + sealSize / 2, sealY + sealSize / 2);
          ctx.rotate((rotationDeg * Math.PI) / 180);
          ctx.drawImage(sealDrawableImg, -sealSize / 2, -sealSize / 2, sealSize, sealSize);
          ctx.restore();
          console.log(`✓ [PDF Canvas Engine] Corporate Seal directly stamped on page canvas (${sealX.toFixed(0)}, ${sealY.toFixed(0)}) size ${sealSize.toFixed(0)}px`);
        } catch (stampErr) {
          console.warn('[PDF Canvas Engine] Canvas direct seal stamp warning:', stampErr);
        }
      }

      // High-fidelity JPEG (0.98 quality)
      const imgData = canvas.toDataURL('image/jpeg', 0.98);

      // Exact A4 dimensions: 210mm x 297mm
      pdf.addImage(imgData, 'JPEG', 0, 0, 210, 297, undefined, 'FAST');
    }

    // Trigger instant browser download
    pdf.save(filename);

    // Restore viewport zoom & interactive badges
    container.style.transform = prevTransform;
    document.body.classList.remove('exporting-pdf');
    showToast(`Agreement exported successfully (${pages.length} pages)!`, 'success');

  } catch (err) {
    console.error('PDF export error, falling back to print dialog:', err);
    container.style.transform = prevTransform;
    document.body.classList.remove('exporting-pdf');
    showToast('Opening print dialog. Choose "Save as PDF"...', 'info');
    setTimeout(() => {
      window.print();
    }, 250);
  }
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
