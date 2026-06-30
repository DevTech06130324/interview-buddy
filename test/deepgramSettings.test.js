const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function readRepoFile(fileName) {
  return fs.readFileSync(path.join(__dirname, '..', fileName), 'utf8');
}

test('settings expose transcript source switching and masked Deepgram key controls', () => {
  const html = readRepoFile('hotkey-settings.html');
  const js = readRepoFile('hotkey-settings.js');
  const preload = readRepoFile('preload.js');
  const main = readRepoFile('main.js');

  assert.match(html, /id="transcriptSourceSelect"/);
  assert.match(html, /value="live-captions"[\s\S]*Live Captions/);
  assert.match(html, /value="deepgram"[\s\S]*Deepgram/);
  assert.match(html, /id="deepgramApiKeyInput"/);
  assert.match(html, /id="saveDeepgramApiKeyBtn"/);
  assert.match(html, /id="clearDeepgramApiKeyBtn"/);

  assert.match(js, /function maskDeepgramApiKey/);
  assert.match(js, /deepgramApiKeyLast4/);
  assert.match(js, /setTranscriptSource/);
  assert.match(js, /setDeepgramApiKey/);
  assert.match(js, /clearDeepgramApiKey/);

  assert.match(preload, /setTranscriptSource:\s*\(source\)\s*=>\s*ipcRenderer\.invoke\('set-transcript-source', source\)/);
  assert.match(preload, /setDeepgramApiKey:\s*\(apiKey\)\s*=>\s*ipcRenderer\.invoke\('set-deepgram-api-key', apiKey\)/);
  assert.match(preload, /clearDeepgramApiKey:\s*\(\)\s*=>\s*ipcRenderer\.invoke\('clear-deepgram-api-key'\)/);

  assert.match(main, /const TRANSCRIPT_SOURCE_LIVE_CAPTIONS = 'live-captions';/);
  assert.match(main, /const TRANSCRIPT_SOURCE_DEEPGRAM = 'deepgram';/);
  assert.match(main, /deepgramApiKeyLast4/);
  assert.match(main, /hasDeepgramApiKey/);
  assert.match(main, /safeStorage/);
});

test('renderer snapshots do not expose the raw Deepgram API key', () => {
  const main = readRepoFile('main.js');

  assert.doesNotMatch(main, /deepgramApiKey:\s*deepgramApiKey/);
  assert.doesNotMatch(main, /apiKey:\s*deepgramApiKey/);
  assert.match(main, /deepgramApiKeyStorage/);
  assert.match(main, /getRendererAppPreferenceStateSnapshot/);
  assert.match(main, /getPersistedAppPreferenceStateSnapshot/);
});
