import { getDefaultAgreementState, sanitizeStateForNewAgreement, agreementStore } from '../js/agreement-data.js';

async function verify() {
  const assert = (cond, msg) => {
    if (!cond) throw new Error('FAIL: ' + msg);
    console.log('PASS: ' + msg);
  };

  console.log('--- 1. Testing sanitizeStateForNewAgreement ---');
  const dirtyState = {
    id: 'OBS-AGR-QQ2K16',
    label: { signature: { type: 'draw', data: 'data:labelSig' } },
    artist: { legalName: 'Old Artist', signature: { type: 'draw', data: 'data:artSig' }, status: 'signed', submitted: true },
    artists: [
      { id: 'art-1', legalName: 'Old Artist', signature: { type: 'draw', data: 'data:artSig' }, status: 'signed', submitted: true },
      { id: 'art-2', legalName: 'Collab Artist', signature: { type: 'draw', data: 'data:collabSig' }, status: 'signed', submitted: true }
    ],
    status: 'fully_executed',
    isLockedForArtist: true,
    isArchivedInVault: true
  };

  const clean = sanitizeStateForNewAgreement(dirtyState);
  assert(clean.id !== 'OBS-AGR-QQ2K16', 'New unique Ref ID generated: ' + clean.id);
  assert(clean.label.signature === null, 'Label signature is null');
  assert(clean.artist.signature === null, 'Primary artist signature is null');
  assert(clean.artists[0].signature === null, 'Artist 1 signature is null');
  assert(clean.artists[0].status === 'pending', 'Artist 1 status is reset to pending');
  assert(clean.artists[0].submitted === false, 'Artist 1 submitted is reset to false');
  assert(clean.artists[1].signature === null, 'Artist 2 signature is null');
  assert(clean.artists[1].status === 'pending', 'Artist 2 status is reset to pending');
  assert(clean.status === 'draft', 'Status is reset to draft');
  assert(clean.isLockedForArtist === false, 'isLockedForArtist is reset to false');
  assert(clean.isArchivedInVault === undefined, 'Vault archive flag is removed');

  console.log('\n--- 2. Testing Official Presets Generation ---');
  ['single', 'bundle', 'ep', 'collab'].forEach(type => {
    const presetState = agreementStore.loadPreset(type);
    assert(Boolean(presetState.id && presetState.id.startsWith('OBS-AGR-')), `Preset ${type} generated valid ID: ${presetState.id}`);
    assert(presetState.label.signature === null, `Preset ${type} label signature is null`);
    assert(presetState.artists.every(a => a.signature === null), `Preset ${type} all artists signatures are null`);
    assert(presetState.artists.every(a => a.status === 'pending'), `Preset ${type} all artists status are pending`);
  });

  console.log('\n--- 3. Testing Reset Functionality ---');
  agreementStore.resetAll();
  const resetState = agreementStore.getState();
  assert(resetState.label.signature === null, 'Reset state label signature is null');
  assert(resetState.artist.signature === null, 'Reset state artist signature is null');
  assert(resetState.artists.length === 1, 'Reset state has 1 clean primary artist');
  assert(resetState.artists[0].signature === null, 'Reset state artist 1 signature is null');

  console.log('\n--- 4. Testing Permanent Signed Agreements Preserved in Firebase & Server ---');
  const fbRes = await fetch('https://ocr-llc-song-agreements-default-rtdb.asia-southeast1.firebasedatabase.app/agreements/OBS-AGR-QQ2K16.json');
  const signedRecord = await fbRes.json();
  assert(signedRecord && signedRecord.id === 'OBS-AGR-QQ2K16', 'Signed agreement OBS-AGR-QQ2K16 exists in Firebase');
  assert(signedRecord.artists.length >= 3, 'Signed agreement has all executing collaborators');
  const signedArtists = signedRecord.artists.filter(a => Boolean(a.signature));
  assert(signedArtists.length >= 2, `Permanent signatures preserved! Found ${signedArtists.length} signed artists in OBS-AGR-QQ2K16`);
  console.log(`Preserved Artists in OBS-AGR-QQ2K16:`, signedArtists.map(a => `${a.legalName || a.stageName} (${a.signature?.type})`));

  console.log('\n>>> ALL PRESET, RESET, AND PERMANENT SIGNATURE VERIFICATIONS PASSED 100%! <<<');
}

verify().catch(err => {
  console.error(err);
  process.exit(1);
});
