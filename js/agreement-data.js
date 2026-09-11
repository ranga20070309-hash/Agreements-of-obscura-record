/**
 * Agreement State Management & Data Presets for Obscura Rec LLC
 */

import {
  saveAgreementToFirebase,
  getAgreementFromFirebase,
  listenToAgreement
} from './firebase-config.js';

const STORAGE_KEY = 'obscura_rec_agreement_data';
const TEMPLATES_KEY = 'obscura_rec_saved_templates';

export function getDefaultAgreementState() {
  const today = new Date().toISOString().split('T')[0];

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
    terms: {
      termYears: 10,
      renewalYears: 10,
      noticeDays: 30
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
    this.state = this.loadInitial();
    this.subscribers = [];
    this.checkServerAgreementLoad();
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
          this.invalidReason = `Agreement ${id} has been fully executed by both parties and archived into the Obscura Rec LLC Vault. The temporary signing link has been permanently closed.`;
          this.notify();
          return;
        }

        // Case 2: Artist signing link, but Artist already signed & submitted!
        if (mode === 'artist-sign') {
          if (serverState.isLockedForArtist === true || serverState.status === 'artist_signed') {
            this.linkStatus = 'artist_already_signed';
            this.invalidReason = `This agreement has already been digitally executed by the artist and delivered to Obscura Rec LLC. This signing link is now closed and terminated.`;
            this.notify();
            return;
          }
        }

        // Valid, active session
        this.linkStatus = 'active';
        this.state = { ...getDefaultAgreementState(), ...serverState };
        this.notify();
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
          return { ...getDefaultAgreementState(), ...decoded };
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
            return { ...getDefaultAgreementState(), ...parsed };
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

  isArtistLocked() {
    return Boolean(this.state && (
      this.state.isLockedForArtist === true ||
      this.state.status === 'artist_signed' ||
      this.state.status === 'fully_executed' ||
      this.state.isArchivedInVault === true
    ));
  }

  generateArtistSigningUrl() {
    if (typeof window === 'undefined') return '';
    const cleanState = JSON.parse(JSON.stringify(this.state));
    // Reset artist signature for signing request
    cleanState.artist.signature = null;
    const token = encodeAgreementState(cleanState);
    const baseUrl = window.location.origin + window.location.pathname;
    return `${baseUrl}?mode=artist-sign&doc=${token}`;
  }

  generateCounterSignUrl() {
    if (typeof window === 'undefined') return '';
    const token = encodeAgreementState(this.state);
    const baseUrl = window.location.origin + window.location.pathname;
    return `${baseUrl}?mode=counter-sign&doc=${token}`;
  }

  save() {
    // Only persist to localStorage in label mode to avoid leaking signatures/locks between roles on same browser
    if (this.mode === 'label') {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state));
      } catch (e) {
        console.error('Failed to save to localStorage:', e);
      }
    }
    this.notify();
  }

  notify() {
    this.subscribers.forEach(fn => fn(this.state));
  }

  subscribe(fn) {
    this.subscribers.push(fn);
    fn(this.state);
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
    this.save();
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
    this.save();
  }

  duplicateTrack(index) {
    if (this.state.tracks[index]) {
      const copy = JSON.parse(JSON.stringify(this.state.tracks[index]));
      copy.id = 'trk-' + Math.random().toString(36).substring(2, 7);
      copy.versionTag = copy.versionTag ? `${copy.versionTag} (Copy)` : '(Alternative Version)';
      this.state.tracks.splice(index + 1, 0, copy);
      this.save();
    }
  }

  removeTrack(index) {
    if (this.state.tracks.length <= 1) {
      alert('At least one track / object must be listed in Section 2.');
      return;
    }
    this.state.tracks.splice(index, 1);
    this.save();
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
    this.save();
  }

  resetAll() {
    this.state = getDefaultAgreementState();
    this.save();
  }

  getStatus() {
    const hasLabelSig = Boolean(this.state.label.signature);
    const hasArtistSig = Boolean(this.state.artist.signature);

    if (hasLabelSig && hasArtistSig) {
      return { code: 'executed', label: 'Fully Executed', class: 'status-executed' };
    } else if (hasLabelSig || hasArtistSig) {
      return { 
        code: 'partial', 
        label: hasLabelSig ? 'Label Signed (Awaiting Artist)' : 'Artist Signed (Awaiting Label)', 
        class: 'status-partial' 
      };
    }
    return { code: 'draft', label: 'Draft Mode', class: 'status-draft' };
  }

  // Templates in localStorage
  saveTemplate(templateName) {
    try {
      const templates = JSON.parse(localStorage.getItem(TEMPLATES_KEY) || '[]');
      templates.push({
        id: 'tpl-' + Date.now(),
        name: templateName,
        savedAt: new Date().toLocaleDateString(),
        data: JSON.parse(JSON.stringify(this.state))
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
      return JSON.parse(localStorage.getItem(TEMPLATES_KEY) || '[]');
    } catch (e) {
      return [];
    }
  }

  loadTemplate(templateId) {
    const templates = this.getSavedTemplates();
    const found = templates.find(t => t.id === templateId);
    if (found && found.data) {
      this.state = { ...getDefaultAgreementState(), ...found.data };
      this.save();
      return true;
    }
    return false;
  }

  deleteTemplate(templateId) {
    let templates = this.getSavedTemplates();
    templates = templates.filter(t => t.id !== templateId);
    localStorage.setItem(TEMPLATES_KEY, JSON.stringify(templates));
  }
}

export const agreementStore = new AgreementStore();
