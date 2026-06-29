const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function getMainSource() {
  return fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
}

function getFunctionSource(name) {
  const mainSource = getMainSource();
  const startMarker = `async function ${name}(`;
  const startIndex = mainSource.indexOf(startMarker);
  assert.notEqual(startIndex, -1, `Expected to find ${name} in main.js`);

  const nextFunctionIndex = mainSource.indexOf('\nasync function ', startIndex + startMarker.length);
  assert.notEqual(nextFunctionIndex, -1, `Expected to find the end of ${name} in main.js`);
  return mainSource.slice(startIndex, nextFunctionIndex);
}

test('assistant injected composer helpers are shared instead of copy-pasted per script', () => {
  const mainSource = getMainSource();
  const composerInjectedFunctions = [
    'clearCurrentComposer',
    'getCurrentComposerText',
    'pasteTextIntoComposer',
    'focusAssistantComposerForUpload',
    'markImageUploadInput',
    'getAssistantImageAttachmentState',
    'submitComposerViaForm',
    'clickComposerSendButton',
    'waitForSendButtonReady',
    'submitComposerViaDom'
  ];
  const sendButtonInjectedFunctions = [
    'submitComposerViaForm',
    'clickComposerSendButton',
    'waitForSendButtonReady',
    'submitComposerViaDom'
  ];

  assert.match(mainSource, /const COMPOSER_HELPERS_SCRIPT = `/);
  assert.match(mainSource, /const SEND_BUTTON_HELPERS_SCRIPT = `/);
  assert.equal((mainSource.match(/function isVisibleElement\(element\)/g) || []).length, 1);
  assert.equal((mainSource.match(/function isUsableComposer\(element\)/g) || []).length, 1);
  assert.equal((mainSource.match(/function elementMatchesComposer\(element\)/g) || []).length, 1);
  assert.equal((mainSource.match(/function findComposer\(\)/g) || []).length, 1);
  assert.equal((mainSource.match(/function isButtonReady\(button\)/g) || []).length, 1);
  assert.equal((mainSource.match(/function findSendButton\(composer\)/g) || []).length, 1);

  for (const functionName of composerInjectedFunctions) {
    assert.match(
      getFunctionSource(functionName),
      /\$\{COMPOSER_HELPERS_SCRIPT\}/,
      `${functionName} should compose the shared helper script`
    );
  }

  for (const functionName of sendButtonInjectedFunctions) {
    assert.match(
      getFunctionSource(functionName),
      /\$\{SEND_BUTTON_HELPERS_SCRIPT\}/,
      `${functionName} should compose the shared send button helper script`
    );
  }
});

test('DOM submit fallback clicks a ready assistant send button outside forms', () => {
  const source = getFunctionSource('submitComposerViaDom');

  assert.match(source, /\$\{SEND_BUTTON_HELPERS_SCRIPT\}/);
  assert.match(source, /function clickReadySendButton/);
  assert.match(source, /findSendButton\(element\)/);
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

test('current composer submit tries form submission before mouse fallback for ChatGPT', () => {
  const source = getFunctionSource('submitCurrentComposer');
  const formSubmitIndex = source.indexOf('submitComposerViaForm(webContents)');
  const clickIndex = source.indexOf('clickComposerSendButton(webContents)');
  const formSource = getFunctionSource('submitComposerViaForm');

  assert.match(source, /getAssistantTargetKind\(webContents\.getURL\(\)\)/);
  assert.match(source, /targetKind === 'chatgpt'/);
  assert.notEqual(formSubmitIndex, -1);
  assert.notEqual(clickIndex, -1);
  assert.ok(formSubmitIndex < clickIndex);
  assert.match(formSource, /form\.requestSubmit/);
  assert.match(formSource, /\$\{COMPOSER_HELPERS_SCRIPT\}/);
});

test('DeepSeek submit uses mouse click before form fallback to avoid no-op form delay', () => {
  const source = getFunctionSource('submitCurrentComposer');
  const clickIndex = source.indexOf('clickComposerSendButton(webContents)');
  const nonChatGptBranchIndex = source.indexOf("targetKind !== 'chatgpt'");
  const fallbackFormIndex = source.indexOf('submitComposerViaForm(webContents)', nonChatGptBranchIndex);

  assert.notEqual(clickIndex, -1);
  assert.notEqual(nonChatGptBranchIndex, -1);
  assert.notEqual(fallbackFormIndex, -1);
  assert.ok(clickIndex < fallbackFormIndex);
});

test('assistant composer discovery prefers selector matches before focused generic editables', () => {
  const mainSource = getMainSource();
  const startIndex = mainSource.indexOf('const COMPOSER_HELPERS_SCRIPT = `');
  const endIndex = mainSource.indexOf('`;', startIndex + 1);
  const helperSource = mainSource.slice(startIndex, endIndex);
  const selectorScanIndex = helperSource.indexOf('for (const selector of composerSelectors)');
  const activeElementIndex = helperSource.indexOf('document.activeElement');

  assert.notEqual(selectorScanIndex, -1);
  assert.notEqual(activeElementIndex, -1);
  assert.ok(selectorScanIndex < activeElementIndex);
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

test('DOM submit fallback does not focus the assistant send button', () => {
  const source = getFunctionSource('submitComposerViaDom');

  assert.doesNotMatch(source, /button\.focus/);
});
