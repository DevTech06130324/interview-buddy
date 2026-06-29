const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function readRepoFile(fileName) {
  return fs.readFileSync(path.join(__dirname, '..', fileName), 'utf8');
}

test('renderer windows reuse the protected tooltip helper instead of duplicating it', () => {
  const indexHtml = readRepoFile('index.html');
  const modeMenuHtml = readRepoFile('mode-menu.html');
  const renderer = readRepoFile('renderer.js');
  const modeMenu = readRepoFile('mode-menu.js');
  const protectedTooltips = readRepoFile('protected-tooltips.js');

  assert.match(indexHtml, /src="protected-tooltips\.js"[\s\S]*src="renderer\.js"/);
  assert.match(modeMenuHtml, /src="protected-tooltips\.js"[\s\S]*src="mode-menu\.js"/);
  assert.match(protectedTooltips, /setTooltip/);
  assert.match(renderer, /const setProtectedTooltip = window\.protectedTooltips\?\.setTooltip/);
  assert.match(modeMenu, /const setProtectedTooltip = window\.protectedTooltips\?\.setTooltip/);
  assert.equal((renderer.match(/function setProtectedTooltip/g) || []).length, 0);
  assert.equal((modeMenu.match(/function setProtectedTooltip/g) || []).length, 0);
});
