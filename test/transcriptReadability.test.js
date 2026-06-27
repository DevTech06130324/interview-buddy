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

test('transcript panel defaults leave enough room for paragraph-length reading', () => {
  const main = readRepoFile('main.js');
  const renderer = readRepoFile('renderer.js');

  assert.match(main, /const DEFAULT_VERTICAL_TRANSCRIPT_PANEL_RATIO = 0\.35;/);
  assert.match(main, /const DEFAULT_HORIZONTAL_TRANSCRIPT_PANEL_RATIO = 0\.4;/);
  assert.match(main, /const MIN_TRANSCRIPT_PANEL_HEIGHT = 180;/);
  assert.match(main, /const MIN_TRANSCRIPT_PANEL_WIDTH = 280;/);

  assert.match(renderer, /let currentVerticalPanelSplitRatio = 0\.35;/);
  assert.match(renderer, /let currentHorizontalPanelSplitRatio = 0\.4;/);
  assert.match(renderer, /const MIN_TRANSCRIPT_PANEL_HEIGHT = 180;/);
  assert.match(renderer, /const MIN_TRANSCRIPT_PANEL_WIDTH = 280;/);
});

test('transcript rows use readable paragraph typography without heavy controls', () => {
  const css = readRepoFile('styles.css');
  const renderer = readRepoFile('renderer.js');

  assert.match(css, /\.transcript-content\s*\{[^}]*font-size:\s*14px;/s);
  assert.match(css, /\.transcript-content\s*\{[^}]*line-height:\s*1\.55;/s);
  assert.match(css, /\.transcript-cell\s*\{[^}]*padding:\s*12px 16px;/s);
  assert.match(css, /\.transcript-entry-text\s*\{[^}]*max-width:\s*78ch;/s);
  assert.match(css, /\.transcript-cell-translation\s*\{[^}]*max-width:\s*78ch;/s);

  const updateSourceCell = getFunctionSource(renderer, 'updateTranscriptSourceCell');
  const createTranscriptRow = getFunctionSource(renderer, 'createTranscriptRow');
  assert.doesNotMatch(updateSourceCell, /createElement\('button'\)/);
  assert.doesNotMatch(createTranscriptRow, /addEventListener\('click'/);
});
