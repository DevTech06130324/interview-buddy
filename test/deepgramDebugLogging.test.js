const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function readRepoFile(fileName) {
  return fs.readFileSync(path.join(__dirname, '..', fileName), 'utf8');
}

test('Deepgram workflow has privacy-safe console diagnostics across capture, IPC, socket, and render boundaries', () => {
  const main = readRepoFile('main.js');
  const renderer = readRepoFile('renderer.js');
  const service = readRepoFile('src/deepgramTranscriptionService.js');

  assert.match(main, /function logDeepgramWorkflow/);
  assert.match(main, /\[Deepgram\]/);
  assert.match(main, /logDeepgramWorkflow\('source-change'/);
  assert.match(main, /logDeepgramWorkflow\('service-started'/);
  assert.match(main, /logDeepgramWorkflow\('audio-chunk-received'/);
  assert.match(main, /logDeepgramWorkflow\('caption-update'/);
  assert.match(main, /console-message/);
  assert.match(main, /\[Deepgram renderer\]/);
  assert.doesNotMatch(main, /logDeepgramWorkflow\([^)]*deepgramApiKey/);

  assert.match(renderer, /function logDeepgramWorkflow/);
  assert.match(renderer, /logDeepgramWorkflow\('capture-start-requested'/);
  assert.match(renderer, /logDeepgramWorkflow\('recorder-started'/);
  assert.match(renderer, /logDeepgramWorkflow\('recorder-chunk'/);
  assert.match(renderer, /logDeepgramWorkflow\('caption-update'/);

  assert.match(service, /function logDeepgramWorkflow/);
  assert.match(service, /logDeepgramWorkflow\('service-start'/);
  assert.match(service, /logDeepgramWorkflow\('socket-open'/);
  assert.match(service, /logDeepgramWorkflow\('audio-chunk-sent'/);
  assert.match(service, /logDeepgramWorkflow\('transcript-message'/);
  assert.doesNotMatch(service, /logDeepgramWorkflow\([^)]*apiKey/);
});
