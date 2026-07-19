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
    if (source[index] === '{') {
      depth += 1;
      sawOpeningBrace = true;
    } else if (source[index] === '}') {
      depth -= 1;
      if (sawOpeningBrace && depth === 0) {
        return source.slice(startIndex, index + 1);
      }
    }
  }

  assert.fail(`Expected to find the end of ${name}`);
}

test('settings window is authorized to update prompt mode hotkeys', () => {
  const main = readRepoFile('main.js');

  assert.match(
    main,
    /ipcMain\.handle\('set-prompt-mode-hotkey',\s*\(event,\s*payload\)\s*=>\s*\{\s*if\s*\(!isMainOrHotkeySettingsSender\(event\)\)/s
  );
});

test('settings hotkey capture waits through modifier-only keydown events', () => {
  const settings = readRepoFile('hotkey-settings.js');
  const handler = getFunctionSource(settings, 'handleGlobalHotkeyInputKeydown');

  assert.match(handler, /if\s*\(!hotkeyCapture\)\s*\{\s*return;\s*\}/);
  assert.match(handler, /if\s*\(!hotkeyCapture\.isValid\)\s*\{/);
  assert.doesNotMatch(handler, /if\s*\(!hotkeyCapture\s*\|\|\s*!hotkeyCapture\.isValid\)/);
});
