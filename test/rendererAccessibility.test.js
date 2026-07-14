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

test('icon controls have accessible names, protected tooltips, and a textual hotkey status', () => {
  const html = readRepoFile('index.html');
  const renderer = readRepoFile('renderer.js');

  for (const control of [
    'newTabBtn',
    'backBtn',
    'forwardBtn',
    'reloadBtn'
  ]) {
    const controlPattern = new RegExp(`<button[^>]*id="${control}"[^>]*(?:aria-label|data-protected-tooltip)`, 's');
    assert.match(html, controlPattern, `${control} needs an accessible name and tooltip`);
  }

  assert.match(html, /id="modeHotkeyStatus"[^>]*role="status"[^>]*aria-live="polite"/s);
  assert.match(html, /id="modeHotkeyInput"[^>]*aria-describedby="modeHotkeyStatus"/s);
  assert.match(renderer, /const modeHotkeyStatusText = document\.getElementById\('modeHotkeyStatus'\)/);
  assert.match(getFunctionSource(renderer, 'setModeHotkeyStatus'), /modeHotkeyStatusText\.textContent/);

  const createTab = getFunctionSource(renderer, 'createTabElement');
  assert.match(createTab, /setProtectedTooltip\(close,/);
  assert.match(createTab, /close\.addEventListener\('keydown'/);
});

test('the panel splitter supports keyboard resizing in ten-pixel steps', () => {
  const html = readRepoFile('index.html');
  const renderer = readRepoFile('renderer.js');

  assert.match(html, /id="panelDivider"[^>]*tabindex="0"/s);
  assert.match(html, /id="panelDivider"[^>]*aria-valuemin=/s);
  assert.match(html, /id="panelDivider"[^>]*aria-valuemax=/s);
  assert.match(html, /id="panelDivider"[^>]*aria-valuenow=/s);
  assert.match(renderer, /const PANEL_KEYBOARD_RESIZE_STEP_PX = 10;/);
  assert.match(renderer, /function handlePanelDividerKeydown/);

  const handler = getFunctionSource(renderer, 'handlePanelDividerKeydown');
  assert.match(handler, /event\.key === 'ArrowLeft'/);
  assert.match(handler, /event\.key === 'ArrowRight'/);
  assert.match(handler, /PANEL_KEYBOARD_RESIZE_STEP_PX/);
  assert.match(handler, /queuePanelSplitRatioSync/);
  assert.match(renderer, /function updatePanelDividerAccessibility/);
});

test('tab close controls cannot also activate their containing tab', () => {
  const renderer = readRepoFile('renderer.js');
  const createTab = getFunctionSource(renderer, 'createTabElement');

  assert.match(renderer, /function isTabCloseControl/);
  assert.match(createTab, /isTabCloseControl\(event\.target\)/);
  assert.match(createTab, /event\.stopPropagation\(\)/);
  assert.match(createTab, /close\.addEventListener\('keydown'/);
});

test('mode menus use roving focus and preserve the rename double-click window for inline updates', () => {
  const renderer = readRepoFile('renderer.js');
  const modeMenu = readRepoFile('mode-menu.js');

  assert.match(renderer, /function handleModeDropdownRovingFocus/);
  assert.match(renderer, /event\.key === 'ArrowDown'/);
  assert.match(renderer, /event\.key === 'ArrowUp'/);
  assert.match(renderer, /event\.key === 'Home'/);
  assert.match(renderer, /event\.key === 'End'/);
  const updatePromptModeStateStart = renderer.indexOf('function updatePromptModeState(');
  const updatePromptModeStateEnd = renderer.indexOf('async function applyIncomingPromptModeState(');
  assert.notEqual(updatePromptModeStateStart, -1);
  assert.notEqual(updatePromptModeStateEnd, -1);
  assert.match(
    renderer.slice(updatePromptModeStateStart, updatePromptModeStateEnd),
    /renderModeDropdownMenuUnlessDeferred\(\);/
  );

  assert.match(modeMenu, /function handleModeMenuRovingFocus/);
  assert.match(modeMenu, /function updateModeMenuRovingTabStop/);
  assert.match(modeMenu, /event\.key === 'ArrowDown'/);
  assert.match(modeMenu, /event\.key === 'ArrowUp'/);
  assert.match(modeMenu, /event\.key === 'Home'/);
  assert.match(modeMenu, /event\.key === 'End'/);
});

test('the compact layout keeps browser workspace available, scrolls mode content, and keeps transcript rows readable', () => {
  const css = readRepoFile('styles.css');
  const html = readRepoFile('index.html');
  const renderer = readRepoFile('renderer.js');

  assert.match(css, /\.browser-container\s*\{[^}]*flex:\s*1\s+1\s+0;/s);
  assert.match(css, /\.browser-container\s*\{[^}]*min-height:\s*var\(--minimum-browser-workspace-height\);/s);
  assert.match(css, /\.browser-container\s*\{[^}]*overflow:\s*hidden;/s);
  assert.match(css, /\.left-panel\s*\{[^}]*overflow:\s*hidden;/s);
  assert.match(css, /\.right-panel\s*\{[^}]*overflow:\s*hidden;/s);
  assert.match(css, /\.content-area\s*\{[^}]*flex:\s*1\s+1\s+0;/s);
  assert.match(css, /--mode-panel-expanded-height:\s*248px;/);
  assert.match(readRepoFile('main.js'), /const MODE_PANEL_HEIGHT = 248;/);
  assert.match(css, /\.mode-panel\s*\{[^}]*flex:\s*0\s+1\s+var\(--mode-panel-expanded-height\);/s);
  assert.match(css, /\.mode-panel\s*\{[^}]*max-height:\s*calc\(100%\s*-\s*var\(--app-headbar-height\)\s*-\s*var\(--minimum-browser-workspace-height\)\);/s);
  assert.match(css, /\.mode-content\s*\{[^}]*overflow-y:\s*visible;/s);
  assert.doesNotMatch(css, /\.mode-content\s*\{[^}]*overflow-y:\s*auto;/s);
  assert.match(css, /@container\s+transcript-panel\s*\(max-width:\s*520px\)/);
  assert.match(html, /id="transcript"[^>]*role="log"[^>]*aria-live="polite"[^>]*aria-relevant="additions text"/s);
  assert.match(renderer, /row\.setAttribute\('aria-label', getTranscriptRowAriaLabel\(entry\)\)/);
  assert.match(css, /\.transcript-row\s*\{[^}]*width:\s*100%;/s);
  assert.match(css, /\.transcript-row\s*\{[^}]*max-width:\s*none;/s);
  assert.match(css, /\.transcript-row-role-them\s*\{[^}]*align-self:\s*flex-start;/s);
  assert.match(css, /\.transcript-row-role-me\s*\{[^}]*align-self:\s*flex-start;/s);
  assert.doesNotMatch(css, /\.transcript-row-role-me\s*\{[^}]*align-self:\s*flex-end;/s);
});
