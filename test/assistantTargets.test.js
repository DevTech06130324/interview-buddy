const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  DEFAULT_ASSISTANT_URLS,
  ASSISTANT_COMPOSER_SELECTORS,
  ASSISTANT_SEND_BUTTON_SELECTORS,
  ASSISTANT_REVEAL_UPLOAD_BUTTON_SELECTORS,
  isSupportedAssistantUrl
} = require('../src/assistantTargets');

function readRepoFile(fileName) {
  return fs.readFileSync(path.join(__dirname, '..', fileName), 'utf8');
}

test('Claude is a supported assistant target', () => {
  assert.equal(isSupportedAssistantUrl('https://claude.ai/'), true);
  assert.equal(isSupportedAssistantUrl('https://claude.ai/new'), true);
  assert.equal(isSupportedAssistantUrl('https://www.claude.ai/'), true);
});

test('Claude opens as one of the default assistant tabs', () => {
  assert.ok(DEFAULT_ASSISTANT_URLS.includes('https://claude.ai/'));
});

test('assistant DOM selectors include Claude composer and attachment controls', () => {
  assert.ok(ASSISTANT_COMPOSER_SELECTORS.includes('[contenteditable="true"][aria-label*="Claude"]'));
  assert.ok(ASSISTANT_COMPOSER_SELECTORS.includes('.ProseMirror[contenteditable="true"]'));
  assert.ok(ASSISTANT_SEND_BUTTON_SELECTORS.includes('button[aria-label*="Send message"]'));
  assert.ok(ASSISTANT_REVEAL_UPLOAD_BUTTON_SELECTORS.includes('button[aria-label*="Attach files"]'));
});

test('assistant composer selectors prefer current provider placeholders before generic editables', () => {
  const genericTextareaIndex = ASSISTANT_COMPOSER_SELECTORS.indexOf('textarea');
  const genericContentEditableIndex = ASSISTANT_COMPOSER_SELECTORS.indexOf('[contenteditable="true"]');
  const placeholderSelectors = [
    'textarea[placeholder*="Ask anything" i]',
    '[contenteditable="true"][data-placeholder*="Ask anything" i]',
    'textarea[placeholder*="Message DeepSeek" i]',
    '[contenteditable="true"][data-placeholder*="Message DeepSeek" i]',
    'textarea[placeholder*="Write a message" i]',
    '[contenteditable="true"][data-placeholder*="Write a message" i]'
  ];

  assert.notEqual(genericTextareaIndex, -1);
  assert.notEqual(genericContentEditableIndex, -1);

  for (const selector of placeholderSelectors) {
    const selectorIndex = ASSISTANT_COMPOSER_SELECTORS.indexOf(selector);

    assert.notEqual(selectorIndex, -1, `Expected composer selector: ${selector}`);
    assert.ok(selectorIndex < genericTextareaIndex, `${selector} should be checked before textarea`);
    assert.ok(
      selectorIndex < genericContentEditableIndex,
      `${selector} should be checked before generic contenteditable`
    );
  }
});

test('assistant send selectors include current ChatGPT composer submit controls', () => {
  const exactComposerSubmitIndex = ASSISTANT_SEND_BUTTON_SELECTORS.indexOf('button[data-testid="composer-submit-button"]');
  const genericSubmitIndex = ASSISTANT_SEND_BUTTON_SELECTORS.indexOf('button[type="submit"]');

  assert.notEqual(exactComposerSubmitIndex, -1);
  assert.ok(exactComposerSubmitIndex < genericSubmitIndex);
  assert.ok(ASSISTANT_SEND_BUTTON_SELECTORS.includes('button[aria-label*="Submit"]'));
  assert.ok(ASSISTANT_SEND_BUTTON_SELECTORS.includes('button[data-testid*="submit"]'));
});

test('Claude support copy is current in errors and documentation', () => {
  const main = readRepoFile('main.js');
  const readme = readRepoFile('README.md');

  assert.match(main, /ChatGPT, DeepSeek, or Claude/);
  assert.doesNotMatch(main, /ChatGPT or DeepSeek\. Current URL/);

  assert.match(readme, /ChatGPT, DeepSeek, and Claude/);
  assert.match(readme, /Conversations so far like this/);
  assert.doesNotMatch(readme, /Transcript-to-assistant automation for ChatGPT and DeepSeek/);
  assert.doesNotMatch(readme, /Interviewer said like this/);
});
