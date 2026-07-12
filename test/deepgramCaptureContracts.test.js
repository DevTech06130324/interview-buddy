const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function readRepoFile(fileName) {
  return fs.readFileSync(path.join(__dirname, '..', fileName), 'utf8');
}

test('main process grants display capture with Windows loopback audio for Deepgram Them stream', () => {
  const main = readRepoFile('main.js');

  assert.match(main, /desktopCapturer/);
  assert.match(main, /setDisplayMediaRequestHandler/);
  assert.match(main, /desktopCapturer\.getSources\(\{\s*types:\s*\[\s*'screen'\s*\]/);
  assert.match(main, /audio:\s*request\.audioRequested && process\.platform === 'win32'\s*\?\s*'loopback'\s*:\s*undefined/);
});

test('renderer starts available Deepgram audio streams instead of aborting when system audio is unavailable', () => {
  const controller = readRepoFile('src/deepgramCaptureController.js');

  assert.doesNotMatch(controller, /if\s*\(\s*!systemAudioStream\s*\|\|\s*!microphoneAudioStream\s*\)/);
  assert.match(controller, /if\s*\(\s*!microphoneAudioStream\s*\)/);
  assert.match(controller, /if\s*\(\s*systemAudioStream\s*\)\s*\{\s*this\.createRecorder\(DEEPGRAM_ROLE_THEM/);
  assert.match(controller, /this\.createRecorder\(DEEPGRAM_ROLE_ME/);
});

test('renderer delegates acquired media ownership to the tested Deepgram capture controller', () => {
  const html = readRepoFile('index.html');
  const renderer = readRepoFile('renderer.js');

  assert.match(html, /<script src="src\/deepgramCaptureController\.js"><\/script>[\s\S]*<script src="renderer\.js"><\/script>/);
  assert.match(renderer, /new window\.deepgramCaptureController\.DeepgramCaptureController/);
  assert.match(renderer, /deepgramCaptureController\.start\(\)/);
  assert.match(renderer, /deepgramCaptureController\.stop\(\)/);
  assert.doesNotMatch(renderer, /let deepgramCaptureResources/);
});
