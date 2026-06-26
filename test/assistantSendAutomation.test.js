const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function getFunctionSource(name) {
  const mainSource = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  const startMarker = `async function ${name}(`;
  const startIndex = mainSource.indexOf(startMarker);
  assert.notEqual(startIndex, -1, `Expected to find ${name} in main.js`);

  const nextFunctionIndex = mainSource.indexOf('\nasync function ', startIndex + startMarker.length);
  assert.notEqual(nextFunctionIndex, -1, `Expected to find the end of ${name} in main.js`);
  return mainSource.slice(startIndex, nextFunctionIndex);
}

test('DOM submit fallback clicks a ready assistant send button outside forms', () => {
  const source = getFunctionSource('submitComposerViaDom');

  assert.match(source, /function findSendButton/);
  assert.match(source, /addButtonsFromRoot\(composer\?\.parentElement\)/);
  assert.match(source, /addButtonsFromRoot\(document\)/);
  assert.match(source, /function clickReadySendButton/);
  assert.match(source, /button\.click\(\)/);
});

test('current composer submit waits for the send button before clicking it', () => {
  const source = getFunctionSource('submitCurrentComposer');
  const waitIndex = source.indexOf('await waitForSendButtonReady(webContents');
  const clickIndex = source.indexOf('clickComposerSendButton(webContents)');

  assert.notEqual(waitIndex, -1);
  assert.notEqual(clickIndex, -1);
  assert.ok(waitIndex < clickIndex);
});

test('primary send click uses Electron input events at the visible button center', () => {
  const source = getFunctionSource('clickComposerSendButton');

  assert.match(source, /getBoundingClientRect\(\)/);
  assert.match(source, /sendInputEvent\(\{\s*type: 'mouseDown'/);
  assert.match(source, /sendInputEvent\(\{\s*type: 'mouseUp'/);
});
