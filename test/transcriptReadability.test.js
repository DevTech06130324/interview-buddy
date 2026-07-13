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

test('fixed horizontal transcript panel defaults leave enough room for paragraph-length reading', () => {
  const main = readRepoFile('main.js');
  const renderer = readRepoFile('renderer.js');

  assert.match(main, /const DEFAULT_HORIZONTAL_TRANSCRIPT_PANEL_RATIO = 0\.4;/);
  assert.match(main, /const MIN_TRANSCRIPT_PANEL_WIDTH = 280;/);
  assert.doesNotMatch(main, /DEFAULT_VERTICAL_TRANSCRIPT_PANEL_RATIO/);
  assert.doesNotMatch(main, /layoutMode/);

  assert.match(renderer, /let currentPanelSplitRatio = 0\.4;/);
  assert.match(renderer, /const MIN_TRANSCRIPT_PANEL_WIDTH = 280;/);
  assert.doesNotMatch(renderer, /currentHorizontalPanelSplitRatio/);
  assert.doesNotMatch(renderer, /currentVerticalPanelSplitRatio/);
  assert.doesNotMatch(renderer, /currentLayoutMode/);
});

test('fixed horizontal transcript panel starts expanded without collapse controls', () => {
  const html = readRepoFile('index.html');
  const main = readRepoFile('main.js');
  const renderer = readRepoFile('renderer.js');

  assert.match(html, /<div class="left-panel">/);
  assert.doesNotMatch(html, /<div class="left-panel is-collapsed">/);
  assert.doesNotMatch(html, /toggleTranscriptPanelBtn/);
  assert.doesNotMatch(main, /isTranscriptPanelCollapsed/);
  assert.doesNotMatch(renderer, /updateTranscriptPanelCollapsed/);
});

test('transcript rows show metadata above text with responsive secondary translation', () => {
  const css = readRepoFile('styles.css');
  const renderer = readRepoFile('renderer.js');
  const html = readRepoFile('index.html');

  assert.match(css, /\.transcript-content\s*\{[^}]*font-size:\s*14px;/s);
  assert.match(css, /\.transcript-content\s*\{[^}]*line-height:\s*1\.55;/s);
  assert.match(css, /\.transcript-cell\s*\{[^}]*padding:\s*12px 16px;/s);
  assert.match(css, /\.transcript-entry-header\s*\{/);
  assert.match(css, /\.transcript-entry-body\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s+minmax\(0,\s*1fr\)/s);
  assert.match(css, /@container transcript-panel \(max-width: 520px\)[\s\S]*\.transcript-row\s+\.transcript-entry-body\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/s);
  assert.match(css, /\.transcript-content\.is-translation-disabled\s+\.transcript-entry-body,/);
  assert.match(css, /\.transcript-content\.is-translation-hidden\s+\.transcript-entry-body\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/s);
  assert.match(css, /\.transcript-entry-text\s*\{[^}]*max-width:\s*78ch;/s);
  assert.match(css, /\.transcript-cell-translation\s*\{[^}]*max-width:\s*78ch;/s);
  assert.match(css, /\.transcript-cell-translation\s*\{[^}]*background:\s*var\(\s*--transcript-translation-bg,/s);
  assert.match(css, /@container transcript-panel \(max-width: 520px\)[\s\S]*\.transcript-content\.is-deepgram-source\s+\.transcript-row\s+\.transcript-cell-translation\s*\{[^}]*border-top:/s);
  assert.doesNotMatch(css, /@container transcript-panel \(max-width: 520px\)[\s\S]*\.transcript-content\.is-live-captions-source\s+\.transcript-row\s+\.transcript-cell-translation\s*\{[^}]*border-top:/s);
  assert.match(html, /src="src\/transcriptDisplayGroups\.js"/);
  assert.match(renderer, /createTranscriptDisplayGroups/);
  assert.match(renderer, /const displayEntries = createTranscriptDisplayGroups\(entries\)/);
  assert.match(renderer, /transcriptEl\.classList\.toggle\('is-deepgram-source', isDeepgramSource\)/);
  assert.match(renderer, /transcriptEl\.classList\.toggle\('is-live-captions-source', !isDeepgramSource\)/);

  const updateSourceCell = getFunctionSource(renderer, 'updateTranscriptSourceCell');
  const createTranscriptRow = getFunctionSource(renderer, 'createTranscriptRow');
  const updateRow = getFunctionSource(renderer, 'updateTranscriptRow');
  assert.match(updateSourceCell, /sourceCell\.dataset\.sourceSignature/);
  assert.match(updateSourceCell, /sourceCell\.replaceChildren\(sourceText\)/);
  assert.match(updateRow, /updateTranscriptMarker/);
  assert.match(updateRow, /updateTranscriptLiveStatus/);
  assert.match(updateRow, /updateTranscriptTranslationCell/);
  assert.doesNotMatch(updateRow, /entrySignature/);
  assert.match(createTranscriptRow, /transcript-entry-header/);
  assert.match(createTranscriptRow, /transcript-entry-body/);
  assert.match(createTranscriptRow, /transcript-live-status/);
  assert.match(createTranscriptRow, /row\.setAttribute\('role', 'article'\)/);
  assert.match(createTranscriptRow, /row\.append\(header,\s*body\)/);
  assert.match(updateRow, /updateTranscriptHeaderVisibility\(row\)/);
  assert.match(css, /\.transcript-entry-marker\[hidden\],\s*\.transcript-entry-header\[hidden\]\s*\{[^}]*display:\s*none;/s);
  assert.match(updateRow, /has-translation/);
  assert.match(css, /@container transcript-panel \(max-width: 360px\)[\s\S]*\.transcript-content:not\(\.is-translation-hidden\):not\(\.is-translation-disabled\)\s+\.transcript-row\.has-translation\s+\.transcript-cell-translation\s*\{[^}]*display:\s*none;/s);
  assert.match(css, /@container transcript-panel \(max-width: 360px\)[\s\S]*\.transcript-content:not\(\.is-translation-hidden\):not\(\.is-translation-disabled\)\s+\.transcript-row\.has-translation:hover\s+\.transcript-cell-source\s*\{[^}]*display:\s*none;/s);
  assert.match(css, /@container transcript-panel \(max-width: 360px\)[\s\S]*\.transcript-content:not\(\.is-translation-hidden\):not\(\.is-translation-disabled\)\s+\.transcript-row\.has-translation:hover\s+\.transcript-cell-translation\s*\{[^}]*display:\s*block;/s);
  assert.doesNotMatch(updateSourceCell, /createElement\('button'\)/);
  assert.doesNotMatch(updateSourceCell, /document\.createTextNode\(' '\)/);
  assert.doesNotMatch(createTranscriptRow, /addEventListener\('click'/);
});

test('transcript rendering keeps stable row order and shows a new transcript indicator', () => {
  const html = readRepoFile('index.html');
  const css = readRepoFile('styles.css');
  const renderer = readRepoFile('renderer.js');
  const renderTranscriptEntries = getFunctionSource(renderer, 'renderTranscriptEntries');

  assert.match(renderTranscriptEntries, /expectedNextRow/);
  assert.match(renderTranscriptEntries, /insertBefore\(row,\s*expectedNextRow\)/);
  assert.doesNotMatch(renderTranscriptEntries, /row !== transcriptRowsEl\.lastElementChild/);

  assert.match(html, /id="newTranscriptIndicator"/);
  assert.match(html, />\s*Jump to latest\s*<\/button>/);
  assert.match(html, /aria-label="Jump to latest transcript"/);
  assert.match(css, /\.new-transcript-indicator/);
  assert.match(renderer, /const newTranscriptIndicator = document\.getElementById\('newTranscriptIndicator'\)/);
  assert.match(renderer, /function setNewTranscriptIndicatorVisible/);
  assert.match(renderer, /setNewTranscriptIndicatorVisible\(true\)/);
});

test('partial transcript updates keep stable text color and diff cells independently', () => {
  const css = readRepoFile('styles.css');
  const renderer = readRepoFile('renderer.js');

  assert.doesNotMatch(css, /\.transcript-row\.is-partial\s+\.transcript-cell-source\s*\{[^}]*color:/s);
  assert.match(renderer, /function getTranscriptMarkerSignature/);
  assert.match(renderer, /function getTranscriptSourceSignature/);
  assert.match(renderer, /function getTranscriptTranslationSignature/);
  assert.match(renderer, /function getTranscriptLiveSignature/);
  assert.match(renderer, /function updateTranscriptLiveStatus/);
  assert.match(css, /\.transcript-live-status\s*\{/);
  assert.match(renderer, /marker\.dataset\.markerSignature/);
  assert.match(renderer, /sourceCell\.dataset\.sourceSignature/);
  assert.match(renderer, /translatedCell\.dataset\.translationSignature/);
});

test('panel divider has a visible default grip affordance', () => {
  const css = readRepoFile('styles.css');

  assert.match(css, /\.panel-divider::after\s*\{/);
  assert.match(css, /\.panel-divider:hover::after,/);
  assert.match(css, /\.panel-divider::after\s*\{[^}]*height:\s*24px;/s);
  assert.doesNotMatch(css, /data-layout-mode/);
});
