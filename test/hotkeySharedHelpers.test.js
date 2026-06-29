const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function readRepoFile(fileName) {
  return fs.readFileSync(path.join(__dirname, '..', fileName), 'utf8');
}

test('renderer windows share hotkey formatting and capture helpers', () => {
  const indexHtml = readRepoFile('index.html');
  const hotkeySettingsHtml = readRepoFile('hotkey-settings.html');
  const modeMenuHtml = readRepoFile('mode-menu.html');
  const renderer = readRepoFile('renderer.js');
  const hotkeySettings = readRepoFile('hotkey-settings.js');
  const modeMenu = readRepoFile('mode-menu.js');
  const helpers = readRepoFile('src/hotkeyHelpers.js');

  assert.match(indexHtml, /src="src\/hotkeyHelpers\.js"[\s\S]*src="renderer\.js"/);
  assert.match(hotkeySettingsHtml, /src="src\/hotkeyHelpers\.js"[\s\S]*src="hotkey-settings\.js"/);
  assert.match(modeMenuHtml, /src="src\/hotkeyHelpers\.js"[\s\S]*src="mode-menu\.js"/);
  assert.match(renderer, /const \{\s*formatHotkeyForDisplay,\s*getHotkeyCaptureFromEvent\s*\} = window\.hotkeyHelpers;/);
  assert.match(hotkeySettings, /const \{\s*formatHotkeyForDisplay,\s*getHotkeyCaptureFromEvent\s*\} = window\.hotkeyHelpers;/);
  assert.match(modeMenu, /const \{\s*formatHotkeyForDisplay\s*\} = window\.hotkeyHelpers;/);

  assert.equal((renderer.match(/function formatHotkeyPartForDisplay/g) || []).length, 0);
  assert.equal((renderer.match(/function formatHotkeyForDisplay/g) || []).length, 0);
  assert.equal((renderer.match(/function getHotkeyKeyFromEvent/g) || []).length, 0);
  assert.equal((renderer.match(/function getHotkeyCaptureFromEvent/g) || []).length, 0);
  assert.equal((hotkeySettings.match(/function formatHotkeyPartForDisplay/g) || []).length, 0);
  assert.equal((hotkeySettings.match(/function formatHotkeyForDisplay/g) || []).length, 0);
  assert.equal((hotkeySettings.match(/function getHotkeyKeyFromEvent/g) || []).length, 0);
  assert.equal((hotkeySettings.match(/function getHotkeyCaptureFromEvent/g) || []).length, 0);
  assert.equal((modeMenu.match(/function formatHotkeyPartForDisplay/g) || []).length, 0);
  assert.equal((modeMenu.match(/function formatHotkeyForDisplay/g) || []).length, 0);

  assert.match(helpers, /function formatHotkeyPartForDisplay/);
  assert.match(helpers, /function formatHotkeyForDisplay/);
  assert.match(helpers, /function getHotkeyCaptureFromEvent/);
  assert.match(helpers, /root\.hotkeyHelpers = Object\.freeze/);
});

test('shared hotkey helpers preserve display and capture behavior', () => {
  const {
    formatHotkeyForDisplay,
    getHotkeyCaptureFromEvent
  } = require('../src/hotkeyHelpers');

  assert.equal(formatHotkeyForDisplay('CommandOrControl+Shift+PageDown'), 'Ctrl+Shift+PgDn');
  assert.equal(
    formatHotkeyForDisplay('CommandOrControl + Shift + PageDown', {
      separator: ' + ',
      trimParts: true
    }),
    'Ctrl + Shift + PgDn'
  );
  assert.deepEqual(getHotkeyCaptureFromEvent({
    code: 'KeyK',
    key: 'k',
    ctrlKey: true,
    altKey: false,
    shiftKey: true,
    metaKey: false
  }), {
    accelerator: 'CommandOrControl+Shift+K',
    displayValue: 'Ctrl+Shift+K',
    isValid: true
  });
  assert.deepEqual(getHotkeyCaptureFromEvent({
    code: 'F2',
    key: 'F2',
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    metaKey: false
  }), {
    accelerator: 'F2',
    displayValue: 'F2',
    isValid: true
  });
  assert.equal(getHotkeyCaptureFromEvent({
    code: '',
    key: 'Dead',
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    metaKey: false
  }), null);
});
