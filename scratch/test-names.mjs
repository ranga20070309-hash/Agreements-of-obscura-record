import { renderDocument } from '../js/document-renderer.js';
import { getDefaultAgreementState } from '../js/agreement-data.js';

const state = getDefaultAgreementState();
state.artists = [
  { id: 'art-1', role: 'Recording Artist', legalName: '', stageName: 'Artist 1 Alias' },
  { id: 'art-2', role: 'Featured Artist', legalName: 'Chamod', stageName: 'cnmx' },
  { id: 'art-3', role: 'Featured Artist', legalName: 'pasi', stageName: 'PASINDU007' },
  { id: 'art-4', role: 'Collaborator', legalName: '', stageName: 'GhostProducer' }
];

const mockContainer = { innerHTML: '' };
renderDocument(state, mockContainer);

const html = mockContainer.innerHTML;

function assert(condition, message) {
  if (!condition) {
    console.error('FAIL:', message);
    process.exit(1);
  } else {
    console.log('PASS:', message);
  }
}

// 1. Artist 2 (Chamod / cnmx) - Real name Chamod, Artist name cnmx:
// Header MUST display Artist name (cnmx), while LEGAL NAME displays Chamod!
assert(html.includes('FOR AND ON BEHALF OF Featured Artist:</div>\n            <div class="party-entity-name">cnmx</div>'), 'Artist 2 header must show Artist Name (cnmx)');
assert(html.includes('<span class="sig-meta-val">Chamod</span>'), 'Artist 2 legal name must be Chamod');
assert(html.includes('<span class="sig-meta-val">cnmx</span>'), 'Artist 2 stage name must be cnmx');

// 2. Artist 3 (pasi / PASINDU007) - Real name pasi, Artist name PASINDU007:
// Header MUST display Artist name (PASINDU007), while LEGAL NAME displays pasi!
assert(html.includes('FOR AND ON BEHALF OF Featured Artist:</div>\n            <div class="party-entity-name">PASINDU007</div>'), 'Artist 3 header must show Artist Name (PASINDU007)');
assert(html.includes('<span class="sig-meta-val">pasi</span>'), 'Artist 3 legal name must be pasi');
assert(html.includes('<span class="sig-meta-val">PASINDU007</span>'), 'Artist 3 stage name must be PASINDU007');

// 3. Artist 4 (No legal name, stageName = GhostProducer):
assert(html.includes('FOR AND ON BEHALF OF Collaborator:</div>\n            <div class="party-entity-name">GhostProducer</div>'), 'Artist 4 header must show GhostProducer');
assert(html.includes('<span class="sig-meta-val">[Artist Legal Name]</span>'), 'Artist 4 legal name must be [Artist Legal Name]');
assert(html.includes('<span class="sig-meta-val">GhostProducer</span>'), 'Artist 4 stage name must be GhostProducer');

console.log('ALL TESTS PASSED: Header shows Artist Name, Metadata shows Legal Name & Stage Name accurately!');
