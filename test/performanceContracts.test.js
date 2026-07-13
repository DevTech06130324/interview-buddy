const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function readRepoFile(fileName) {
  return fs.readFileSync(path.join(__dirname, '..', fileName), 'utf8');
}

test('caption rendering uses payload versions instead of serializing every transcript entry', () => {
  const renderer = readRepoFile('renderer.js');

  assert.match(renderer, /let lastCaptionPayloadVersion = null;/);
  assert.match(renderer, /typeof data\.payloadVersion === 'number'/);
  assert.match(renderer, /lastCaptionPayloadVersion = nextPayloadVersion;/);
  assert.doesNotMatch(renderer, /function getTranscriptEntriesSignature/);
  assert.doesNotMatch(renderer, /getTranscriptEntriesSignature\(nextEntries\)/);
});

test('translation payloads expose a version and reconciliation search is windowed', () => {
  const source = readRepoFile('src/translationManager.js');

  assert.match(source, /this\.payloadVersion = 0;/);
  assert.match(source, /payloadVersion: this\.payloadVersion/);
  assert.match(source, /bumpPayloadVersion\(\)/);
  assert.match(source, /fallbackStartIndex - \(RECONCILE_EXTRA_LOOKBACK \* 2\)/);
  assert.doesNotMatch(source, /for \(let entryStartIndex = 0; entryStartIndex < this\.entries\.length;/);
});

test('mode dropdown skips unchanged renders and selects without artificial click delay', () => {
  const renderer = readRepoFile('renderer.js');
  const modeMenu = readRepoFile('mode-menu.js');

  assert.match(renderer, /let modeDropdownRenderSignature = '';/);
  assert.match(renderer, /function getModeDropdownRenderSignature\(\)/);
  assert.match(renderer, /if \(nextSignature === modeDropdownRenderSignature\) \{/);
  assert.doesNotMatch(renderer, /const MODE_SELECTION_DELAY_MS = 320;/);
  assert.doesNotMatch(renderer, /window\.setTimeout\(async \(\) => \{[\s\S]*?selectPromptModeFromMenu\(mode\.id\)[\s\S]*?\}, MODE_SELECTION_DELAY_MS\)/);
  assert.doesNotMatch(modeMenu, /MODE_SELECTION_DELAY_MS/);
  assert.doesNotMatch(modeMenu, /pendingModeSelectionTimer/);
  assert.doesNotMatch(modeMenu, /window\.setTimeout\(async \(\) => \{[\s\S]*?\{ type: 'select'/);
});

test('mode menu mouse selection keeps rows stable long enough for double-click rename', () => {
  const renderer = readRepoFile('renderer.js');
  const modeMenu = readRepoFile('mode-menu.js');

  assert.match(renderer, /MODE_RENAME_DOUBLE_CLICK_WINDOW_MS/);
  assert.match(renderer, /function scheduleModeDropdownCloseAfterRenameWindow/);
  assert.match(renderer, /function cancelPendingModeDropdownClose/);
  assert.match(renderer, /selectPromptModeFromMenu\(mode\.id, \{ deferCloseForRename: true \}\)/);
  assert.match(renderer, /cancelPendingModeDropdownClose\(\);[\s\S]*startPromptModeRename\(mode\.id, menuElement\)/);
  assert.match(renderer, /if \(isModeDropdownRenderDeferredForRename\(\)\) \{[\s\S]*deferredModeDropdownRenderPending = true;[\s\S]*return;/);
  assert.match(renderer, /case 'begin-rename':[\s\S]*cancelPendingModeDropdownClose\(\);[\s\S]*break;/);

  assert.match(modeMenu, /MODE_RENAME_DOUBLE_CLICK_WINDOW_MS/);
  assert.match(modeMenu, /function deferModeMenuRenderForRenameWindow/);
  assert.match(modeMenu, /function cancelPendingModeMenuRenderDeferral/);
  assert.match(modeMenu, /sendModeMenuAction\(\{ type: 'select', modeId: mode\.id, deferCloseForRename: true \}\)/);
  assert.match(modeMenu, /sendModeMenuAction\(\{ type: 'begin-rename', modeId: mode\.id \}\)/);
  assert.match(modeMenu, /cancelPendingModeMenuRenderDeferral\(\);[\s\S]*startModeRename\(mode\.id\)/);
  assert.match(modeMenu, /if \(isModeMenuRenderDeferredForRename\(\)\) \{[\s\S]*deferredModeMenuRenderPending = true;[\s\S]*return;/);
});

test('tab navigation does not write unrelated persistent preferences', () => {
  const main = readRepoFile('main.js');
  const createTab = main.slice(
    main.indexOf('function createNewTab('),
    main.indexOf('function setupTabListeners(')
  );
  const switchTab = main.slice(
    main.indexOf('function switchTab('),
    main.indexOf('function closeTab(')
  );
  const closeTab = main.slice(
    main.indexOf('function closeTab('),
    main.indexOf('function resizeTabs(')
  );

  for (const source of [createTab, switchTab, closeTab]) {
    assert.doesNotMatch(source, /scheduleAppPreferencesPersist\(/);
  }
});

test('theme and layout switching code is removed for fixed dark horizontal UI', () => {
  const main = readRepoFile('main.js');
  const renderer = readRepoFile('renderer.js');
  const preload = readRepoFile('preload.js');
  const html = readRepoFile('index.html');
  const css = readRepoFile('styles.css');
  const settingsCss = readRepoFile('hotkey-settings.css');
  const modeMenuCss = readRepoFile('mode-menu.css');

  for (const source of [main, renderer, preload, html, css, settingsCss, modeMenuCss]) {
    assert.doesNotMatch(source, /toggleAppTheme|toggleThemeBtn|setAppTheme|cycleLayoutMode|cycleLayoutBtn/);
    assert.doesNotMatch(source, /setLayoutMode|setSwitchActiveView|toggleSwitchActiveView|switchViewTabs/);
    assert.doesNotMatch(source, /data-theme|data-layout-mode|data-switch-active-view/);
    assert.doesNotMatch(source, /:root\[data-theme="light"\]/);
  }
});
