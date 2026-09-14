/**
 * Agreement State Management & Data Presets for Obscura Rec LLC
 */

import {
  saveAgreementToFirebase,
  getAgreementFromFirebase,
  listenToAgreement,
  updateVaultIfArchived
} from './firebase-config.js';

const STORAGE_KEY = 'obscura_rec_agreement_data';
const TEMPLATES_KEY = 'obscura_rec_saved_templates';

export function getDefaultAgreementState() {
  const today = new Date().toISOString().split('T')[0];

  const primaryArtist = {
    id: 'art-1',
    role: 'Recording Artist',
    legalName: '', // when empty, displays [Artist Legal Name]
    stageName: '', // when empty, displays [Artist Alias]
    email: '',
    signature: null,
    date: today,
    status: 'pending'
  };

  return {
    id: 'OBS-AGR-' + Math.random().toString(36).substring(2, 8).toUpperCase(),
    createdAt: today,
    label: {
      companyName: 'Obscura Rec LLC',
      representative: '', // when empty, displays [Your Legal Name]
      representativeTitle: 'Director / Founder, Obscura Rec LLC',
      signature: null,
      date: today
    },
    artist: {
      legalName: '', // when empty, displays [Artist Legal Name]
      stageName: '', // when empty, displays [Artist Alias]
      email: '',
      signature: null,
      date: today
    },
    artists: [
      { ...primaryArtist }
    ],
    terms: {
      termYears: 10,
      renewalYears: 10,
      noticeDays: 30,
      termYearsEdited: false,
      renewalYearsEdited: false
    },
    delivery: {
      masterDelivered: true,
      technicalSatisfied: true
    },
    tracks: [
      {
        id: 'trk-1',
        title: '', // when empty, displays [Track Name]
        versionTag: '',
        year: '2026',
        musicAuthors: '', // [Producer Names]
        lyricsAuthors: '', // [Lyricist Names]
        phonogramProducers: '', // [Producer Names]
        royaltyShare: 50,
        royaltyDetails: '[50]% of Label Net Income',
        transferDate: today
      },
      {
        id: 'trk-2',
        title: '',
        versionTag: '(Slowed)',
        year: '2026',
        musicAuthors: '',
        lyricsAuthors: '',
        phonogramProducers: '',
        royaltyShare: 50,
        royaltyDetails: '[50]% of Label Net Income',
        transferDate: today
      },
      {
        id: 'trk-3',
        title: '',
        versionTag: '(Sped Up)',
        year: '2026',
        musicAuthors: '',
        lyricsAuthors: '',
        phonogramProducers: '',
        royaltyShare: 50,
        royaltyDetails: '[50]% of Label Net Income',
        transferDate: today
      }
    ]
  };
}

export function sanitizeStateForNewAgreement(data) {
  if (!data) return getDefaultAgreementState();
  const clean = JSON.parse(JSON.stringify(data));
  const today = new Date().toISOString().split('T')[0];

  // 1. ALWAYS assign a brand new unique Reference ID so it never collides with past agreements
  clean.id = 'OBS-AGR-' + Math.random().toString(36).substring(2, 8).toUpperCase();
  clean.createdAt = today;

  // 2. Wipe Label signature completely
  if (clean.label) {
    clean.label.signature = null;
    clean.label.date = today;
  }

  // 3. Wipe Primary Artist signature completely
  if (clean.artist) {
    clean.artist.signature = null;
    clean.artist.date = today;
    clean.artist.status = 'pending';
    clean.artist.submitted = false;
    delete clean.artist.signedAt;
    delete clean.artist.sigHash;
    delete clean.artist.sigTimestamp;
  }

  // 4. Wipe all Collaborators/Featured Artists signatures completely
  if (Array.isArray(clean.artists)) {
    clean.artists.forEach((a, idx) => {
      a.signature = null;
      a.date = today;
      a.status = 'pending';
      a.submitted = false;
      delete a.signedAt;
      delete a.sigHash;
      delete a.sigTimestamp;
    });
  }

  // 5. Reset document lifecycle & execution statuses
  clean.status = 'draft';
  clean.isLockedForArtist = false;
  delete clean.isArchivedInVault;
  delete clean.finalizedAt;
  delete clean.savedToVaultAt;
  delete clean.lastUpdatedInVaultAt;
  delete clean.artistSignedAt;

  return clean;
}

export function encodeAgreementState(state) {
  try {
    const json = JSON.stringify(state);
    const utf8Bytes = new TextEncoder().encode(json);
    let binary = '';
    for (let i = 0; i < utf8Bytes.length; i++) {
      binary += String.fromCharCode(utf8Bytes[i]);
    }
    const base64 = btoa(binary);
    return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  } catch (e) {
    console.error('Failed to encode agreement:', e);
    return '';
  }
}

export function decodeAgreementState(encodedStr) {
  try {
    let base64 = encodedStr.replace(/-/g, '+').replace(/_/g, '/');
    while (base64.length % 4) {
      base64 += '=';
    }
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    const json = new TextDecoder().decode(bytes);
    return JSON.parse(json);
  } catch (e) {
    console.error('Failed to decode agreement:', e);
    return null;
  }
}

class AgreementStore {
  constructor() {
    this.mode = 'label'; // 'label' | 'artist-sign' | 'counter-sign'
    this.linkStatus = 'active'; // 'active' | 'loading' | 'not_found' | 'artist_already_signed' | 'already_finalized' | 'just_submitted' | 'error'
    this.invalidRefId = '';
    this.invalidReason = '';

    if (typeof window !== 'undefined' && window.location?.search) {
      const p = new URLSearchParams(window.location.search);
      const urlId = p.get('id');
      const urlMode = p.get('mode');
      if (urlId) {
        this.linkStatus = 'loading';
        this.invalidRefId = urlId;
      } else if (urlMode === 'artist-sign' || urlMode === 'counter-sign') {
        this.linkStatus = 'loading';
      }
    }

    this.state = this.loadInitial();
    this.subscribers = [];
    this.checkServerAgreementLoad();
    this.initLiveSync();
  }

  initLiveSync() {
    if (typeof window === 'undefined') return;

    // 1. BroadcastChannel for instant same-browser cross-tab synchronization
    try {
      this.syncChannel = new BroadcastChannel('obscura_agreements_sync');
      this.syncChannel.onmessage = (event) => {
        if (event.data && event.data.type === 'ARTIST_SIGNED') {
          if (event.data.id === this.state.id && event.data.state) {
            console.log('⚡ [Sync Channel] Instant signature received for:', event.data.id);
            this.mergeIncomingState(event.data.state);
          }
        }
      };
    } catch (bcErr) {
      console.warn('BroadcastChannel not supported:', bcErr);
    }

    // 2. Storage event listener for cross-tab local fallback
    window.addEventListener('storage', (e) => {
      if (e.key === 'obscura_rec_last_signed_agreement') {
        try {
          const payload = JSON.parse(e.newValue);
          if (payload && payload.id === this.state.id) {
            this.mergeIncomingState(payload);
          }
        } catch (err) {}
      }
    });

    // 3. Start live listeners & polling
    this.restartAgreementListener();
  }

  restartAgreementListener() {
    if (typeof window === 'undefined') return;
    const currentId = this.state?.id;
    if (!currentId) return;

    // A. Firebase Realtime Database live listener
    if (this.unsubFirebase) {
      try { this.unsubFirebase(); } catch (e) {}
      this.unsubFirebase = null;
    }
    try {
      this.unsubFirebase = listenToAgreement(currentId, (remoteState) => {
        if (remoteState && remoteState.id === this.state.id) {
          console.log('🔥 [Firebase RTDB] Live signature update detected for:', currentId);
          this.mergeIncomingState(remoteState);
        }
      });
    } catch (e) {
      console.warn('Firebase live listener setup error:', e);
    }

    // B. Periodic Polling (every 3 seconds for local server / offline fallback)
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
    }
    this.pollInterval = setInterval(() => {
      this.pollServerForSignatures();
    }, 3000);

    // Initial check right now
    this.pollServerForSignatures();
  }

  async pollServerForSignatures() {
    if (typeof window === 'undefined') return;
    const currentId = this.state?.id;
    if (!currentId) return;

    try {
      // 1. Try Firebase first
      const fbState = await getAgreementFromFirebase(currentId);
      if (fbState && fbState.id === currentId) {
        this.mergeIncomingState(fbState);
        return;
      }

      // 2. Fallback to local server API
      const res = await fetch(`/api/agreements/${encodeURIComponent(currentId)}`);
      if (res.ok) {
        const serverData = await res.json();
        if (serverData && serverData.id === currentId) {
          this.mergeIncomingState(serverData);
        }
      }
    } catch (err) {
      // Silent catch on background poll
    }
  }

  mergeIncomingState(remoteState) {
    if (!remoteState || !Array.isArray(remoteState.artists)) return;
    let changed = false;

    remoteState.artists.forEach(remoteArt => {
      const localArt = this.state.artists?.find(a => a.id === remoteArt.id);
      if (localArt) {
        const remoteHasSig = Boolean(remoteArt.signature);
        const localHasSig = Boolean(localArt.signature);
        const sigChanged = remoteHasSig && (!localHasSig || JSON.stringify(localArt.signature) !== JSON.stringify(remoteArt.signature));

        if (sigChanged) {
          localArt.signature = remoteArt.signature;
          localArt.status = remoteArt.status || 'signed';
          localArt.submitted = Boolean(remoteArt.submitted || (remoteArt.status === 'signed'));
          localArt.signedAt = remoteArt.signedAt || localArt.signedAt || new Date().toISOString();
          changed = true;
        } else if (remoteArt.status === 'signed' && localArt.status !== 'signed') {
          localArt.status = 'signed';
          localArt.submitted = true;
          changed = true;
        } else if (!remoteHasSig && localHasSig) {
          // Only clear if the signature was previously officially finalized/submitted,
          // AND remote explicitly shows that the label has now reset/unlocked it!
          // NEVER wipe an active draft that the artist is currently placing on this device!
          const isLocalActiveDraft = (this.mode === 'artist-sign' && localArt.id === this.getCurrentSignerId() && !localArt.submitted);
          if (!isLocalActiveDraft && (localArt.submitted || localArt.status === 'signed') && remoteArt.status === 'pending' && !remoteArt.submitted) {
            localArt.signature = null;
            localArt.status = 'pending';
            localArt.submitted = false;
            delete localArt.signedAt;
            changed = true;
          }
        }
      } else if (remoteArt.id) {
        this.state.artists.push({ ...remoteArt });
        changed = true;
      }
    });

    // Also sync label signature if updated or removed remotely
    if (remoteState.label) {
      if (remoteState.label.signature && !this.state.label?.signature) {
        if (this.state.label) this.state.label.signature = remoteState.label.signature;
        changed = true;
      } else if (!remoteState.label.signature && this.state.label?.signature) {
        this.state.label.signature = null;
        changed = true;
      }
    }

    // Synchronize primary artist
    if (this.state.artists?.[0]) {
      if (JSON.stringify(this.state.artist?.signature) !== JSON.stringify(this.state.artists[0].signature) ||
          this.state.artist?.status !== this.state.artists[0].status) {
        this.state.artist.signature = this.state.artists[0].signature;
        this.state.artist.status = this.state.artists[0].status;
        this.state.artist.submitted = this.state.artists[0].submitted;
        changed = true;
      }
    }

    if (changed) {
      console.log('✅ [Live Sync] Agreement state updated with artist signatures:', this.state.id);
      if (this.mode === 'label') {
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state));
        } catch (e) {}
      }
      this.notify({ syncInputs: false, rebuildTracks: false, forceRebuildTracks: false });
    }
  }

  getLinkStatus() {
    return this.linkStatus;
  }

  getInvalidRefId() {
    return this.invalidRefId || this.state?.id || 'OBS-AGR-UNKNOWN';
  }

  getInvalidReason() {
    return this.invalidReason;
  }

  setLinkStatus(status, reason = '') {
    this.linkStatus = status;
    this.invalidReason = reason;
    this.notify();
  }

  async checkServerAgreementLoad() {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const id = params.get('id');
    const mode = params.get('mode');

    // If opening main dashboard with no signing params, everything is active
    if (!id && !mode) {
      this.linkStatus = 'active';
      return;
    }

    if (id) {
      this.invalidRefId = id;
      this.linkStatus = 'loading';
      try {
        // 1. First attempt to load from Firebase Realtime Database
        let serverState = await getAgreementFromFirebase(id);

        // 2. Fallback to server API if needed
        if (!serverState) {
          try {
            const res = await fetch(`/api/agreements/${encodeURIComponent(id)}`);
            if (res.ok) {
              serverState = await res.json();
            }
          } catch (fetchErr) {
            console.warn('Fallback server fetch error:', fetchErr);
          }
        }

        if (!serverState || !serverState.id) {
          this.linkStatus = 'not_found';
          this.invalidReason = `This agreement link (Ref ID: ${id}) does not exist or has been permanently purged from the server to optimize storage.`;
          this.notify();
          return;
        }

        // Case 1: Agreement already finalized and archived in Vault!
        if (serverState.isArchivedInVault === true || serverState.status === 'fully_executed') {
          this.linkStatus = 'already_finalized';
          this.invalidReason = `Agreement ${id} has been fully executed by both parties and archived into the Obscura Rec LLC Vault.`;
          this.state = this.normalizeArtistsState({ ...getDefaultAgreementState(), ...serverState });
          this.notify({ syncInputs: true, rebuildTracks: true, forceRebuildTracks: true });
          return;
        }

        // Case 2: In artist mode, keep linkStatus as active so the document renders normally!
        this.linkStatus = 'active';
        this.state = this.normalizeArtistsState({ ...getDefaultAgreementState(), ...serverState });

        // Restore local draft signature from sessionStorage if page was refreshed before submit
        if (mode === 'artist-sign') {
          const signerId = params.get('signer') || this.state.artists?.[0]?.id || 'art-1';
          try {
            if (typeof sessionStorage !== 'undefined') {
              const cachedSigStr = sessionStorage.getItem(`obscura_draft_sig_${id}_${signerId}`);
              if (cachedSigStr) {
                const cachedSig = JSON.parse(cachedSigStr);
                const targetArt = this.state.artists?.find(a => a.id === signerId);
                if (targetArt && !targetArt.signature && cachedSig) {
                  targetArt.signature = cachedSig;
                  if (this.state.artists[0]?.id === signerId && this.state.artist) {
                    this.state.artist.signature = cachedSig;
                  }
                }
              }
            }
          } catch (err) {}
        }

        this.notify({ syncInputs: true, rebuildTracks: true, forceRebuildTracks: true });
      } catch (e) {
        console.warn('Could not fetch agreement:', e);
        this.linkStatus = 'error';
        this.invalidReason = e.message;
        this.notify();
      }
    } else {
      // In signing mode but no ID provided and no doc
      const docParam = params.get('doc');
      if (!docParam && (mode === 'artist-sign' || mode === 'counter-sign')) {
        this.linkStatus = 'not_found';
        this.invalidRefId = 'N/A';
        this.invalidReason = 'No valid agreement Reference ID was provided in the URL.';
        this.notify();
      }
    }
  }

  normalizeArtistsState(targetState) {
    if (!targetState) return getDefaultAgreementState();
    if (!Array.isArray(targetState.artists) || targetState.artists.length === 0) {
      const art = targetState.artist || {};
      targetState.artists = [
        {
          id: 'art-1',
          role: 'Recording Artist',
          legalName: art.legalName || '',
          stageName: art.stageName || '',
          email: art.email || '',
          signature: art.signature || null,
          date: art.date || new Date().toISOString().split('T')[0],
          status: art.status || ((art.submitted || art.signedAt) ? 'signed' : 'pending'),
          submitted: Boolean(art.submitted || (art.status === 'signed' && art.signedAt))
        }
      ];
    } else {
      // Ensure every artist has an ID and role
      targetState.artists.forEach((a, idx) => {
        if (!a.id) a.id = `art-${idx + 1}`;
        if (!a.role) a.role = idx === 0 ? 'Recording Artist' : 'Collaborator / Featured';
        if (!a.status) a.status = (a.submitted || a.signedAt) ? 'signed' : 'pending';
        if (typeof a.submitted === 'undefined') a.submitted = Boolean(a.status === 'signed' && a.signedAt);
      });
    }
    // Keep primary artist synced with artists[0]
    if (targetState.artists[0]) {
      targetState.artist = {
        legalName: targetState.artists[0].legalName || '',
        stageName: targetState.artists[0].stageName || '',
        email: targetState.artists[0].email || '',
        signature: targetState.artists[0].signature || null,
        date: targetState.artists[0].date || targetState.createdAt
      };
    }
    return targetState;
  }

  loadInitial() {
    // 1. Check if URL contains signing link parameters
    if (typeof window !== 'undefined' && window.location.search) {
      const params = new URLSearchParams(window.location.search);
      const urlMode = params.get('mode');
      const docParam = params.get('doc');
      const idParam = params.get('id');

      if (urlMode === 'artist-sign' || urlMode === 'counter-sign') {
        this.mode = urlMode;
      }

      if (docParam) {
        const decoded = decodeAgreementState(docParam);
        if (decoded && Array.isArray(decoded.tracks)) {
          return this.normalizeArtistsState({ ...getDefaultAgreementState(), ...decoded });
        }
      }

      // If opening an artist-sign or counter-sign link with an ID, do NOT load the label's localStorage!
      if (idParam || urlMode === 'artist-sign' || urlMode === 'counter-sign') {
        return getDefaultAgreementState();
      }
    }

    // 2. Otherwise load from localStorage (label mode editor only)
    try {
      if (typeof localStorage !== 'undefined') {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved) {
          const parsed = JSON.parse(saved);
          if (parsed && Array.isArray(parsed.tracks) && parsed.tracks.length > 0) {
            return this.normalizeArtistsState({ ...getDefaultAgreementState(), ...parsed });
          }
        }
      }
    } catch (e) {
      console.warn('Could not load saved agreement:', e);
    }
    return getDefaultAgreementState();
  }

  getMode() {
    return this.mode;
  }

  setMode(newMode) {
    this.mode = newMode;
    this.notify();
  }

  getCurrentSignerId() {
    if (typeof window !== 'undefined' && window.location?.search) {
      const p = new URLSearchParams(window.location.search);
      const signer = p.get('signer');
      if (signer) return signer;
    }
    return this.state?.artists?.[0]?.id || 'art-1';
  }

  getArtist(artistId = null) {
    const targetId = artistId || this.getCurrentSignerId();
    if (!Array.isArray(this.state?.artists) || this.state.artists.length === 0) {
      return this.state?.artist;
    }
    return this.state.artists.find(a => a.id === targetId) || this.state.artists[0];
  }

  isArtistSigned(artistId = null) {
    const artist = this.getArtist(artistId);
    return Boolean(artist && artist.signature);
  }

  isCurrentSignerLocked() {
    if (this.mode !== 'artist-sign') return false;
    if (this.state.isArchivedInVault || this.state.status === 'fully_executed') return true;
    const currentId = this.getCurrentSignerId();
    const artist = this.getArtist(currentId);
    // Signer is ONLY locked if they have officially submitted the agreement!
    return Boolean(artist && artist.signature && (artist.submitted === true || (artist.status === 'signed' && artist.signedAt)));
  }

  isArtistLocked() {
    return this.isCurrentSignerLocked();
  }

  areAllArtistsSigned() {
    if (!Array.isArray(this.state?.artists) || this.state.artists.length === 0) {
      return Boolean(this.state?.artist?.signature);
    }
    return this.state.artists.every(a => Boolean(a.signature));
  }

  addArtist(data = null) {
    const today = new Date().toISOString().split('T')[0];
    const newIdx = (this.state.artists?.length || 0) + 1;
    const newArtist = data || {
      id: 'art-' + Math.random().toString(36).substring(2, 7),
      role: 'Featured Artist / Collaborator',
      legalName: '',
      stageName: '',
      email: '',
      signature: null,
      date: today,
      status: 'pending'
    };

    if (!Array.isArray(this.state.artists)) {
      this.normalizeArtistsState(this.state);
    }
    this.state.artists.push(newArtist);
    this.save({ syncInputs: true });
    return newArtist;
  }

  removeArtist(artistId) {
    if (!Array.isArray(this.state.artists) || this.state.artists.length <= 1) {
      alert('At least one primary artist is required.');
      return false;
    }
    this.state.artists = this.state.artists.filter(a => a.id !== artistId);
    // Keep state.artist in sync with new primary
    if (this.state.artists[0]) {
      this.state.artist = {
        legalName: this.state.artists[0].legalName || '',
        stageName: this.state.artists[0].stageName || '',
        email: this.state.artists[0].email || '',
        signature: this.state.artists[0].signature || null,
        date: this.state.artists[0].date || this.state.createdAt
      };
    }
    this.save({ syncInputs: true });
    return true;
  }

  applyArtistSignature(artistId, signatureObj) {
    const targetId = artistId || this.getCurrentSignerId();
    if (!Array.isArray(this.state.artists)) {
      this.normalizeArtistsState(this.state);
    }
    const artist = this.state.artists.find(a => a.id === targetId);
    if (artist) {
      artist.signature = signatureObj;
      if (signatureObj) {
        artist.date = new Date().toISOString().split('T')[0];
        // Do NOT set artist.status = 'signed' or artist.submitted = true here!
        // The artist has only drawn/placed their signature on the document preview.
        // It stays fully editable and unsubmitted until "Submit Signed Agreement" is clicked.
        if (artist.status !== 'signed' || !artist.submitted) {
          artist.status = 'pending';
          artist.submitted = false;
        }
      } else {
        artist.status = 'pending';
        artist.submitted = false;
        delete artist.signedAt;
      }
    }
    // Sync with primary artist if applicable
    if (this.state.artists[0]?.id === targetId) {
      this.state.artist = {
        legalName: this.state.artists[0].legalName || '',
        stageName: this.state.artists[0].stageName || '',
        email: this.state.artists[0].email || '',
        signature: signatureObj,
        date: this.state.artists[0].date
      };
    }

    // Do NOT lock or mark all_artists_signed here! That happens only on final submission!
    this.save({ syncInputs: false });

    // Cache locally in sessionStorage so refresh never loses the draft signature
    try {
      if (typeof sessionStorage !== 'undefined') {
        if (signatureObj) {
          sessionStorage.setItem(`obscura_draft_sig_${this.state.id}_${targetId}`, JSON.stringify(signatureObj));
        } else {
          sessionStorage.removeItem(`obscura_draft_sig_${this.state.id}_${targetId}`);
        }
      }
    } catch (e) {}

    // Instantly sync draft to Firebase RTDB & local server so remote always matches local signature state!
    try {
      saveAgreementToFirebase(this.state);
    } catch (e) {}
    if (typeof window !== 'undefined' && window.location) {
      try {
        fetch('/api/agreements', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(this.state)
        }).catch(() => {});
      } catch (e) {}
    }
  }

  async removeArtistSignature(artistId) {
    const targetId = artistId || this.getCurrentSignerId();
    if (!Array.isArray(this.state.artists)) {
      this.normalizeArtistsState(this.state);
    }
    const artist = this.state.artists.find(a => a.id === targetId);
    const artName = artist?.legalName || artist?.stageName || 'Artist';

    if (typeof window !== 'undefined' && window.confirm) {
      if (!confirm(`Are you sure you want to remove the signature for ${artName}? This will reset their status to Pending and allow them to re-sign.`)) {
        return false;
      }
    }

    if (artist) {
      artist.signature = null;
      artist.status = 'pending';
      artist.submitted = false;
      delete artist.signedAt;
    }

    // Sync primary artist
    if (this.state.artists[0]?.id === targetId) {
      if (this.state.artist) {
        this.state.artist.signature = null;
        this.state.artist.status = 'pending';
        this.state.artist.submitted = false;
        delete this.state.artist.signedAt;
      }
    }

    // Unlock signing state
    this.state.isLockedForArtist = false;
    if (this.state.status === 'fully_executed') {
      this.state.status = 'draft';
    }

    // Save and notify locally
    this.save({ syncInputs: false, rebuildTracks: false });

    // Sync to Firebase RTDB
    try {
      await saveAgreementToFirebase(this.state);
    } catch (e) {
      console.warn('Firebase sync error on removeArtistSignature:', e);
    }

    // Sync to server
    if (typeof window !== 'undefined' && window.location) {
      try {
        await fetch('/api/agreements', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(this.state)
        });
      } catch (e) {
        console.warn('Server sync error on removeArtistSignature:', e);
      }
    }

    // Sync to Vault if archived
    try {
      await updateVaultIfArchived(this.state);
    } catch (e) {
      console.warn('Vault update error on removeArtistSignature:', e);
    }

    // Broadcast across tabs
    try {
      if (this.syncChannel) {
        this.syncChannel.postMessage({
          type: 'ARTIST_SIGNED',
          id: this.state.id,
          state: this.state
        });
      }
    } catch (e) {}

    return true;
  }

  async removeLabelSignature() {
    if (typeof window !== 'undefined' && window.confirm) {
      if (!confirm('Are you sure you want to remove the Record Label signature?')) {
        return false;
      }
    }

    if (this.state.label) {
      this.state.label.signature = null;
    }
    if (this.state.status === 'fully_executed') {
      this.state.status = 'draft';
    }

    this.save({ syncInputs: false, rebuildTracks: false });

    try {
      await saveAgreementToFirebase(this.state);
    } catch (e) {}

    if (typeof window !== 'undefined' && window.location) {
      try {
        await fetch('/api/agreements', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(this.state)
        });
      } catch (e) {}
    }

    try {
      await updateVaultIfArchived(this.state);
    } catch (e) {}

    try {
      if (this.syncChannel) {
        this.syncChannel.postMessage({
          type: 'ARTIST_SIGNED',
          id: this.state.id,
          state: this.state
        });
      }
    } catch (e) {}

    return true;
  }

  generateArtistSigningUrl(artistId = null) {
    if (typeof window === 'undefined') return '';
    const targetId = artistId || this.state.artists?.[0]?.id || 'art-1';
    const baseUrl = window.location.origin + window.location.pathname;
    return `${baseUrl}?mode=artist-sign&id=${this.state.id}&signer=${targetId}`;
  }

  generateCounterSignUrl() {
    if (typeof window === 'undefined') return '';
    const baseUrl = window.location.origin + window.location.pathname;
    return `${baseUrl}?mode=counter-sign&id=${this.state.id}`;
  }

  save(options = {}) {
    // Only persist to localStorage in label mode to avoid leaking signatures/locks between roles on same browser
    if (this.mode === 'label') {
      try {
        if (typeof localStorage !== 'undefined') {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state));
        }
      } catch (e) {
        console.error('Failed to save to localStorage:', e);
      }
    }
    this.notify(options);
  }

  notify(options = {}) {
    this.subscribers.forEach(fn => fn(this.state, options));
  }

  subscribe(fn) {
    this.subscribers.push(fn);
    return () => {
      this.subscribers = this.subscribers.filter(s => s !== fn);
    };
  }

  getState() {
    return this.state;
  }

  update(path, value) {
    const keys = path.split('.');
    let current = this.state;
    for (let i = 0; i < keys.length - 1; i++) {
      if (!current[keys[i]]) current[keys[i]] = {};
      current = current[keys[i]];
    }
    current[keys[keys.length - 1]] = value;

    // Bidirectional sync between artist and artists[0]
    if (path.startsWith('artist.')) {
      const field = path.replace('artist.', '');
      if (Array.isArray(this.state.artists) && this.state.artists[0]) {
        this.state.artists[0][field] = value;
      }
    } else if (path.startsWith('artists.0.')) {
      const field = path.replace('artists.0.', '');
      if (this.state.artist) {
        this.state.artist[field] = value;
      }
    }

    this.save({ syncInputs: false, rebuildTracks: false });
  }

  addTrack(track = null) {
    const today = new Date().toISOString().split('T')[0];
    const newTrack = track || {
      id: 'trk-' + Math.random().toString(36).substring(2, 7),
      title: 'New Track',
      versionTag: '',
      year: new Date().getFullYear().toString(),
      musicAuthors: '',
      lyricsAuthors: '',
      phonogramProducers: 'Obscura Rec LLC',
      royaltyShare: 50,
      royaltyDetails: '50% of Label Net Income',
      transferDate: today
    };
    this.state.tracks.push(newTrack);
    this.save({ rebuildTracks: true, forceRebuildTracks: true });
  }

  duplicateTrack(index) {
    if (this.state.tracks[index]) {
      const copy = JSON.parse(JSON.stringify(this.state.tracks[index]));
      copy.id = 'trk-' + Math.random().toString(36).substring(2, 7);
      copy.versionTag = copy.versionTag ? `${copy.versionTag} (Copy)` : '(Alternative Version)';
      this.state.tracks.splice(index + 1, 0, copy);
      this.save({ rebuildTracks: true, forceRebuildTracks: true });
    }
  }

  removeTrack(index) {
    if (this.state.tracks.length <= 1) {
      alert('At least one track / object must be listed in Section 2.');
      return;
    }
    this.state.tracks.splice(index, 1);
    this.save({ rebuildTracks: true, forceRebuildTracks: true });
  }

  addStandardBundle(baseTitle = 'Untitled Track') {
    const today = new Date().toISOString().split('T')[0];
    const year = new Date().getFullYear().toString();
    const artistAlias = this.state.artist.stageName || '[Artist Alias]';
    
    const versions = [
      { tag: '', desc: '' },
      { tag: '(Slowed)', desc: 'Slowed version' },
      { tag: '(Sped Up)', desc: 'Sped Up version' },
      { tag: '(Instrumental)', desc: 'Instrumental mix' }
    ];

    versions.forEach(v => {
      this.state.tracks.push({
        id: 'trk-' + Math.random().toString(36).substring(2, 7),
        title: baseTitle,
        versionTag: v.tag,
        year: year,
        musicAuthors: this.state.artist.legalName || 'Author(s) of Music',
        lyricsAuthors: this.state.artist.legalName || 'Author(s) of Lyrics',
        phonogramProducers: 'Obscura Rec LLC',
        royaltyShare: 50,
        royaltyDetails: `${artistAlias} - 50% of Label Net Income`,
        transferDate: today
      });
    });
    this.save({ rebuildTracks: true, forceRebuildTracks: true });
  }

  resetAll() {
    this.state = getDefaultAgreementState();

    // Clean any previous signing query parameters from the browser address bar
    if (typeof window !== 'undefined' && window.history && window.history.replaceState) {
      window.history.replaceState({}, document.title, window.location.pathname);
    }

    // Restart live listener and background polling for the brand new Agreement Ref ID
    this.restartAgreementListener();

    this.save({ syncInputs: true, rebuildTracks: true, forceRebuildTracks: true });
  }

  getStatus() {
    const hasLabelSig = Boolean(this.state.label?.signature);
    const artists = Array.isArray(this.state.artists) && this.state.artists.length > 0 
      ? this.state.artists 
      : [this.state.artist];
    const totalArtists = artists.length;
    const signedArtists = artists.filter(a => Boolean(a?.signature)).length;
    const allArtistsSigned = totalArtists > 0 && signedArtists === totalArtists;

    if (hasLabelSig && allArtistsSigned) {
      return { code: 'executed', label: 'Fully Executed & Sealed', class: 'status-executed' };
    } else if (allArtistsSigned && !hasLabelSig) {
      return { 
        code: 'partial', 
        label: totalArtists > 1 ? `All ${totalArtists} Artists Signed (Awaiting Counter-Sign)` : 'Artist Signed (Awaiting Counter-Sign)', 
        class: 'status-partial' 
      };
    } else if (signedArtists > 0 || hasLabelSig) {
      return { 
        code: 'partial', 
        label: totalArtists > 1 ? `Signed (${signedArtists}/${totalArtists} Artists)` : 'Partially Signed', 
        class: 'status-partial' 
      };
    }
    return { code: 'draft', label: 'Draft Mode', class: 'status-draft' };
  }

  // Templates in localStorage (Blueprints for future contracts - NEVER store signatures)
  saveTemplate(templateName) {
    try {
      const templates = this.getSavedTemplates();
      // Sanitize the current state so signatures & old IDs are NEVER stored in a template blueprint!
      const cleanData = sanitizeStateForNewAgreement(this.state);
      delete cleanData.id;
      templates.push({
        id: 'tpl-' + Date.now(),
        name: templateName,
        savedAt: new Date().toLocaleDateString(),
        data: cleanData
      });
      localStorage.setItem(TEMPLATES_KEY, JSON.stringify(templates));
      return true;
    } catch (e) {
      console.error('Error saving template:', e);
      return false;
    }
  }

  getSavedTemplates() {
    try {
      const templates = JSON.parse(localStorage.getItem(TEMPLATES_KEY) || '[]');
      // Automatically sanitize any older templates that might have had signatures saved in them
      return templates.map(t => {
        if (t && t.data) {
          t.data = sanitizeStateForNewAgreement(t.data);
          delete t.data.id;
        }
        return t;
      });
    } catch (e) {
      return [];
    }
  }

  loadTemplate(templateId) {
    const templates = this.getSavedTemplates();
    const found = templates.find(t => t.id === templateId);
    if (found && found.data) {
      // 1. Sanitize to guarantee 0 signatures and a fresh brand new Ref ID!
      const cleanData = sanitizeStateForNewAgreement(found.data);
      this.state = this.normalizeArtistsState({ ...getDefaultAgreementState(), ...cleanData });

      // 2. Clean URL query parameters from address bar
      if (typeof window !== 'undefined' && window.history && window.history.replaceState) {
        window.history.replaceState({}, document.title, window.location.pathname);
      }

      // 3. Restart live listener & polling for the brand new Ref ID
      this.restartAgreementListener();

      this.save({ syncInputs: true, rebuildTracks: true, forceRebuildTracks: true });
      return true;
    }
    return false;
  }

  deleteTemplate(templateId) {
    let templates = this.getSavedTemplates();
    templates = templates.filter(t => t.id !== templateId);
    localStorage.setItem(TEMPLATES_KEY, JSON.stringify(templates));
  }

  // Load pre-configured official agreement presets (Always zero signatures & fresh Ref ID)
  loadPreset(presetType) {
    const today = new Date().toISOString().split('T')[0];
    let state = getDefaultAgreementState();

    if (presetType === 'single') {
      state.tracks = [
        {
          id: 'trk-1',
          title: '',
          versionTag: '',
          year: new Date().getFullYear().toString(),
          musicAuthors: '',
          lyricsAuthors: '',
          phonogramProducers: 'Obscura Rec LLC',
          royaltyShare: 50,
          royaltyDetails: '[50]% of Label Net Income',
          transferDate: today
        }
      ];
    } else if (presetType === 'bundle') {
      state.tracks = [
        {
          id: 'trk-1',
          title: '',
          versionTag: '',
          year: new Date().getFullYear().toString(),
          musicAuthors: '',
          lyricsAuthors: '',
          phonogramProducers: 'Obscura Rec LLC',
          royaltyShare: 50,
          royaltyDetails: '[50]% of Label Net Income',
          transferDate: today
        },
        {
          id: 'trk-2',
          title: '',
          versionTag: '(Slowed)',
          year: new Date().getFullYear().toString(),
          musicAuthors: '',
          lyricsAuthors: '',
          phonogramProducers: 'Obscura Rec LLC',
          royaltyShare: 50,
          royaltyDetails: '[50]% of Label Net Income',
          transferDate: today
        },
        {
          id: 'trk-3',
          title: '',
          versionTag: '(Sped Up)',
          year: new Date().getFullYear().toString(),
          musicAuthors: '',
          lyricsAuthors: '',
          phonogramProducers: 'Obscura Rec LLC',
          royaltyShare: 50,
          royaltyDetails: '[50]% of Label Net Income',
          transferDate: today
        }
      ];
    } else if (presetType === 'ep') {
      state.tracks = [
        { id: 'trk-1', title: 'Track 1', versionTag: '', year: '2026', royaltyShare: 50, royaltyDetails: '50% of Label Net Income', phonogramProducers: 'Obscura Rec LLC', transferDate: today },
        { id: 'trk-2', title: 'Track 2', versionTag: '', year: '2026', royaltyShare: 50, royaltyDetails: '50% of Label Net Income', phonogramProducers: 'Obscura Rec LLC', transferDate: today },
        { id: 'trk-3', title: 'Track 3', versionTag: '', year: '2026', royaltyShare: 50, royaltyDetails: '50% of Label Net Income', phonogramProducers: 'Obscura Rec LLC', transferDate: today }
      ];
    } else if (presetType === 'collab') {
      state.tracks = [
        { id: 'trk-1', title: '', versionTag: '', year: '2026', royaltyShare: 50, royaltyDetails: '50% of Label Net Income', phonogramProducers: 'Obscura Rec LLC', transferDate: today }
      ];
      state.artists = [
        {
          id: 'art-1',
          role: 'Primary Recording Artist',
          legalName: '',
          stageName: '',
          email: '',
          signature: null,
          date: today,
          status: 'pending'
        },
        {
          id: 'art-2',
          role: 'Featured Artist / Collaborator',
          legalName: '',
          stageName: '',
          email: '',
          signature: null,
          date: today,
          status: 'pending'
        }
      ];
      state.artist = { ...state.artists[0] };
    }

    // Always sanitize to guarantee 0 signatures and fresh Ref ID
    this.state = sanitizeStateForNewAgreement(state);

    // Clean address bar query string
    if (typeof window !== 'undefined' && window.history && window.history.replaceState) {
      window.history.replaceState({}, document.title, window.location.pathname);
    }

    // Restart live listener & polling for the new ID
    this.restartAgreementListener();

    this.save({ syncInputs: true, rebuildTracks: true, forceRebuildTracks: true });
    return this.state;
  }
}

export const agreementStore = new AgreementStore();
