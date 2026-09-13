/**
 * Live A4 Document Renderer with Optimized Multi-Page Pagination
 * Page 1 accommodates up to 4 tracks comfortably before creating a continuation page.
 */

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
          Composition / Performance / Phonogram: <strong>${escapeHtml(fullTitle)}</strong>
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

  // Optimized Pagination:
  // Page 1: Banner + Preamble + Section 1 + Section 2 Header + Up to 4 Tracks
  // If > 4 tracks: Continuation page(s) hold up to 6 tracks each.
  // Final Page: Section 3 + Section 4 + Signatures.
  const PAGE_1_CAPACITY = 4;
  const CONTINUATION_CAPACITY = 6;

  const allTracks = state.tracks || [];
  const page1Tracks = allTracks.slice(0, PAGE_1_CAPACITY);
  const remainingTracks = allTracks.slice(PAGE_1_CAPACITY);

  const continuationPages = [];
  for (let i = 0; i < remainingTracks.length; i += CONTINUATION_CAPACITY) {
    continuationPages.push(remainingTracks.slice(i, i + CONTINUATION_CAPACITY));
  }

  // Total pages = Page 1 + (any continuation pages) + Final Signature page
  const totalPages = 1 + continuationPages.length + 1;

  // Build Signatures HTML depending on viewer mode (label | artist-sign | counter-sign)
  let labelSigHtml = '';
  if (state.label.signature) {
    const sig = state.label.signature;
    const canEditLabel = (mode === 'label' || mode === 'counter-sign') && !state.isArchivedInVault && state.status !== 'fully_executed';
    labelSigHtml = `
      <div class="doc-signature-box signed ${canEditLabel ? '' : 'locked-view'}" ${canEditLabel ? 'data-party="label"' : ''} title="${canEditLabel ? 'Click to re-draw or change signature' : 'Verified Obscura Rec LLC Signature'}">
        ${sig.type === 'type' 
          ? `<div class="rendered-typed-sig" style="font-family: '${sig.font || 'Great Vibes'}', cursive;">${escapeHtml(sig.data)}</div>`
          : `<img src="${sig.data}" class="rendered-sig-img" alt="Label Signature" />`
        }
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

  const isArtistLocked = Boolean(
    state.isLockedForArtist ||
    state.status === 'artist_signed' ||
    state.status === 'fully_executed' ||
    state.isArchivedInVault
  );

  let artistSigHtml = '';
  if (state.artist.signature) {
    const sig = state.artist.signature;
    // Signature remains fully editable/redrawable until submitted by artist or executed
    const canEditArtist = !isArtistLocked;
    artistSigHtml = `
      <div class="doc-signature-box signed ${canEditArtist ? '' : 'locked-view'}" ${canEditArtist ? 'data-party="artist"' : ''} title="${canEditArtist ? 'Click to re-draw or change signature' : 'Digitally Signed & Sealed'}">
        ${sig.type === 'type'
          ? `<div class="rendered-typed-sig" style="font-family: '${sig.font || 'Great Vibes'}', cursive;">${escapeHtml(sig.data)}</div>`
          : `<img src="${sig.data}" class="rendered-sig-img" alt="Artist Signature" />`
        }
      </div>
    `;
  } else {
    artistSigHtml = `
      <div class="doc-signature-box clickable-sign-prompt ${mode === 'artist-sign' ? 'artist-required-pulse' : ''}" data-party="artist" title="Click to Sign as Artist">
        <div class="sign-underline-placeholder"></div>
        <span class="sign-btn-tag ${mode === 'artist-sign' ? 'artist-action-tag' : ''}">${mode === 'artist-sign' ? '✍️ Click to Sign (Required)' : '✍️ Click to Sign'}</span>
      </div>
    `;
  }

  const termYears = state.terms.termYears || 10;
  const renewalYears = state.terms.renewalYears || 10;
  const noticeDays = state.terms.noticeDays || 30;

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
        <span>Ref ID: ${escapeHtml(state.id)}</span>
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

  // Render Final Page (Section 3, Section 4, Signatures)
  const finalPageNum = totalPages;
  pagesHtml += `
    <!-- ================= FINAL SIGNATURES PAGE ================= -->
    <section class="a4-page page-signatures" id="doc-page-${finalPageNum}">
      <div class="page-2-content">
        <div class="doc-section">
          <div class="doc-section-title">3. TERM & RENEWAL</div>
          <ul class="doc-bullets">
            <li>
              The term of the exclusive license for the Objects transferred under this Act shall be 
              <strong>[${termYears}] years</strong> from the date of execution of this Act.
            </li>
            <li>
              The term shall automatically extend for successive periods of 
              <strong>[${renewalYears}] years</strong>, unless either Party provides written notice 
              of non-renewal at least <strong>${noticeDays} days</strong> prior to the expiration 
              of the initial or any extended term.
            </li>
          </ul>
        </div>

        <div class="doc-section">
          <div class="doc-section-title">4. SOURCE MATERIALS & DELIVERY</div>
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

        <!-- Signatures Section -->
        <div class="doc-signatures-section">
          <div class="doc-signatures-title-wrap">
            <div class="doc-signatures-line"></div>
            <div class="doc-signatures-title">SIGNATURES OF THE PARTIES</div>
            <div class="doc-signatures-line"></div>
          </div>
          
          <div class="doc-signatures-grid">
            <!-- Column 1: For the Label -->
            <div class="doc-sig-col label-col">
              <div class="doc-party-header">
                <div class="party-role-tag">For and On Behalf of Label</div>
                <div class="party-entity-name">OBSCURA REC LLC</div>
              </div>
              
              <div class="doc-sig-line-container">
                ${labelSigHtml}
                <div class="doc-sig-caption">
                  <span>Authorized Representative</span>
                </div>
              </div>

              <div class="sig-meta-grid">
                <div class="sig-meta-row">
                  <span class="sig-meta-label">BY:</span>
                  <span class="sig-meta-val">${escapeHtml(labelRep)}</span>
                </div>
                <div class="sig-meta-row">
                  <span class="sig-meta-label">TITLE:</span>
                  <span class="sig-meta-val">${escapeHtml(labelTitle)}</span>
                </div>
                <div class="sig-meta-row">
                  <span class="sig-meta-label">DATE:</span>
                  <span class="sig-meta-val">${escapeHtml(agreementDate)}</span>
                </div>
              </div>
            </div>

            <!-- Vertical Divider -->
            <div class="doc-sig-divider"></div>

            <!-- Column 2: For the Artist(s) -->
            <div class="doc-sig-col artist-col">
              <div class="doc-party-header">
                <div class="party-role-tag">For and On Behalf of Artist</div>
                <div class="party-entity-name">${escapeHtml(artistStage || artistLegal || 'RECORDING ARTIST')}</div>
              </div>
              
              <div class="doc-sig-line-container">
                ${artistSigHtml}
                <div class="doc-sig-caption">
                  <span>Artist / Grantor Signature</span>
                </div>
              </div>

              <div class="sig-meta-grid">
                <div class="sig-meta-row">
                  <span class="sig-meta-label">LEGAL NAME:</span>
                  <span class="sig-meta-val">${escapeHtml(artistLegal)}</span>
                </div>
                <div class="sig-meta-row">
                  <span class="sig-meta-label">STAGE NAME:</span>
                  <span class="sig-meta-val">${escapeHtml(artistStage)}</span>
                </div>
                <div class="sig-meta-row">
                  <span class="sig-meta-label">DATE:</span>
                  <span class="sig-meta-val">${escapeHtml(artistDate)}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="page-number-footer">
        <span>Ref ID: ${escapeHtml(state.id)} • Obscura Rec LLC</span>
        <span>Page ${finalPageNum} of ${totalPages}</span>
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
    const sigBoxes = container.querySelectorAll('.doc-signature-box');
    sigBoxes.forEach(box => {
      box.addEventListener('click', () => {
        const party = box.dataset.party;
        onSignClick(party);
      });
    });
  }
}
