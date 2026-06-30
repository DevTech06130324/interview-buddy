const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function readRepoFile(fileName) {
  return fs.readFileSync(path.join(__dirname, '..', fileName), 'utf8');
}

function getFunctionSource(source, name) {
  const startMarker = `function ${name}(`;
  const startIndex = source.indexOf(startMarker);
  assert.notEqual(startIndex, -1, `Expected to find ${name}`);

  let depth = 0;
  let sawOpeningBrace = false;
  for (let index = startIndex; index < source.length; index += 1) {
    const char = source[index];
    if (char === '{') {
      depth += 1;
      sawOpeningBrace = true;
    } else if (char === '}') {
      depth -= 1;
      if (sawOpeningBrace && depth === 0) {
        return source.slice(startIndex, index + 1);
      }
    }
  }

  assert.fail(`Expected to find the end of ${name}`);
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
  assert.match(renderer, /function applyDeepgramCaptureState/);
  assert.match(main, /ipcMain\.on\('deepgram-audio-chunk'/);
  assert.match(main, /webContents\.send\('deepgram-capture-state'/);
});

test('transcript source control uses eye icons for Live Captions and play-stop icons for Deepgram', () => {
  const html = readRepoFile('index.html');
  const css = readRepoFile('styles.css');
  const renderer = readRepoFile('renderer.js');

  assert.match(html, /id="toggleLiveCaptionsBtn"/);
  assert.match(html, /transcript-icon-live-visible/);
  assert.match(html, /transcript-icon-live-hidden/);
  assert.match(html, /transcript-icon-deepgram-play/);
  assert.match(html, /transcript-icon-deepgram-stop/);

  assert.match(css, /\.transcript-icon-btn\.is-deepgram-source\s+\.transcript-icon-deepgram-play/);
  assert.match(css, /\.transcript-icon-btn\.is-deepgram-source\.is-deepgram-running\s+\.transcript-icon-deepgram-stop/);

  assert.match(renderer, /function updateTranscriptSourceControlButton/);
  assert.match(renderer, /is-deepgram-source/);
  assert.match(renderer, /is-deepgram-running/);
  assert.match(renderer, /Start Deepgram transcription/);
  assert.match(renderer, /Stop Deepgram transcription/);
  assert.match(renderer, /Add Deepgram API key in settings/);
});

test('Deepgram transcription starts and stops only through explicit controls', () => {
  const renderer = readRepoFile('renderer.js');
  const preload = readRepoFile('preload.js');
  const main = readRepoFile('main.js');
  const syncCapture = getFunctionSource(renderer, 'syncDeepgramCaptureFromPreferences');
  const startActiveSource = getFunctionSource(main, 'startActiveTranscriptSource');
  const setKeyPreference = getFunctionSource(main, 'setDeepgramApiKeyPreference');

  assert.match(preload, /startDeepgramTranscription:\s*\(\)\s*=>\s*ipcRenderer\.invoke\('start-deepgram-transcription'\)/);
  assert.match(preload, /stopDeepgramTranscription:\s*\(\)\s*=>\s*ipcRenderer\.invoke\('stop-deepgram-transcription'\)/);
  assert.match(main, /ipcMain\.handle\('start-deepgram-transcription'/);
  assert.match(main, /ipcMain\.handle\('stop-deepgram-transcription'/);
  assert.match(renderer, /startDeepgramTranscription/);
  assert.match(renderer, /stopDeepgramTranscription/);

  assert.doesNotMatch(syncCapture, /startDeepgramCapture\(/);
  assert.doesNotMatch(startActiveSource, /startDeepgramTranscriptSource\(\)/);
  assert.doesNotMatch(setKeyPreference, /startDeepgramTranscriptSource\(\)/);
});

test('Deepgram mode exposes session usage and remaining account balance status', () => {
  const html = readRepoFile('index.html');
  const css = readRepoFile('styles.css');
  const renderer = readRepoFile('renderer.js');
  const main = readRepoFile('main.js');
  const preload = readRepoFile('preload.js');

  assert.match(html, /id="deepgramUsageStatus"/);
  assert.match(html, /id="deepgramSessionUsageValue"/);
  assert.match(html, /id="deepgramRemainingUsageValue"/);
  assert.match(css, /\.deepgram-usage-status/);
  assert.match(renderer, /function formatDeepgramSessionDuration/);
  assert.match(renderer, /function updateDeepgramUsageStatus/);
  assert.match(renderer, /deepgramSessionUsageValue/);
  assert.match(renderer, /deepgramRemainingUsageValue/);
  assert.match(preload, /refreshDeepgramUsage:\s*\(\)\s*=>\s*ipcRenderer\.invoke\('refresh-deepgram-usage'\)/);
  assert.match(main, /function getDeepgramUsageSnapshot/);
  assert.match(main, /function refreshDeepgramAccountUsage/);
  assert.match(main, /DEEPGRAM_PROJECTS_ENDPOINT/);
  assert.match(main, /DEEPGRAM_BALANCES_ENDPOINT/);
});
