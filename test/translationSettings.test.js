const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function readRepoFile(fileName) {
  return fs.readFileSync(path.join(__dirname, '..', fileName), 'utf8');
}

test('translation manager can disable translation work while keeping source entries', () => {
  const translationManager = require('../src/translationManager');

  translationManager.reset('');
  translationManager.setTranslationEnabled(false);

  const payload = translationManager.update('Hello there.');

  assert.equal(payload.translationEnabled, false);
  assert.equal(payload.entries.length, 1);
  assert.equal(payload.entries[0].sourceText, 'Hello there.');
  assert.equal(payload.entries[0].translatedText, '');
  assert.equal(payload.entries[0].status, 'disabled');
  assert.equal(translationManager.translationQueue.length, 0);

  translationManager.reset('');
  translationManager.setTranslationEnabled(true);
});

test('translation manager payload version changes only for new caption text', () => {
  const translationManager = require('../src/translationManager');

  translationManager.reset('');
  translationManager.setTranslationEnabled(false);

  const firstPayload = translationManager.update('Hello there.');
  const duplicatePayload = translationManager.update('Hello there.');
  const changedPayload = translationManager.update('Hello there. New detail.');

  assert.equal(duplicatePayload.payloadVersion, firstPayload.payloadVersion);
  assert.ok(changedPayload.payloadVersion > duplicatePayload.payloadVersion);

  translationManager.reset('');
  translationManager.setTranslationEnabled(true);
});

test('settings window exposes a translation enable toggle', () => {
  const html = readRepoFile('hotkey-settings.html');
  const js = readRepoFile('hotkey-settings.js');
  const preload = readRepoFile('preload.js');
  const main = readRepoFile('main.js');

  assert.match(html, /id="translationEnabledToggle"/);
  assert.match(js, /translationEnabledToggle/);
  assert.match(js, /setTranslationEnabled/);
  assert.match(preload, /setTranslationEnabled/);
  assert.match(main, /set-translation-enabled/);
  assert.match(main, /translationManager\.setTranslationEnabled/);
});

test('translation starts opt-in so speech is not sent to translation by default', () => {
  const main = readRepoFile('main.js');
  const renderer = readRepoFile('renderer.js');
  const manager = readRepoFile('src/translationManager.js');
  const settings = readRepoFile('hotkey-settings.js');

  assert.match(main, /const DEFAULT_TRANSLATION_ENABLED = false;/);
  assert.match(renderer, /let translationEnabled = false;/);
  assert.match(manager, /this\.translationEnabled = false;/);
  assert.match(settings, /let translationEnabled = false;/);
  assert.match(settings, /updateTranslationEnabledToggle\(false\)/);
});

test('transcript UI stacks translation below each source sentence', () => {
  const css = readRepoFile('styles.css');
  const renderer = readRepoFile('renderer.js');

  assert.match(css, /\.transcript-row\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/s);
  assert.match(css, /\.transcript-cell-translation\s*\{[^}]*border-top:/s);
  assert.doesNotMatch(css, /\.transcript-cell-source\s*\{[^}]*border-right:/s);
  assert.match(renderer, /'disabled'/);
  assert.match(renderer, /is-translation-disabled/);
});

test('show/hide translation button is disabled when translation is disabled', () => {
  const renderer = readRepoFile('renderer.js');

  assert.match(renderer, /toggleTranslationBtn\.disabled\s*=\s*!translationEnabled/);
  assert.match(renderer, /aria-disabled',\s*String\(!translationEnabled\)/);
  assert.match(renderer, /classList\.toggle\('is-translation-disabled', !translationEnabled\)/);
  assert.match(renderer, /if\s*\(!translationEnabled\)\s*\{\s*return;\s*\}/);
});

test('disabled translation button has a distinct visual state and clear tooltip copy', () => {
  const renderer = readRepoFile('renderer.js');
  const css = readRepoFile('styles.css');

  assert.match(renderer, /Enable translation in settings/);
  assert.match(css, /\.transcript-icon-btn\.is-translation-disabled/);
  assert.match(css, /\.transcript-icon-btn\.is-translation-disabled::after/);
});

test('show/hide translation button pressed state matches translation visibility', () => {
  const renderer = readRepoFile('renderer.js');

  assert.match(renderer, /aria-pressed',\s*String\(translationsVisible\)/);
  assert.doesNotMatch(renderer, /aria-pressed',\s*String\(!translationsVisible\)/);
});
