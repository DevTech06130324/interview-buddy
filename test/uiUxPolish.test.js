const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function readRepoFile(fileName) {
  return fs.readFileSync(path.join(__dirname, '..', fileName), 'utf8');
}

test('transcript panel has a source pill and source-aware empty state', () => {
  const html = readRepoFile('index.html');
  const css = readRepoFile('styles.css');
  const renderer = readRepoFile('renderer.js');

  assert.match(html, /id="transcriptSourcePill"/);
  assert.match(html, /id="transcriptEmptyState"[^>]*role="status"[^>]*aria-live="polite"/s);
  assert.match(html, /id="transcriptEmptyTitle"/);
  assert.match(html, /id="transcriptEmptyCopy"/);

  assert.match(css, /\.transcript-source-pill\s*\{/);
  assert.match(css, /\.transcript-empty-state\s*\{/);
  assert.match(css, /\.transcript-content\.has-transcript-content\s+\.transcript-empty-state\s*\{/);

  assert.match(renderer, /const transcriptSourcePill = document\.getElementById\('transcriptSourcePill'\)/);
  assert.match(renderer, /const transcriptEmptyState = document\.getElementById\('transcriptEmptyState'\)/);
  assert.match(renderer, /function updateTranscriptSourcePill/);
  assert.match(renderer, /function updateTranscriptEmptyState/);
  assert.match(renderer, /Live Captions will appear here when speech is detected\./);
  assert.match(renderer, /Start Deepgram transcription to capture audio\./);
});

test('settings window is framed as settings with transcript, deepgram, and shortcut groups', () => {
  const mainHtml = readRepoFile('index.html');
  const html = readRepoFile('hotkey-settings.html');
  const css = readRepoFile('hotkey-settings.css');

  assert.match(mainHtml, /id="openHotkeySettingsBtn"[^>]*data-protected-tooltip="Settings"[^>]*aria-label="Settings"/s);
  assert.doesNotMatch(mainHtml, /data-protected-tooltip="Hotkey settings"/);

  assert.match(html, /<title>Settings<\/title>/);
  assert.match(html, /id="hotkeyDialogTitle">Settings<\/div>/);
  assert.match(html, /data-protected-tooltip="Close settings"/);
  assert.match(html, /id="transcriptSettingsTitle">Transcript<\/div>/);
  assert.match(html, /id="deepgramSettingsTitle">Deepgram<\/div>/);
  assert.match(html, /id="shortcutSettingsTitle">Shortcuts<\/div>/);
  assert.doesNotMatch(html, /id="hotkeyDialogTitle">Global Hotkeys<\/div>/);

  assert.match(css, /\.settings-section-heading\s*\{/);
  assert.match(css, /\.settings-section \+ \.settings-section\s*\{/);
});

test('main shell uses a production overlay border instead of a dashed debug frame', () => {
  const css = readRepoFile('styles.css');

  assert.match(css, /\.window-wrapper\s*\{[^}]*border:\s*1px solid var\(--overlay-border\);/s);
  assert.match(css, /--overlay-border:/);
  assert.doesNotMatch(css, /\.window-wrapper\s*\{[^}]*border:\s*3px dashed/s);
});
