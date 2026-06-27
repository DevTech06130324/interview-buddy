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

function getComposerHelpersSource() {
  const mainSource = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  const startMarker = 'const COMPOSER_HELPERS_SCRIPT = `';
  const startIndex = mainSource.indexOf(startMarker);
  assert.notEqual(startIndex, -1, 'Expected to find shared composer helpers in main.js');

  const endIndex = mainSource.indexOf('`;', startIndex + startMarker.length);
  assert.notEqual(endIndex, -1, 'Expected to find the end of shared composer helpers');
  return mainSource.slice(startIndex, endIndex);
}

test('screenshot upload marker search does not require the assistant input to be focused', () => {
  const source = getFunctionSource('markImageUploadInput');
  const helperSource = getComposerHelpersSource();

  assert.match(source, /\$\{COMPOSER_HELPERS_SCRIPT\}/);
  assert.match(helperSource, /document\.activeElement/);
  assert.match(helperSource, /function isUsableComposer/);
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
