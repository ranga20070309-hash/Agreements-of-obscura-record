import { agreementStore, getDefaultAgreementState } from '../js/agreement-data.js';

console.log('--- TEST: Preventing Poll from Wiping Active Artist Signature ---');

agreementStore.setMode('artist-sign');
const signerId = 'art-1';

// 1. Initial agreement loaded without signatures
agreementStore.state = getDefaultAgreementState();
agreementStore.state.id = 'OBS-AGR-TESTPOLL';

console.log('Initial Artist 1 signature:', agreementStore.state.artists[0].signature);

// 2. Artist draws signature and applies it
const newSig = {
  type: 'draw',
  data: 'data:image/webp;base64,sampleDrawnSignature',
  timestamp: new Date().toLocaleString(),
  hash: 'SEAL-12345'
};
agreementStore.applyArtistSignature(signerId, newSig);

console.log('After applyArtistSignature:');
console.log(' - Artist 1 has signature:', Boolean(agreementStore.state.artists[0].signature));
console.log(' - Artist 1 submitted:', agreementStore.state.artists[0].submitted);

// 3. Simulate background polling receiving remote state from Firebase where signature is still null!
const remotePendingState = JSON.parse(JSON.stringify(getDefaultAgreementState()));
remotePendingState.id = 'OBS-AGR-TESTPOLL';
remotePendingState.artists[0].signature = null;
remotePendingState.artists[0].status = 'pending';
remotePendingState.artists[0].submitted = false;

console.log('\n--- Simulating 3-second background poll from Firebase with signature: null ---');
agreementStore.mergeIncomingState(remotePendingState);

console.log('After background poll:');
console.log(' - Artist 1 has signature:', Boolean(agreementStore.state.artists[0].signature));
console.log(' - Artist 1 signature data:', agreementStore.state.artists[0].signature?.data);

if (!agreementStore.state.artists[0].signature) {
  console.error('❌ BUG DETECTED: The background poll wiped the local artist signature!');
  process.exit(1);
} else {
  console.log('✅ SUCCESS: Artist draft signature was NOT wiped by background poll!');
}

// 4. Now simulate Artist officially submitting the contract
console.log('\n--- Simulating Artist submitting the contract ---');
agreementStore.state.artists[0].submitted = true;
agreementStore.state.artists[0].status = 'signed';
agreementStore.state.artists[0].signedAt = new Date().toISOString();

// 5. Now simulate Label Manager remotely removing the submitted signature
console.log('--- Simulating Label remotely removing the submitted signature ---');
const remoteResetState = JSON.parse(JSON.stringify(getDefaultAgreementState()));
remoteResetState.id = 'OBS-AGR-TESTPOLL';
remoteResetState.artists[0].signature = null;
remoteResetState.artists[0].status = 'pending';
remoteResetState.artists[0].submitted = false;

agreementStore.mergeIncomingState(remoteResetState);

console.log('After Label remote removal:');
console.log(' - Artist 1 has signature:', Boolean(agreementStore.state.artists[0].signature));
console.log(' - Artist 1 submitted:', agreementStore.state.artists[0].submitted);

if (!agreementStore.state.artists[0].signature && !agreementStore.state.artists[0].submitted) {
  console.log('✅ SUCCESS: When Label explicitly resets a submitted agreement, artist tab unlocks properly!');
} else {
  console.error('❌ FAILED: Label reset did not unlock the submitted agreement');
  process.exit(1);
}
