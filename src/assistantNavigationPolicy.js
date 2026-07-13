const { SUPPORTED_ASSISTANT_HOSTS } = require('./assistantTargets');

const ASSISTANT_NAVIGATION_ACTION = Object.freeze({
  POPUP: 'popup',
  SAME_TAB: 'same-tab',
  DENY: 'deny'
});

const DEFAULT_ASSISTANT_AUTH_HOSTS = new Set([
  'accounts.google.com',
  'auth.openai.com',
  'auth0.openai.com',
  'login.openai.com',
  'account.anthropic.com',
  'console.anthropic.com'
]);

const DEFAULT_ALLOWED_PROTOCOLS = new Set(['https:']);
const POPUP_DISPOSITIONS = new Set([
  'new-window',
  'foreground-tab',
  'background-tab',
  'new-popup'
]);

function toNormalizedHostSet(hosts) {
  const source = typeof hosts === 'string'
    ? [hosts]
    : hosts;
  const normalizedHosts = new Set();

  if (!source || typeof source[Symbol.iterator] !== 'function') {
    return normalizedHosts;
  }

  for (const host of source) {
    if (typeof host !== 'string') continue;
    const normalizedHost = host.trim().toLowerCase().replace(/\.$/, '');
    if (normalizedHost) {
      normalizedHosts.add(normalizedHost);
    }
  }

  return normalizedHosts;
}

function toNormalizedProtocolSet(protocols) {
  const source = typeof protocols === 'string'
    ? [protocols]
    : protocols;
  const normalizedProtocols = new Set();

  if (!source || typeof source[Symbol.iterator] !== 'function') {
    return normalizedProtocols;
  }

  for (const protocol of source) {
    if (typeof protocol !== 'string') continue;
    const normalizedProtocol = protocol.trim().toLowerCase();
    if (normalizedProtocol) {
      normalizedProtocols.add(normalizedProtocol.endsWith(':')
        ? normalizedProtocol
        : `${normalizedProtocol}:`);
    }
  }

  return normalizedProtocols;
}

function normalizeNavigationDetails(details) {
  if (typeof details === 'string') {
    return { url: details };
  }

  return details && typeof details === 'object' ? details : {};
}

function hasPostBody(details) {
  return Object.prototype.hasOwnProperty.call(details, 'postBody')
    && details.postBody !== undefined
    && details.postBody !== null;
}

function isPopupRequest(details) {
  if (
    details.isPopup === true
    || details.isWindowOpen === true
    || details.source === 'window-open'
    || details.type === 'window-open'
  ) {
    return true;
  }

  const disposition = typeof details.disposition === 'string'
    ? details.disposition.trim().toLowerCase()
    : '';
  if (POPUP_DISPOSITIONS.has(disposition)) {
    return true;
  }

  if (disposition && disposition !== 'current-tab') {
    return true;
  }

  const frameName = typeof details.frameName === 'string'
    ? details.frameName.trim().toLowerCase()
    : '';
  return Boolean(frameName && frameName !== '_self' && frameName !== '_parent' && frameName !== '_top');
}

function createAssistantNavigationPolicy({
  assistantHosts = SUPPORTED_ASSISTANT_HOSTS,
  authHosts = DEFAULT_ASSISTANT_AUTH_HOSTS,
  allowedProtocols = DEFAULT_ALLOWED_PROTOCOLS,
  parseUrl = (value) => new URL(value)
} = {}) {
  const allowedHosts = new Set([
    ...toNormalizedHostSet(assistantHosts),
    ...toNormalizedHostSet(authHosts)
  ]);
  const allowedProtocolSet = toNormalizedProtocolSet(allowedProtocols);

  return function decideAssistantNavigation(details) {
    const request = normalizeNavigationDetails(details);
    const requestedUrl = typeof request.url === 'string' ? request.url.trim() : '';
    if (!requestedUrl) {
      return ASSISTANT_NAVIGATION_ACTION.DENY;
    }

    let parsedUrl;
    try {
      parsedUrl = parseUrl(requestedUrl);
    } catch (_) {
      return ASSISTANT_NAVIGATION_ACTION.DENY;
    }

    const protocol = typeof parsedUrl?.protocol === 'string'
      ? parsedUrl.protocol.toLowerCase()
      : '';
    const hostname = typeof parsedUrl?.hostname === 'string'
      ? parsedUrl.hostname.toLowerCase().replace(/\.$/, '')
      : '';
    if (!allowedProtocolSet.has(protocol) || !allowedHosts.has(hostname)) {
      return ASSISTANT_NAVIGATION_ACTION.DENY;
    }

    if (hasPostBody(request) || isPopupRequest(request)) {
      return ASSISTANT_NAVIGATION_ACTION.POPUP;
    }

    return ASSISTANT_NAVIGATION_ACTION.SAME_TAB;
  };
}

module.exports = {
  ASSISTANT_NAVIGATION_ACTION,
  DEFAULT_ASSISTANT_AUTH_HOSTS,
  createAssistantNavigationPolicy
};
