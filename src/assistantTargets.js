const DEFAULT_ASSISTANT_URLS = [
  'https://chatgpt.com/',
  'https://chat.deepseek.com/',
  'https://claude.ai/'
];

const SUPPORTED_ASSISTANT_HOSTS = new Set([
  'chatgpt.com',
  'chat.openai.com',
  'chat.deepseek.com',
  'deepseek.com',
  'www.deepseek.com',
  'claude.ai',
  'www.claude.ai'
]);

const ASSISTANT_COMPOSER_SELECTORS = [
  '#prompt-textarea',
  'textarea[placeholder*="Ask anything" i]',
  'input[placeholder*="Ask anything" i]',
  '[contenteditable="true"][aria-label*="Ask anything" i]',
  '[contenteditable="true"][data-placeholder*="Ask anything" i]',
  '[contenteditable="true"][placeholder*="Ask anything" i]',
  'textarea[placeholder*="Message DeepSeek" i]',
  'input[placeholder*="Message DeepSeek" i]',
  '[contenteditable="true"][aria-label*="Message DeepSeek" i]',
  '[contenteditable="true"][data-placeholder*="Message DeepSeek" i]',
  '[contenteditable="true"][placeholder*="Message DeepSeek" i]',
  'textarea[placeholder*="Write a message" i]',
  'input[placeholder*="Write a message" i]',
  '[contenteditable="true"][aria-label*="Write a message" i]',
  '[contenteditable="true"][data-placeholder*="Write a message" i]',
  '[contenteditable="true"][placeholder*="Write a message" i]',
  '[contenteditable="true"][aria-label*="Claude"]',
  '[contenteditable="true"][aria-label*="Message Claude"]',
  '[contenteditable="true"][aria-label*="Talk to Claude"]',
  'textarea[data-testid="chat-input"]',
  '[data-testid="chat-input"] textarea',
  '[data-testid="chat-input"] [contenteditable="true"]',
  '.ProseMirror[contenteditable="true"]',
  'textarea[data-id="root"]',
  'textarea[placeholder*="Message" i]',
  'textarea',
  '[contenteditable="true"][data-lexical-editor="true"]',
  '[contenteditable="true"]'
];

const ASSISTANT_SEND_BUTTON_SELECTORS = [
  'button[data-testid="send-button"]',
  'button[data-testid="composer-submit-button"]',
  'button[aria-label="Send prompt"]',
  'button[aria-label="Send message"]',
  'button[aria-label="Send"]',
  'button[aria-label*="Send message"]',
  'button[aria-label*="Send Message"]',
  'button[aria-label*="send message"]',
  'button[aria-label*="Send"]',
  'button[aria-label*="Submit"]',
  'button[aria-label*="submit"]',
  'button[data-testid*="send"]',
  '[data-testid*="send"] button',
  'button[data-testid*="submit"]',
  '[data-testid*="submit"] button',
  'button[type="submit"]'
];

const ASSISTANT_FILE_INPUT_SELECTORS = [
  'input[type="file"][accept*="image"]',
  'input[type="file"][accept*="png"]',
  'input[type="file"]'
];

const ASSISTANT_REVEAL_UPLOAD_BUTTON_SELECTORS = [
  'button[aria-label*="Attach files"]',
  'button[aria-label*="Add content"]',
  'button[aria-label*="Upload file"]',
  'button[aria-label*="Attach"]',
  'button[aria-label*="attach"]',
  'button[aria-label*="Upload"]',
  'button[aria-label*="upload"]',
  'button[aria-label*="Photo"]',
  'button[aria-label*="photo"]',
  'button[aria-label*="Image"]',
  'button[aria-label*="image"]',
  '[data-testid*="attach"]',
  '[data-testid*="upload"]',
  '[data-testid*="file"]',
  '[data-testid*="plus"]'
];

function isSupportedAssistantUrl(url) {
  try {
    const { hostname } = new URL(url);
    return SUPPORTED_ASSISTANT_HOSTS.has(hostname);
  } catch (error) {
    return false;
  }
}

module.exports = {
  DEFAULT_ASSISTANT_URLS,
  SUPPORTED_ASSISTANT_HOSTS,
  ASSISTANT_COMPOSER_SELECTORS,
  ASSISTANT_SEND_BUTTON_SELECTORS,
  ASSISTANT_FILE_INPUT_SELECTORS,
  ASSISTANT_REVEAL_UPLOAD_BUTTON_SELECTORS,
  isSupportedAssistantUrl
};
