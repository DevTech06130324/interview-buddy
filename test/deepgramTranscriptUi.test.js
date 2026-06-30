const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function readRepoFile(fileName) {
  return fs.readFileSync(path.join(__dirname, '..', fileName), 'utf8');
}

test('transcript renderer applies role classes for left Them and right Me blocks', () => {
  const renderer = readRepoFile('renderer.js');
  const css = readRepoFile('styles.css');

  assert.match(renderer, /getTranscriptSpeakerRoleClass/);
  assert.match(renderer, /transcript-row-role-them/);
  assert.match(renderer, /transcript-row-role-me/);
  assert.match(css, /\.transcript-row-role-them/);
  assert.match(css, /\.transcript-row-role-me/);
  assert.match(css, /\.transcript-row-role-me\s+\.transcript-entry-body/);
  assert.match(css, /\.transcript-row-role-me\s+\.transcript-entry-header/);
  assert.match(css, /text-align:\s*left/);
});

test('renderer starts and stops Deepgram capture from main-process source state', () => {
  const renderer = readRepoFile('renderer.js');
  const preload = readRepoFile('preload.js');
  const main = readRepoFile('main.js');

  assert.match(preload, /sendDeepgramAudioChunk:\s*\(payload\)\s*=>\s*ipcRenderer\.send\('deepgram-audio-chunk', payload\)/);
  assert.match(preload, /onDeepgramCaptureState:\s*\(callback\)\s*=>\s*subscribe\('deepgram-capture-state', callback\)/);
  assert.match(renderer, /function startDeepgramCapture/);
  assert.match(renderer, /navigator\.mediaDevices\.getDisplayMedia/);
  assert.match(renderer, /navigator\.mediaDevices\.getUserMedia/);
  assert.match(renderer, /new MediaRecorder/);
  assert.match(renderer, /sendDeepgramAudioChunk/);
  assert.match(renderer, /function stopDeepgramCapture/);
  assert.match(main, /ipcMain\.on\('deepgram-audio-chunk'/);
  assert.match(main, /webContents\.send\('deepgram-capture-state'/);
});
