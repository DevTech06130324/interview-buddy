const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function readRepoFile(fileName) {
  return fs.readFileSync(path.join(__dirname, '..', fileName), 'utf8');
}

test('renderer and mode menu share prompt mode sorting', () => {
  const indexHtml = readRepoFile('index.html');
  const modeMenuHtml = readRepoFile('mode-menu.html');
  const renderer = readRepoFile('renderer.js');
  const modeMenu = readRepoFile('mode-menu.js');
  const helpers = readRepoFile('src/promptModeHelpers.js');

  assert.match(indexHtml, /src="src\/promptModeHelpers\.js"[\s\S]*src="renderer\.js"/);
  assert.match(modeMenuHtml, /src="src\/promptModeHelpers\.js"[\s\S]*src="mode-menu\.js"/);
  assert.match(renderer, /const \{\s*getSortedPromptModes\s*\} = window\.promptModeHelpers;/);
  assert.match(modeMenu, /const \{\s*getSortedPromptModes\s*\} = window\.promptModeHelpers;/);
  assert.equal((renderer.match(/function getSortedPromptModes/g) || []).length, 0);
  assert.equal((modeMenu.match(/function getSortedPromptModes/g) || []).length, 0);
  assert.match(helpers, /function getSortedPromptModes\(promptModes = \[\]\)/);
});

test('shared prompt mode sorting is case-insensitive and numeric', () => {
  const {
    getSortedPromptModes
  } = require('../src/promptModeHelpers');

  assert.deepEqual(
    getSortedPromptModes([
      { name: 'Mode 10' },
      { name: 'alpha' },
      { name: 'Mode 2' },
      { name: 'Beta' }
    ]).map((mode) => mode.name),
    ['alpha', 'Beta', 'Mode 2', 'Mode 10']
  );
});
