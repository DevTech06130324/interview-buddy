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

test('screenshot upload marker search does not require the assistant input to be focused', () => {
  const source = getFunctionSource('markImageUploadInput');

  assert.match(source, /document\.activeElement/);
  assert.match(source, /function isUsableComposer/);
  assert.doesNotMatch(source, /if \(!composer\) \{\s*return false;\s*\}/);
});

test('screenshot upload gives Claude a real composer focus before attaching files', () => {
  const pasteSource = getFunctionSource('pasteImageIntoComposer');
  const focusIndex = pasteSource.indexOf('await focusAssistantComposerForUpload(webContents)');
  const markerIndex = pasteSource.indexOf('markImageUploadInput(webContents, uploadMarkerId)');

  assert.notEqual(focusIndex, -1);
  assert.notEqual(markerIndex, -1);
  assert.ok(focusIndex < markerIndex);

  const focusSource = getFunctionSource('focusAssistantComposerForUpload');
  assert.match(focusSource, /dispatchMouseClickWithoutWindowFocus\(webContents, clickTarget\)/);
  assert.doesNotMatch(focusSource, /webContents\.focus\(/);
  assert.doesNotMatch(focusSource, /sendInputEvent/);
});
