const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function readRepoFile(fileName) {
  return fs.readFileSync(path.join(__dirname, '..', fileName), 'utf8');
}

test('caption rendering uses payload versions instead of serializing every transcript entry', () => {
  const renderer = readRepoFile('renderer.js');

  assert.match(renderer, /let lastCaptionPayloadVersion = null;/);
  assert.match(renderer, /typeof data\.payloadVersion === 'number'/);
  assert.match(renderer, /lastCaptionPayloadVersion = nextPayloadVersion;/);
  assert.doesNotMatch(renderer, /function getTranscriptEntriesSignature/);
  assert.doesNotMatch(renderer, /getTranscriptEntriesSignature\(nextEntries\)/);
});

test('translation payloads expose a version and reconciliation search is windowed', () => {
  const source = readRepoFile('src/translationManager.js');

  assert.match(source, /this\.payloadVersion = 0;/);
  assert.match(source, /payloadVersion: this\.payloadVersion/);
  assert.match(source, /bumpPayloadVersion\(\)/);
  assert.match(source, /fallbackStartIndex - \(RECONCILE_EXTRA_LOOKBACK \* 2\)/);
  assert.doesNotMatch(source, /for \(let entryStartIndex = 0; entryStartIndex < this\.entries\.length;/);
});

test('mode dropdown skips unchanged renders and selects without artificial click delay', () => {
  const renderer = readRepoFile('renderer.js');
  const modeMenu = readRepoFile('mode-menu.js');

  assert.match(renderer, /let modeDropdownRenderSignature = '';/);
  assert.match(renderer, /function getModeDropdownRenderSignature\(\)/);
  assert.match(renderer, /if \(nextSignature === modeDropdownRenderSignature\) \{/);
  assert.doesNotMatch(renderer, /const MODE_SELECTION_DELAY_MS = 320;/);
  assert.doesNotMatch(renderer, /window\.setTimeout\(async \(\) => \{[\s\S]*?selectPromptModeFromMenu\(mode\.id\)[\s\S]*?\}, MODE_SELECTION_DELAY_MS\)/);
  assert.doesNotMatch(modeMenu, /MODE_SELECTION_DELAY_MS/);
  assert.doesNotMatch(modeMenu, /pendingModeSelectionTimer/);
  assert.doesNotMatch(modeMenu, /window\.setTimeout\(async \(\) => \{[\s\S]*?\{ type: 'select'/);
});
