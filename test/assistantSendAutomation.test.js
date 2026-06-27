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

test('assistant composer discovery prefers selector matches before focused generic editables', () => {
  const functions = [
    'getCurrentComposerText',
    'focusAssistantComposerForUpload',
    'markImageUploadInput',
    'clickComposerSendButton',
    'submitComposerViaDom'
  ];

  for (const functionName of functions) {
    const source = getFunctionSource(functionName);
    const selectorScanIndex = source.indexOf('for (const selector of composerSelectors)');
    const activeElementIndex = source.indexOf('document.activeElement');

    assert.notEqual(selectorScanIndex, -1, `Expected ${functionName} to scan composer selectors`);
    assert.notEqual(activeElementIndex, -1, `Expected ${functionName} to keep an active-element fallback`);
    assert.ok(
      selectorScanIndex < activeElementIndex,
      `${functionName} should prefer provider composer selectors before activeElement`
    );
  }
});

test('primary send click uses debugger mouse events without focusing the app window', () => {
  const source = getFunctionSource('clickComposerSendButton');

  assert.match(source, /getBoundingClientRect\(\)/);
  assert.match(source, /dispatchMouseClickWithoutWindowFocus\(webContents, clickTarget\)/);
  assert.doesNotMatch(source, /webContents\.focus\(/);
  assert.doesNotMatch(source, /sendInputEvent/);
});

test('assistant page mouse clicks are dispatched without activating the window', () => {
  const source = getFunctionSource('dispatchMouseClickWithoutWindowFocus');

  assert.match(source, /Input\.dispatchMouseEvent/);
  assert.doesNotMatch(source, /webContents\.focus\(/);
  assert.doesNotMatch(source, /sendInputEvent/);
});
