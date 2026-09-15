/**
 * Live A4 Document Renderer with Optimized Multi-Page Pagination
 * Page 1 accommodates up to 4 tracks comfortably before creating a continuation page.
 */
import { getOrSynthesizeAuditTrail } from './agreement-data.js';

export function renderDocument(state, container, onSignClick, mode = 'label') {
  if (!container) return;

  const escapeHtml = (str) => {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  };

  const labelRep = (state.label.representative && state.label.representative.trim()) || '[Your Legal Name]';
  const labelTitle = (state.label.representativeTitle && state.label.representativeTitle.trim()) || 'Director / Founder, Obscura Rec LLC';
  const artistLegal = (state.artist.legalName && state.artist.legalName.trim()) || '[Artist Legal Name]';
  const artistStage = (state.artist.stageName && state.artist.stageName.trim()) || '[Artist Alias]';
  const agreementDate = state.label.date || '[Date]';
  const artistDate = state.artist.date || agreementDate;

  // Helper to render an individual track item
  const renderTrackItem = (track) => {
    const rawTitle = (track.title && track.title.trim()) || '[Track Name]';
    const fullTitle = track.versionTag ? `${rawTitle} ${track.versionTag}` : rawTitle;
    const royaltyText = `${artistStage} - [${track.royaltyShare || 50}]% of Label Net Income`;
    const musicAuthor = (track.musicAuthors && track.musicAuthors.trim()) || '[Producer Names]';
    const lyricsAuthor = (track.lyricsAuthors && track.lyricsAuthors.trim()) || '[Lyricist Names]';
    const phonogramProducer = (track.phonogramProducers && track.phonogramProducers.trim()) || '[Producer Names]';
    const transferDate = track.transferDate || agreementDate;

    return `
      <li class="doc-track-item">
        <div class="doc-track-header">
          Composition / Performance: <strong>${escapeHtml(fullTitle)}</strong>
        </div>
        <ul class="doc-track-sublist">
          <li class="doc-track-subitem">Year: <strong>${escapeHtml(track.year || '2026')}</strong></li>
          <li class="doc-track-subitem">Author(s) of Music: <strong>${escapeHtml(musicAuthor)}</strong></li>
          <li class="doc-track-subitem">Author(s) of Lyrics: <strong>${escapeHtml(lyricsAuthor)}</strong></li>
          <li class="doc-track-subitem">Producer(s): <strong>${escapeHtml(phonogramProducer)}</strong></li>
          <li class="doc-track-subitem">Performer(s) & Royalty Share: <strong>${escapeHtml(royaltyText)}</strong></li>
          <li class="doc-track-subitem">Date of Transfer: <strong>${escapeHtml(transferDate)}</strong></li>
        </ul>
      </li>
    `;
  };

  const artistsList = (Array.isArray(state.artists) && state.artists.length > 0)
    ? state.artists
    : [{ id: 'art-1', role: 'Recording Artist', ...(state.artist || {}) }];

  // Optimized Pagination:
  // Page 1: Banner + Preamble + Section 1 + Section 2 Header + Up to 4 Tracks
  // If > 4 tracks: Continuation page(s) hold up to 6 tracks each.
  // Main Terms & Signatures Page: Section 3 + Section 4 + Record Label + up to 4 Artists.
  // If > 4 artists: Any additional artists (Artist 5, 6, 7...) cleanly overflow to a continuation signature page.
  const PAGE_1_CAPACITY = 4;
  const CONTINUATION_CAPACITY = 6;
  const PAGE_2_ARTIST_CAPACITY = 4;
  const CONT_SIGNATURE_CAPACITY = 7;

  const allTracks = state.tracks || [];
  const page1Tracks = allTracks.slice(0, PAGE_1_CAPACITY);
  const remainingTracks = allTracks.slice(PAGE_1_CAPACITY);

  const continuationPages = [];
  for (let i = 0; i < remainingTracks.length; i += CONTINUATION_CAPACITY) {
    continuationPages.push(remainingTracks.slice(i, i + CONTINUATION_CAPACITY));
  }

  const page2Artists = artistsList.slice(0, PAGE_2_ARTIST_CAPACITY);
  const overflowArtists = artistsList.slice(PAGE_2_ARTIST_CAPACITY);

  const artistContinuationPages = [];
  for (let i = 0; i < overflowArtists.length; i += CONT_SIGNATURE_CAPACITY) {
    artistContinuationPages.push(overflowArtists.slice(i, i + CONT_SIGNATURE_CAPACITY));
  }

  // Total pages = Page 1 + (any track continuation pages) + Main Terms & Signatures Page + (any artist continuation pages) + Certificate of Completion / Audit Trail Page
  const totalPages = 1 + continuationPages.length + 1 + artistContinuationPages.length + 1;
  const auditPageNum = totalPages;

  // Build Signatures HTML depending on viewer mode (label | artist-sign | counter-sign)
  let labelSigHtml = '';
  if (state.label.signature) {
    const sig = state.label.signature;
    const canEditLabel = (mode === 'label' || mode === 'counter-sign');
    labelSigHtml = `
      <div class="doc-signature-box signed ${canEditLabel ? '' : 'locked-view'}" ${canEditLabel ? 'data-party="label"' : ''} title="${canEditLabel ? 'Click to re-draw or change signature' : 'Verified Obscura Rec LLC Signature'}">
        ${sig.type === 'type' 
          ? `<div class="rendered-typed-sig" style="font-family: '${sig.font || 'Great Vibes'}', cursive;">${escapeHtml(sig.data)}</div>`
          : `<img src="${sig.data}" class="rendered-sig-img" alt="Label Signature" />`
        }
        ${canEditLabel ? `
          <span class="sig-redraw-badge no-print" title="Click to re-draw or change signature">✏️ Re-draw</span>
        ` : ''}
      </div>
    `;
  } else {
    if (mode === 'artist-sign') {
      // In Artist mode, the label signature cannot be edited by the artist
      labelSigHtml = `
        <div class="doc-signature-box locked-prompt" title="Pending Obscura Rec LLC signature">
          <div class="sign-underline-placeholder"></div>
          <span style="font-size:11px; color:#6b7280; font-style:italic;">(Pending Label Execution)</span>
        </div>
      `;
    } else {
      labelSigHtml = `
        <div class="doc-signature-box clickable-sign-prompt ${mode === 'counter-sign' ? 'counter-sign-pulse' : ''}" data-party="label" title="Click to Sign as Label">
          <div class="sign-underline-placeholder"></div>
          <span class="sign-btn-tag">${mode === 'counter-sign' ? '✍️ Counter-Sign as Label' : '✍️ Click to Sign'}</span>
        </div>
      `;
    }
  }

  // Current active signer in artist mode (e.g. ?mode=artist-sign&id=...&signer=art-1)
  const currentSignerId = (() => {
    if (typeof window !== 'undefined' && window.location?.search) {
      const p = new URLSearchParams(window.location.search);
      const s = p.get('signer');
      if (s) return s;
    }
    return state.artists?.[0]?.id || 'art-1';
  })();

  const isGlobalLocked = Boolean(state.status === 'fully_executed');

  const renderArtistSigRow = (artist, index) => {
    const isThisSigner = (mode !== 'artist-sign') || (currentSignerId === artist.id);
    const hasSig = Boolean(artist.signature);
    const canEdit = isThisSigner && !isGlobalLocked && (mode !== 'counter-sign') && !hasSig;

    let boxHtml = '';
    const isThisSubmitted = Boolean(artist.submitted === true || (artist.status === 'signed' && artist.signedAt));
    const allowReSign = (mode === 'label') ||
                        (mode === 'artist-sign' && isThisSigner && !isGlobalLocked && !isThisSubmitted);

    const signerDisplayName = (artist.stageName && artist.stageName.trim())
      ? artist.stageName.trim()
      : ((artist.legalName && artist.legalName.trim()) || `Artist ${index + 1}`);

    if (hasSig) {
      const sig = artist.signature;
      boxHtml = `
        <div class="doc-signature-box signed ${allowReSign ? '' : 'locked-view'}" 
             ${allowReSign ? `data-party="artist" data-artist-id="${escapeHtml(artist.id)}"` : ''} 
             title="${allowReSign ? 'Click to re-draw or change signature' : `Digitally Signed by ${escapeHtml(signerDisplayName)}`}">
          ${sig.type === 'type'
            ? `<div class="rendered-typed-sig" style="font-family: '${sig.font || 'Great Vibes'}', cursive;">${escapeHtml(sig.data)}</div>`
            : `<img src="${sig.data}" class="rendered-sig-img" alt="Artist Signature" onerror="this.style.display='none';" />`
          }
          ${allowReSign ? `
            <span class="sig-redraw-badge no-print" title="Click to re-draw or change signature">✏️ Re-draw</span>
          ` : ''}
        </div>
      `;
    } else {
      if (mode === 'artist-sign') {
        if (isThisSigner) {
          boxHtml = `
            <div class="doc-signature-box clickable-sign-prompt artist-required-pulse" 
                 data-party="artist" data-artist-id="${escapeHtml(artist.id)}" 
                 title="Click to Sign as ${escapeHtml(signerDisplayName)}">
              <div class="sign-underline-placeholder"></div>
              <span class="sign-btn-tag artist-action-tag">✍️ Click to Sign (Required)</span>
            </div>
          `;
        } else {
          boxHtml = `
            <div class="doc-signature-box locked-prompt" title="Pending signature from ${escapeHtml(signerDisplayName)}">
              <div class="sign-underline-placeholder"></div>
              <span style="font-size:11px; color:#6b7280; font-style:italic;">(Pending ${escapeHtml(signerDisplayName)} Signature)</span>
            </div>
          `;
        }
      } else {
        boxHtml = `
          <div class="doc-signature-box clickable-sign-prompt ${mode === 'counter-sign' ? 'locked-prompt' : ''}" 
               ${mode !== 'counter-sign' ? `data-party="artist" data-artist-id="${escapeHtml(artist.id)}"` : ''} 
               title="Click to Sign as ${escapeHtml(signerDisplayName)}">
            <div class="sign-underline-placeholder"></div>
            <span class="sign-btn-tag">${mode === 'counter-sign' ? '⏳ Pending Artist' : '✍️ Click to Sign'}</span>
          </div>
        `;
      }
    }

    const roleTag = artist.role || (index === 0 ? 'Recording Artist' : 'Collaborator / Featured Artist');
    // Header entity name displays Artist Name (Stage Alias)
    const entityName = (artist.stageName && artist.stageName.trim()) 
      ? artist.stageName.trim() 
      : '[Artist Alias]';
    const signDate = artist.date || (hasSig ? artist.signature.timestamp?.split(',')[0] : agreementDate);

    return `
      <div class="doc-sig-row-full artist-row" data-artist-id="${escapeHtml(artist.id)}">
        <div class="sig-row-info-col">
          <div class="doc-party-header-inline">
            <div class="party-role-tag">FOR AND ON BEHALF OF ${escapeHtml(roleTag)}:</div>
            <div class="party-entity-name">${escapeHtml(entityName)}</div>
          </div>
          <div class="sig-meta-horizontal">
            <div class="sig-meta-item">
              <span class="sig-meta-label">LEGAL NAME:</span>
              <span class="sig-meta-val">${escapeHtml((artist.legalName && artist.legalName.trim()) || '[Artist Legal Name]')}</span>
            </div>
            <div class="sig-meta-item">
              <span class="sig-meta-label">STAGE NAME:</span>
              <span class="sig-meta-val">${escapeHtml((artist.stageName && artist.stageName.trim()) || '[Artist Alias]')}</span>
            </div>
            <div class="sig-meta-item">
              <span class="sig-meta-label">DATE:</span>
              <span class="sig-meta-val">${escapeHtml(signDate)}</span>
            </div>
          </div>
        </div>

        <div class="sig-row-sign-col">
          <div class="doc-sig-line-container">
            ${boxHtml}
            <div class="doc-sig-caption">
              <span>${escapeHtml(artist.role || 'Artist')} Signature</span>
            </div>
            ${(hasSig && allowReSign) ? `
              <div class="sig-redraw-hint no-print" data-party="artist" data-artist-id="${escapeHtml(artist.id)}" title="Click to re-draw or change signature">
                <span class="sig-redraw-hint-text">✏️ Click to re-draw / edit</span>
              </div>
            ` : ''}
          </div>
        </div>
      </div>
    `;
  };

  const termYearsRaw = state.terms && state.terms.termYears;
  const termYearsEdited = Boolean(state.terms && state.terms.termYearsEdited);
  const termYearsDisplay = termYearsEdited
    ? ((termYearsRaw !== '' && termYearsRaw !== null && termYearsRaw !== undefined) ? escapeHtml(String(termYearsRaw).trim()) : '10')
    : `[${escapeHtml(String(termYearsRaw !== '' && termYearsRaw !== null && termYearsRaw !== undefined ? termYearsRaw : 10).trim())}]`;

  const renewalYearsRaw = state.terms && state.terms.renewalYears;
  const renewalYearsEdited = Boolean(state.terms && state.terms.renewalYearsEdited);
  const renewalYearsDisplay = renewalYearsEdited
    ? ((renewalYearsRaw !== '' && renewalYearsRaw !== null && renewalYearsRaw !== undefined) ? escapeHtml(String(renewalYearsRaw).trim()) : '10')
    : `[${escapeHtml(String(renewalYearsRaw !== '' && renewalYearsRaw !== null && renewalYearsRaw !== undefined ? renewalYearsRaw : 10).trim())}]`;

  const noticeDays = (state.terms && state.terms.noticeDays) || 30;

  // Render Page 1 HTML
  let pagesHtml = `
    <!-- ================= PAGE 1 ================= -->
    <section class="a4-page page-1" id="doc-page-1">
      <!-- Top Banner Header -->
      <header class="doc-header-banner">
        <div class="doc-header-titles">
          <h1 class="doc-header-title">ACT OF ACCEPTANCE AND</h1>
          <h2 class="doc-header-subtitle">TRANSFER OF OBJECTS</h2>
          <div class="doc-header-label-name">OBSCURA REC LLC</div>
        </div>
        <div class="doc-header-brand">
          <img src="./assets/ocr-logo.jpeg" alt="Obscura Rec LLC" class="doc-logo-img" />
          <span class="doc-brand-text">Obscura Rec LLC</span>
        </div>
      </header>

      <!-- Document Content -->
      <div class="doc-content">
        <div class="doc-preamble">
          <strong>Obscura Rec LLC</strong>, represented by <strong>${escapeHtml(labelRep)}</strong>, 
          hereinafter referred to as the "Label", on the one hand, and the person(s) listed in 
          Table 1 below (hereinafter referred to as the "Artist" / "Artists"), on the other hand.
        </div>

        <div class="doc-section">
          <div class="doc-section-title">1. TRANSFER OF RIGHTS</div>
          <p class="doc-section-body">
            The Artist(s), under the terms and conditions of the Agreement entered into, hereby transfers to the Label 
            all rights to the sound recordings, musical works, and performances specified 
            (hereinafter referred to as the "Objects").
          </p>
        </div>

        <div class="doc-section">
          <div class="doc-section-title">2. OBJECTS</div>
          <div class="doc-section-subtitle">Objects Delivered & Royalty Allocation</div>
          <ul class="doc-track-list">
            ${page1Tracks.map(renderTrackItem).join('')}
          </ul>
        </div>
      </div>

      <div class="page-number-footer">
        <span>Ref ID: ${escapeHtml(state.id)} • Obscura Rec LLC</span>
        <span>Page 1 of ${totalPages}</span>
      </div>
    </section>
  `;

  // Render Any Continuation Pages (only if > 4 tracks exist)
  continuationPages.forEach((chunk, idx) => {
    const pageNum = 2 + idx;
    pagesHtml += `
      <!-- ================= CONTINUATION PAGE ${pageNum} ================= -->
      <section class="a4-page page-continuation" id="doc-page-${pageNum}">
        <div class="doc-continuation-header">
          <div class="doc-continuation-header-brand">
            <img src="./assets/ocr-logo.jpeg" alt="Obscura Rec LLC" />
            <span>OBSCURA REC LLC • ACT OF ACCEPTANCE AND TRANSFER OF OBJECTS</span>
          </div>
          <span>SCHEDULE OF OBJECTS</span>
        </div>

        <div class="page-2-content" style="padding-top: 24px;">
          <div class="doc-section">
            <div class="doc-section-title">2. OBJECTS (CONTINUED)</div>
            <div class="doc-section-subtitle">Delivered Sound Recordings & Royalty Allocation (Continued)</div>
            <ul class="doc-track-list">
              ${chunk.map(renderTrackItem).join('')}
            </ul>
          </div>
        </div>

        <div class="page-number-footer">
          <span>Ref ID: ${escapeHtml(state.id)} • Obscura Rec LLC</span>
          <span>Page ${pageNum} of ${totalPages}</span>
        </div>
      </section>
    `;
  });

  // Render Main Terms & Signatures Page (Section 3 + Section 4 + Label + up to 4 Artists)
  const mainSignaturesPageNum = 2 + continuationPages.length;
  pagesHtml += `
    <!-- ================= MAIN TERMS & SIGNATURES PAGE ================= -->
    <section class="a4-page page-signatures" id="doc-page-${mainSignaturesPageNum}">
      <div class="page-2-content">
        <div class="doc-section">
          <div class="doc-section-title">3. TERM &amp; RENEWAL</div>
          <ul class="doc-bullets">
            <li>
              The term of the exclusive license for the Objects transferred under this Act shall be 
              <strong>${termYearsDisplay} years</strong> from the date of execution of this Act.
            </li>
            <li>
              The term shall automatically extend for successive periods of 
              <strong>${renewalYearsDisplay} years</strong>, unless either Party provides written notice 
              of non-renewal at least <strong>${noticeDays} days</strong> prior to the expiration 
              of the current term.
            </li>
          </ul>
        </div>

        <div class="doc-section">
          <div class="doc-section-title">4. DELIVERY &amp; ACCEPTANCE</div>
          <ul class="doc-bullets">
            <li>
              The Parties confirm that the Artist(s) has delivered the master audio files, stems, 
              and related metadata to the Label via electronic transfer.
            </li>
            <li>
              The technical quality of the delivered source materials satisfies all technical 
              requirements set forth by the Label.
            </li>
          </ul>
        </div>

        <!-- Signatures Section - Distinct Two-Tier Legal Execution Layout -->
        <div class="doc-signatures-section">
          <div class="doc-signatures-title-wrap">
            <div class="doc-signatures-line"></div>
            <div class="doc-signatures-title">SIGNATURES &amp; EXECUTION</div>
            <div class="doc-signatures-line"></div>
          </div>
          
          <!-- RECORD LABEL (OBSCURA REC LLC) SEPARATE EXECUTION BLOCK -->
          <div class="doc-sig-block-tier label-tier">
            <div class="doc-tier-header">
              <div class="doc-tier-title">RECORD LABEL EXECUTION: OBSCURA REC LLC</div>
              <div class="doc-tier-sub">Official Corporate Sign-off</div>
            </div>

            <div class="doc-sig-row-full label-row" data-party="label">
              <div class="sig-row-info-col">
                <div class="doc-party-header-inline">
                  <div class="party-role-tag">FOR AND ON BEHALF OF RECORD LABEL:</div>
                  <div class="party-entity-name">OBSCURA REC LLC</div>
                </div>
                <div class="sig-meta-horizontal">
                  <div class="sig-meta-item">
                    <span class="sig-meta-label">AUTHORIZED BY:</span>
                    <span class="sig-meta-val">${escapeHtml(labelRep)}</span>
                  </div>
                  <div class="sig-meta-item">
                    <span class="sig-meta-label">TITLE:</span>
                    <span class="sig-meta-val">${escapeHtml(labelTitle)}</span>
                  </div>
                  <div class="sig-meta-item">
                    <span class="sig-meta-label">DATE:</span>
                    <span class="sig-meta-val">${escapeHtml(agreementDate)}</span>
                  </div>
                </div>
              </div>

              <div class="sig-row-sign-col">
                <div class="doc-sig-line-container">
                  ${labelSigHtml}
                  <div class="doc-sig-caption">
                    <span>Authorized Representative Signature</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- SPACIOUS LEGAL SEPARATION DIVIDER -->
          <div class="doc-sig-tier-divider">
            <div class="tier-divider-line"></div>
            <span class="tier-divider-label">✦ INDEPENDENT PARTY EXECUTION ✦</span>
            <div class="tier-divider-line"></div>
          </div>

          <!-- ARTISTS & CONTRIBUTORS SEPARATE EXECUTION BLOCK -->
          <div class="doc-sig-block-tier artists-tier">
            <div class="doc-tier-header">
              <div class="doc-tier-title">RECORDING ARTIST(S) &amp; CONTRIBUTORS EXECUTION</div>
              <div class="doc-tier-sub">${artistsList.length} Executing ${artistsList.length === 1 ? 'Party' : 'Parties'}</div>
            </div>

            <div class="doc-signatures-list-rows">
              ${page2Artists.map(renderArtistSigRow).join('')}
            </div>
          </div>
        </div>
      </div>

      ${state.label?.sealApplied && state.label?.sealFile ? `
        <!-- INTERACTIVE DRAGGABLE & RESIZABLE OFFICIAL CORPORATE SEAL (ALWAYS ON TOP OF SIGNATURES & CONTENT) -->
        <div 
          class="draggable-corporate-seal" 
          id="draggable-corporate-seal"
          title="Drag to position anywhere on agreement • Drag bottom-right corner to resize"
          style="
            left: ${state.label.sealX !== undefined ? state.label.sealX : 460}px;
            top: ${state.label.sealY !== undefined ? state.label.sealY : 290}px;
            width: ${state.label.sealSize || 135}px;
            height: ${state.label.sealSize || 135}px;
            opacity: ${(state.label.sealOpacity !== undefined ? state.label.sealOpacity : 100) / 100};
            transform: rotate(${state.label.sealRotation !== undefined ? state.label.sealRotation : -2}deg);
            z-index: 999999;
          "
        >
          <img src="./assets/seals/${escapeHtml(state.label.sealFile)}" alt="Official Corporate Seal" draggable="false" />
          <div class="seal-drag-overlay">
            <div class="seal-drag-badge no-print">✋ Drag</div>
            <div class="seal-resize-handle no-print" title="Drag to Resize Seal"></div>
          </div>
        </div>
      ` : ''}

      <div class="page-number-footer">
        <span>Ref ID: ${escapeHtml(state.id)} • Obscura Rec LLC</span>
        <span>Page ${mainSignaturesPageNum} of ${totalPages}</span>
      </div>
    </section>
  `;

  // Render Any Overflow Artist Continuation Pages (Artist 5, 6, 7...)
  artistContinuationPages.forEach((contArtists, idx) => {
    const contPageNum = mainSignaturesPageNum + 1 + idx;
    pagesHtml += `
      <!-- ================= ARTIST SIGNATURES CONTINUATION PAGE ${contPageNum} ================= -->
      <section class="a4-page page-signatures page-execution" id="doc-page-${contPageNum}">
        <div class="doc-continuation-header">
          <div class="doc-continuation-header-brand">
            <img src="./assets/ocr-logo.jpeg" alt="Obscura Rec LLC" />
            <span>OBSCURA REC LLC • ACT OF ACCEPTANCE AND TRANSFER OF OBJECTS</span>
          </div>
          <span>SIGNATURES &amp; EXECUTION (CONTINUED)</span>
        </div>

        <div class="page-2-content" style="padding-top: 24px;">
          <div class="doc-signatures-section" style="margin-top: 0;">
            <div class="doc-signatures-title-wrap">
              <div class="doc-signatures-line"></div>
              <div class="doc-signatures-title">SIGNATURES &amp; EXECUTION (CONTINUED)</div>
              <div class="doc-signatures-line"></div>
            </div>

            <!-- ARTISTS & CONTRIBUTORS CONTINUATION BLOCK -->
            <div class="doc-sig-block-tier artists-tier">
              <div class="doc-tier-header">
                <div class="doc-tier-title">RECORDING ARTIST(S) &amp; CONTRIBUTORS EXECUTION (CONTINUED)</div>
                <div class="doc-tier-sub">${artistsList.length} Executing Parties (Schedule Continued)</div>
              </div>

              <div class="doc-signatures-list-rows">
                ${contArtists.map(renderArtistSigRow).join('')}
              </div>
            </div>
          </div>
        </div>

        <div class="page-number-footer">
          <span>Ref ID: ${escapeHtml(state.id)} • Obscura Rec LLC</span>
          <span>Page ${contPageNum} of ${totalPages}</span>
        </div>
      </section>
    `;
  });

  // Get synthesized or active audit trail events
  const auditEvents = getOrSynthesizeAuditTrail(state);

  const isFullySigned = Boolean(state.label?.signature) && (
    Array.isArray(state.artists) 
      ? state.artists.every(a => Boolean(a.signature))
      : Boolean(state.artist?.signature)
  );
  const statusLabel = isFullySigned 
    ? 'COMPLETED &amp; EXECUTED' 
    : (state.label?.signature || (state.artists && state.artists.some(a => a.signature)) ? 'IN PROGRESS (PARTIALLY EXECUTED)' : 'ACTIVE DRAFT (EXECUTION PENDING)');
  const statusBadgeClass = isFullySigned ? 'status-completed' : 'status-in-progress';

  // Clean deduplicated repertoire summary
  const uniqueTitles = [...new Set(allTracks.map(t => (t.title && t.title.trim()) || 'Untitled Track'))];
  const trackSummaryStr = uniqueTitles.length > 0
    ? (uniqueTitles.length === 1 && allTracks.length > 1
        ? `${uniqueTitles[0]} (${allTracks.length} Tracks)`
        : uniqueTitles.slice(0, 2).join(', ') + (uniqueTitles.length > 2 ? ` + ${allTracks.length - 2} more` : ` (${allTracks.length} Track${allTracks.length > 1 ? 's' : ''})`))
    : 'No Tracks Listed';

  // Render Certificate of Completion & Digital Audit Trail Page
  pagesHtml += `
    <!-- ================= CERTIFICATE OF COMPLETION & DIGITAL AUDIT TRAIL PAGE ================= -->
    <section class="a4-page page-audit-certificate" id="doc-page-${auditPageNum}">
      <div class="audit-page-inner">
        <!-- Top Classic Brand Header -->
        <div class="classic-audit-header">
          <div class="classic-audit-brand">
            <img src="./assets/ocr-logo.jpeg" alt="Obscura Rec LLC" class="classic-audit-logo" />
            <div class="classic-brand-text">
              <h1 class="classic-audit-title">OBSCURA REC LLC</h1>
              <div class="classic-audit-subtitle">CERTIFICATE OF COMPLETION &amp; AUDIT TRAIL</div>
            </div>
          </div>
          <div class="classic-audit-meta">
            <div class="classic-status-tag ${statusBadgeClass}">
              <span class="status-dot"></span> ${statusLabel}
            </div>
            <div class="classic-envelope-id">Envelope ID: <span class="font-mono">${escapeHtml(state.id)}</span></div>
          </div>
        </div>

        <div class="classic-divider"></div>

        <!-- Clean 2-Column Structured Metadata Summary -->
        <div class="classic-summary-section">
          <div class="classic-summary-grid">
            <div class="summary-item">
              <span class="s-label">Document Title:</span>
              <span class="s-val">Act of Acceptance and Transfer of Objects</span>
            </div>
            <div class="summary-item">
              <span class="s-label">Envelope Ref:</span>
              <span class="s-val font-mono">${escapeHtml(state.id)}</span>
            </div>
            <div class="summary-item">
              <span class="s-label">Repertoire / Work:</span>
              <span class="s-val">${escapeHtml(trackSummaryStr)}</span>
            </div>
            <div class="summary-item">
              <span class="s-label">Record Label:</span>
              <span class="s-val">Obscura Rec LLC (Colombo, LK)</span>
            </div>
            <div class="summary-item">
              <span class="s-label">Executing Parties:</span>
              <span class="s-val">${artistsList.length} Artist(s) • ${parseInt(state.label?.cooperatingCount, 10) === 2 ? '2 Labels' : (parseInt(state.label?.cooperatingCount, 10) === 3 ? '3 Labels' : '1 Label')}</span>
            </div>
            <div class="summary-item">
              <span class="s-label">Corporate Seal:</span>
              <span class="s-val ${state.label?.sealApplied ? 'seal-status-sealed' : ''}">${state.label?.sealApplied ? 'Sealed' : 'Unsealed'}</span>
            </div>
          </div>
        </div>

        <!-- Section Heading -->
        <div class="classic-section-header">
          <span class="classic-section-title">DOCUMENT EXECUTION AUDIT TRAIL</span>
          <span class="classic-event-count">${auditEvents.length} Events Recorded</span>
        </div>

        <!-- Classic Legal Execution Table -->
        <div class="classic-table-wrapper">
          <table class="classic-audit-table">
            <thead>
              <tr>
                <th style="width: 32px; text-align: center;">#</th>
                <th style="width: 32%;">Event / Action</th>
                <th style="width: 36%;">Signatory / Capacity</th>
                <th style="width: 22%;">Timestamp (UTC)</th>
                <th style="width: 10%; text-align: right;">Status</th>
              </tr>
            </thead>
            <tbody>
              ${auditEvents.map((evt, idx) => `
                <tr>
                  <td class="col-num">${idx + 1}</td>
                  <td class="col-event"><strong>${escapeHtml(evt.title)}</strong></td>
                  <td class="col-actor">
                    ${escapeHtml(evt.actor)}
                    <span class="col-role">— ${escapeHtml(evt.role)}</span>
                  </td>
                  <td class="col-time font-mono">${escapeHtml(evt.displayTime || evt.timestamp)}</td>
                  <td class="col-status">
                    <span class="col-status-text">✓ ${escapeHtml(evt.status || 'Recorded')}</span>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>

        <!-- Legal Compliance Notice (Sri Lanka Electronic Transactions Act, No. 19 of 2006) -->
        <div class="classic-legal-notice">
          <strong>LEGAL NOTICE:</strong> Conclusive electronic execution record pursuant to the Electronic Transactions Act, No. 19 of 2006 (Sri Lanka). All electronic signatures and corporate seals applied herein carry full legal validity and admissibility.
        </div>

        <!-- Page Number Footer -->
        <div class="page-number-footer">
          <span>Ref ID: ${escapeHtml(state.id)} • Obscura Rec LLC</span>
          <span>Page ${auditPageNum} of ${totalPages}</span>
        </div>
      </div>
    </section>
  `;

  container.innerHTML = `
    <div class="document-pages-wrapper" id="printable-document">
      ${pagesHtml}
    </div>
  `;

  // Bind interactive signature clicks on the document
  if (onSignClick) {
    const clickableElements = container.querySelectorAll('.doc-signature-box[data-party], .sig-redraw-hint[data-party]');
    clickableElements.forEach(el => {
      el.addEventListener('click', () => {
        const party = el.dataset.party;
        const artistId = el.dataset.artistId || null;
        onSignClick(party, artistId);
      });
    });
  }
}
