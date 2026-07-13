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

test('transcript role rendering declares the Me speaker token used by caption updates', () => {
  const renderer = readRepoFile('renderer.js');
  const roleClassHelper = getFunctionSource(renderer, 'getTranscriptSpeakerRoleClass');

  assert.match(roleClassHelper, /DEEPGRAM_ROLE_ME/);
  assert.match(renderer, /const DEEPGRAM_ROLE_ME = 'Me';/);
});

test('renderer starts and stops Deepgram capture from main-process source state', () => {
  const renderer = readRepoFile('renderer.js');
  const captureController = readRepoFile('src/deepgramCaptureController.js');
  const preload = readRepoFile('preload.js');
  const main = readRepoFile('main.js');

  assert.match(preload, /sendDeepgramAudioChunk:\s*\(payload\)\s*=>\s*ipcRenderer\.send\('deepgram-audio-chunk', payload\)/);
  assert.match(preload, /onDeepgramCaptureState:\s*\(callback\)\s*=>\s*subscribe\('deepgram-capture-state', callback\)/);
  assert.match(renderer, /function startDeepgramCapture/);
  assert.match(captureController, /mediaDevices\.getDisplayMedia/);
  assert.match(captureController, /mediaDevices\.getUserMedia/);
  assert.match(captureController, /new this\.MediaRecorderImpl/);
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

test('Deepgram API-key edits always update desired lifecycle state without phase inspection', () => {
  const main = readRepoFile('main.js');
  const setKeyPreference = getFunctionSource(main, 'setDeepgramApiKeyPreference');

  assert.match(setKeyPreference, /transcriptSource === TRANSCRIPT_SOURCE_DEEPGRAM && deepgramApiKey/);
  assert.match(setKeyPreference, /await getDeepgramLifecycleCoordinator\(\)\.setApiKey\(\{ apiKey: deepgramApiKey \}\)/);
  assert.doesNotMatch(setKeyPreference, /getState\?\.\(\)\.(?:active|phase|reason)/);
  assert.doesNotMatch(setKeyPreference, /rotateApiKey/);
  assert.doesNotMatch(setKeyPreference, /'connecting'|'awaiting-renderer'|'reconnecting'|'stopping'/);
});

test('main and renderer use acknowledged capture commands around the tested lifecycle coordinator', () => {
  const renderer = readRepoFile('renderer.js');
  const preload = readRepoFile('preload.js');
  const main = readRepoFile('main.js');

  assert.match(main, /DeepgramLifecycleCoordinator/);
  assert.match(main, /DeepgramRendererCommandBroker/);
  assert.match(main, /render-process-gone/);
  assert.match(main, /deepgramRendererCommandBroker\?\.cancelAll\(\)/);
  assert.match(main, /ipcMain\.handle\('deepgram-capture-command-ack'/);
  assert.match(main, /await getDeepgramLifecycleCoordinator\(\)\.start/);
  assert.match(main, /await getDeepgramLifecycleCoordinator\(\)\.stop/);
  assert.match(main, /await getDeepgramLifecycleCoordinator\(\)\.clear\(\)/);
  assert.match(main, /await getDeepgramLifecycleCoordinator\(\)\.shutdown\(\)/);
  assert.match(main, /failClosed\(error, \{ revision/);
  assert.doesNotMatch(main, /deepgramTranscriptionService\.clear\(\)/);
  assert.match(preload, /acknowledgeDeepgramCaptureCommand:\s*\(payload\)\s*=>\s*ipcRenderer\.invoke\('deepgram-capture-command-ack', payload\)/);
  assert.match(preload, /onDeepgramCaptureCommand:\s*\(callback\)\s*=>\s*subscribe\('deepgram-capture-command', callback\)/);
  assert.match(renderer, /onDeepgramCaptureCommand\(async \(command\)\s*=>/);
  assert.match(renderer, /await startDeepgramCapture\(\)/);
  assert.match(renderer, /await stopDeepgramCapture\(\)/);
  assert.match(renderer, /acknowledgeDeepgramCaptureCommand/);
});

test('Deepgram mode exposes only remaining account balance status', () => {
  const html = readRepoFile('index.html');
  const css = readRepoFile('styles.css');
  const renderer = readRepoFile('renderer.js');
  const main = readRepoFile('main.js');
  const preload = readRepoFile('preload.js');
  const usageSnapshot = getFunctionSource(main, 'getDeepgramUsageSnapshot');
  const refreshUsageStatus = getFunctionSource(renderer, 'refreshDeepgramUsageStatus');

  assert.match(html, /id="deepgramUsageStatus"/);
  assert.match(html, /id="deepgramRemainingUsageValue"/);
  assert.doesNotMatch(html, /deepgramSessionUsageValue/);
  assert.doesNotMatch(html, /Session 00:00/);
  assert.doesNotMatch(html, /deepgram-usage-separator/);
  assert.match(css, /\.deepgram-usage-status/);
  assert.match(renderer, /function updateDeepgramUsageStatus/);
  assert.doesNotMatch(renderer, /formatDeepgramSessionDuration/);
  assert.doesNotMatch(renderer, /getDeepgramSessionElapsedSeconds/);
  assert.doesNotMatch(renderer, /deepgramSessionUsageValue/);
  assert.doesNotMatch(renderer, /deepgramUsageTimer/);
  assert.match(renderer, /deepgramRemainingUsageValue/);
  assert.match(renderer, /DEEPGRAM_USAGE_REFRESH_INTERVAL_MS/);
  assert.match(renderer, /deepgramUsageRefreshInFlight/);
  assert.match(refreshUsageStatus, /Date\.now\(\) - deepgramUsageLastRequestedAtMs/);
  assert.match(refreshUsageStatus, /deepgramUsageRefreshInFlight/);
  assert.match(preload, /refreshDeepgramUsage:\s*\(\)\s*=>\s*ipcRenderer\.invoke\('refresh-deepgram-usage'\)/);
  assert.match(main, /function getDeepgramUsageSnapshot/);
  assert.match(main, /function refreshDeepgramAccountUsage/);
  assert.match(usageSnapshot, /if\s*\(!deepgramApiKey\)/);
  assert.match(usageSnapshot, /remainingText:\s*'Add API key'/);
  assert.doesNotMatch(usageSnapshot, /accountStatus/);
  assert.doesNotMatch(usageSnapshot, /updatedAtMs/);
  assert.doesNotMatch(usageSnapshot, /error/);
  assert.match(main, /deepgramUsageRefreshApiKey/);
  assert.match(main, /const requestApiKey = deepgramApiKey/);
  assert.match(main, /fetchDeepgramJson\(DEEPGRAM_PROJECTS_ENDPOINT, requestApiKey\)/);
  assert.match(main, /deepgramUsageRefreshPromise === refreshPromise/);
  assert.doesNotMatch(main, /formatDeepgramSessionDuration/);
  assert.doesNotMatch(main, /sessionUsageText/);
  assert.doesNotMatch(main, /sessionElapsedSeconds/);
  assert.match(main, /DEEPGRAM_PROJECTS_ENDPOINT/);
  assert.match(main, /DEEPGRAM_BALANCES_ENDPOINT/);
});
