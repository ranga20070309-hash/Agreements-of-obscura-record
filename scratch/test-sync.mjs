import { getDefaultAgreementState } from '../js/agreement-data.js';

// Mock localStorage
globalThis.localStorage = {
  store: {},
  getItem(k) { return this.store[k] || null; },
  setItem(k, v) { this.store[k] = String(v); },
  removeItem(k) { delete this.store[k]; }
};

// Create mock state matching user's exact screen:
const localState = getDefaultAgreementState();
localState.id = 'OBS-AGR-QQ2K16';
localState.artists = [
  { id: 'art-1', legalName: 'sayuru sithijaya', stageName: 'sayuruxt', status: 'pending', submitted: false, signature: null },
  { id: 'art-z8j2x', legalName: 'Rannga', stageName: 'Phonix Wave', status: 'pending', submitted: false, signature: null },
  { id: 'art-l32sx', legalName: 'pasi', stageName: 'PaSINDU007', status: 'pending', submitted: false, signature: null },
  { id: 'art-4', legalName: 'Chamod', stageName: 'CNMX', status: 'pending', submitted: false, signature: null }
];
localState.artist = { ...localState.artists[0] };

const mockStore = {
  state: localState,
  mode: 'label',
  notified: false,
  notify() { this.notified = true; }
};

// Simulate mergeIncomingState logic
function mergeIncomingState(store, remoteState) {
  if (!remoteState || !Array.isArray(remoteState.artists)) return false;
  let changed = false;

  remoteState.artists.forEach(remoteArt => {
    const localArt = store.state.artists?.find(a => a.id === remoteArt.id);
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
      }
    } else if (remoteArt.id) {
      store.state.artists.push({ ...remoteArt });
      changed = true;
    }
  });

  if (store.state.artists?.[0]) {
    if (JSON.stringify(store.state.artist?.signature) !== JSON.stringify(store.state.artists[0].signature)) {
      store.state.artist.signature = store.state.artists[0].signature;
      store.state.artist.status = store.state.artists[0].status;
      changed = true;
    }
  }

  if (changed) {
    store.notify();
  }
  return changed;
}

// Remote payload where sayuruxt has signed
const remoteState = {
  id: 'OBS-AGR-QQ2K16',
  artists: [
    {
      id: 'art-1',
      legalName: 'sayuru sithijaya',
      stageName: 'sayuruxt',
      status: 'signed',
      submitted: true,
      signature: { type: 'draw', data: 'data:image/webp;base64,mockSignatureData', timestamp: '9/14/2026, 1:12:31 AM', hash: 'OBS-D4H56BS' }
    },
    { id: 'art-z8j2x', legalName: 'Rannga', stageName: 'Phonix Wave', status: 'pending', submitted: false, signature: null }
  ]
};

const changed = mergeIncomingState(mockStore, remoteState);

function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL:', msg);
    process.exit(1);
  } else {
    console.log('PASS:', msg);
  }
}

assert(changed === true, 'Merge should report state changed');
assert(mockStore.notified === true, 'Store notify() must be called to re-render UI');
assert(mockStore.state.artists[0].status === 'signed', 'Artist 1 status must be signed');
assert(mockStore.state.artists[0].signature !== null, 'Artist 1 signature must be populated');
assert(mockStore.state.artist.signature !== null, 'Primary artist signature must be synchronized');
assert(mockStore.state.artists[1].status === 'pending', 'Artist 2 must still be pending');

console.log('ALL SYNC TESTS PASSED 100%!');
