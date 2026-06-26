const test = require('node:test');
const assert = require('node:assert/strict');

const {
  DEFAULT_ASSISTANT_URLS,
  ASSISTANT_COMPOSER_SELECTORS,
  ASSISTANT_REVEAL_UPLOAD_BUTTON_SELECTORS,
  isSupportedAssistantUrl
} = require('../src/assistantTargets');

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
  assert.ok(ASSISTANT_REVEAL_UPLOAD_BUTTON_SELECTORS.includes('button[aria-label*="Attach files"]'));
});
