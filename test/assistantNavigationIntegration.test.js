const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function mainSource() {
  return fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
}

test('Electron tab integration uses the popup policy and removes obsolete popup flattening', () => {
  const source = mainSource();

  assert.match(source, /createAssistantNavigationPolicy\(\)/);
  assert.match(source, /setWindowOpenHandler\(/);
  assert.match(source, /did-create-window/);
  assert.match(source, /overrideBrowserWindowOptions/);
  assert.match(source, /nodeIntegration:\s*false/);
  assert.match(source, /contextIsolation:\s*true/);
  assert.match(source, /sandbox:\s*true/);
  assert.doesNotMatch(source, /\.on\('new-window'/);
});

test('tab navigation records failed loads, SPA URL changes, and renderer loss without unhandled load promises', () => {
  const source = mainSource();

  assert.match(source, /function navigateTabTo\(/);
  assert.match(source, /loadPromise\.catch/);
  assert.match(source, /did-fail-load/);
  assert.match(source, /did-navigate-in-page/);
  assert.match(source, /render-process-gone/);
  assert.match(source, /handleTabLoadFailure\(/);
});

test('tab close and renderer loss release a per-tab assistant mutation lease', () => {
  const source = mainSource();

  assert.match(source, /function closeTab\([\s\S]*assistantMutationController\.release\(tabId\)/);
  assert.match(source, /render-process-gone[\s\S]*assistantMutationController\.release\(tabId\)/);
});
