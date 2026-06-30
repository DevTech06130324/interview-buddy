const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function readRepoFile(fileName) {
  return fs.readFileSync(path.join(__dirname, '..', fileName), 'utf8');
}

test('transcript header exposes a save transcript button', () => {
  const html = readRepoFile('index.html');
  const renderer = readRepoFile('renderer.js');
  const preload = readRepoFile('preload.js');

  assert.match(html, /id="saveTranscriptBtn"/);
  assert.match(html, /data-protected-tooltip="Save transcript as file"/);
  assert.match(html, /aria-label="Save transcript as file"/);
  assert.match(renderer, /const saveTranscriptBtn = document\.getElementById\('saveTranscriptBtn'\)/);
  assert.match(renderer, /window\.electronAPI\.saveTranscript\(\)/);
  assert.match(renderer, /setButtonBusy\(saveTranscriptBtn,\s*true\)/);
  assert.match(preload, /saveTranscript:\s*\(\)\s*=>\s*ipcRenderer\.invoke\('save-transcript'\)/);
});

test('main process saves the whole transcript through a native save dialog', () => {
  const main = readRepoFile('main.js');

  assert.match(main, /dialog\s*}/);
  assert.match(main, /const TRANSCRIPT_SAVE_DEFAULT_BASENAME = 'company name-meeting name';/);
  assert.match(main, /function formatTranscriptSaveDate\(date = new Date\(\)\)/);
  assert.match(main, /function getTranscriptSaveDefaultFilename\(date = new Date\(\)\)/);
  assert.match(main, /TRANSCRIPT_SAVE_DEFAULT_BASENAME}\-\$\{formatTranscriptSaveDate\(date\)}\.txt/);
  assert.match(main, /function getSavedTranscriptText\(\)/);
  assert.match(main, /formatTranscriptEntryPromptLine\(entry, \{\s*includeSpeaker: shouldIncludeTranscriptSpeaker\(entry,\s*index,\s*normalizedTranscriptEntries\[index - 1\]\)\s*\}\)/);
  assert.match(main, /dialog\.showSaveDialog/);
  assert.match(main, /defaultPath:\s*path\.join\(\s*app\.getPath\('documents'\),\s*getTranscriptSaveDefaultFilename\(\)\s*\)/);
  assert.match(main, /fs\.promises\.writeFile\(filePath,\s*transcriptFileText,\s*'utf8'\)/);
  assert.match(main, /ipcMain\.handle\('save-transcript'/);
  assert.match(main, /isMainWindowSender\(event\)/);
});
