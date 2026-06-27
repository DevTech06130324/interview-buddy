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
