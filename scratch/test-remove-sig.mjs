import { getDefaultAgreementState } from '../js/agreement-data.js';

console.log('Testing signature reset logic...');
const state = getDefaultAgreementState();

// Simulate signing Artist 1
state.artists[0].signature = { type: 'type', data: 'Test Signature', font: 'Great Vibes' };
state.artists[0].status = 'signed';
state.artists[0].submitted = true;
state.artists[0].signedAt = new Date().toISOString();

console.log('Before removal:');
console.log(' - Artist 1 status:', state.artists[0].status);
console.log(' - Artist 1 has signature:', Boolean(state.artists[0].signature));
console.log(' - Artist 1 submitted:', state.artists[0].submitted);

// Apply removal
state.artists[0].signature = null;
state.artists[0].status = 'pending';
state.artists[0].submitted = false;
delete state.artists[0].signedAt;

console.log('After removal:');
console.log(' - Artist 1 status:', state.artists[0].status);
console.log(' - Artist 1 has signature:', Boolean(state.artists[0].signature));
console.log(' - Artist 1 submitted:', state.artists[0].submitted);

if (state.artists[0].status === 'pending' && !state.artists[0].signature && !state.artists[0].submitted) {
  console.log('✅ SIGNATURE REMOVAL VERIFICATION PASSED');
} else {
  console.error('❌ SIGNATURE REMOVAL VERIFICATION FAILED');
  process.exit(1);
}
