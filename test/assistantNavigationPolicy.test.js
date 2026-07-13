const test = require('node:test');
const assert = require('node:assert/strict');

const {
  ASSISTANT_NAVIGATION_ACTION,
  DEFAULT_ASSISTANT_AUTH_HOSTS,
  createAssistantNavigationPolicy
} = require('../src/assistantNavigationPolicy');

test('trusted assistant navigations stay in the current tab by default', () => {
  const decide = createAssistantNavigationPolicy();

  assert.equal(decide({ url: 'https://chatgpt.com/' }), ASSISTANT_NAVIGATION_ACTION.SAME_TAB);
  assert.equal(decide({ url: 'https://chat.deepseek.com/chat' }), ASSISTANT_NAVIGATION_ACTION.SAME_TAB);
  assert.equal(decide({ url: 'https://claude.ai/new' }), ASSISTANT_NAVIGATION_ACTION.SAME_TAB);
});

test('trusted assistant and OAuth window-open requests are allowed as real popups', () => {
  const decide = createAssistantNavigationPolicy();

  assert.equal(
    decide({ url: 'https://claude.ai/login', source: 'window-open' }),
    ASSISTANT_NAVIGATION_ACTION.POPUP
  );
  assert.equal(
    decide({ url: 'https://accounts.google.com/o/oauth2/auth', disposition: 'new-window' }),
    ASSISTANT_NAVIGATION_ACTION.POPUP
  );
  assert.equal(
    decide({ url: 'https://auth.openai.com/authorize', disposition: 'other' }),
    ASSISTANT_NAVIGATION_ACTION.POPUP
  );
  assert.ok(DEFAULT_ASSISTANT_AUTH_HOSTS.has('accounts.google.com'));
});

test('a request with a POST body is never flattened into same-tab navigation', () => {
  const decide = createAssistantNavigationPolicy();

  assert.equal(
    decide({
      url: 'https://accounts.google.com/o/oauth2/auth',
      disposition: 'current-tab',
      postBody: [{ type: 'rawData', bytes: Buffer.from('state=abc') }]
    }),
    ASSISTANT_NAVIGATION_ACTION.POPUP
  );
  assert.equal(
    decide({
      url: 'https://chatgpt.com/',
      postBody: ''
    }),
    ASSISTANT_NAVIGATION_ACTION.POPUP
  );
});

test('unsupported protocols, hosts, and malformed URLs are denied', () => {
  const decide = createAssistantNavigationPolicy();

  for (const details of [
    { url: 'http://chatgpt.com/' },
    { url: 'file:///C:/Windows/System32/cmd.exe' },
    { url: 'javascript:alert(1)' },
    { url: 'https://accounts.google.evil.example/' },
    { url: 'https://example.com/' },
    { url: 'not a url' },
    {}
  ]) {
    assert.equal(decide(details), ASSISTANT_NAVIGATION_ACTION.DENY);
  }
});

test('the policy is injectable without Electron details or globals', () => {
  const parsedUrls = [];
  const decide = createAssistantNavigationPolicy({
    assistantHosts: ['assistant.test'],
    authHosts: ['login.assistant.test'],
    parseUrl(value) {
      parsedUrls.push(value);
      return new URL(value);
    }
  });

  assert.equal(decide('https://assistant.test/chat'), ASSISTANT_NAVIGATION_ACTION.SAME_TAB);
  assert.equal(
    decide({ url: 'https://login.assistant.test/oauth', isPopup: true }),
    ASSISTANT_NAVIGATION_ACTION.POPUP
  );
  assert.deepEqual(parsedUrls, [
    'https://assistant.test/chat',
    'https://login.assistant.test/oauth'
  ]);
});

test('every policy decision uses one of the three public actions', () => {
  const decide = createAssistantNavigationPolicy();
  const actions = new Set(Object.values(ASSISTANT_NAVIGATION_ACTION));

  for (const details of [
    { url: 'https://chatgpt.com/' },
    { url: 'https://chatgpt.com/', source: 'window-open' },
    { url: 'https://example.com/' }
  ]) {
    assert.ok(actions.has(decide(details)));
  }
});
