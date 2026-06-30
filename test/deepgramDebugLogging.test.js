const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function readRepoFile(fileName) {
  return fs.readFileSync(path.join(__dirname, '..', fileName), 'utf8');
}

test('Deepgram workflow debug console logging is removed after capture diagnostics are no longer needed', () => {
  const main = readRepoFile('main.js');
  const renderer = readRepoFile('renderer.js');
  const service = readRepoFile('src/deepgramTranscriptionService.js');

  assert.doesNotMatch(main, /function logDeepgramWorkflow/);
  assert.doesNotMatch(main, /logDeepgramWorkflow/);
  assert.doesNotMatch(main, /\[Deepgram\]/);
  assert.doesNotMatch(main, /\[Deepgram renderer\]/);
  assert.doesNotMatch(main, /deepgramAudioChunkLogCounts/);
  assert.doesNotMatch(main, /Copied transcript prompt to clipboard/);

  assert.doesNotMatch(renderer, /function logDeepgramWorkflow/);
  assert.doesNotMatch(renderer, /logDeepgramWorkflow/);
  assert.doesNotMatch(renderer, /deepgramWorkflowLogCounts/);
  assert.doesNotMatch(renderer, /\[Deepgram\]/);

  assert.doesNotMatch(service, /function logDeepgramWorkflow/);
  assert.doesNotMatch(service, /logDeepgramWorkflow/);
  assert.doesNotMatch(service, /\[Deepgram\]/);
});
