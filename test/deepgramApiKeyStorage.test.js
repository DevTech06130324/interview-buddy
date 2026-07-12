const test = require('node:test');
const assert = require('node:assert/strict');

const {
  decodeDeepgramApiKeyStorage,
  encodeDeepgramApiKeyForStorage
} = require('../src/deepgramApiKeyStorage');

function createSafeStorage({ available = true } = {}) {
  return {
    isEncryptionAvailable: () => available,
    encryptString: (value) => Buffer.from(`encrypted:${value}`, 'utf8'),
    decryptString: (value) => String(value).replace(/^encrypted:/, '')
  };
}

test('new API keys remain memory-only when secure storage is unavailable', () => {
  const storage = encodeDeepgramApiKeyForStorage(
    ' dg_memory_only ',
    createSafeStorage({ available: false })
  );

  assert.equal(storage, null);
});

test('legacy plaintext is loaded into memory but removed from the persistence projection immediately', () => {
  const result = decodeDeepgramApiKeyStorage({
    encrypted: false,
    value: 'dg_legacy_plaintext'
  }, createSafeStorage({ available: false }));

  assert.equal(result.apiKey, 'dg_legacy_plaintext');
  assert.equal(result.storage, null);
  assert.equal(result.needsRewrite, true);
});

test('legacy plaintext is re-encrypted when secure storage is available', () => {
  const safeStorage = createSafeStorage();
  const result = decodeDeepgramApiKeyStorage({
    encrypted: false,
    value: 'dg_legacy_encrypt_me'
  }, safeStorage);

  assert.equal(result.apiKey, 'dg_legacy_encrypt_me');
  assert.equal(result.storage.encrypted, true);
  assert.notEqual(result.storage.value, 'dg_legacy_encrypt_me');
  assert.equal(
    safeStorage.decryptString(Buffer.from(result.storage.value, 'base64')),
    'dg_legacy_encrypt_me'
  );
  assert.equal(result.needsRewrite, true);
});

test('existing encrypted storage decrypts without requiring a rewrite', () => {
  const safeStorage = createSafeStorage();
  const stored = encodeDeepgramApiKeyForStorage('dg_encrypted', safeStorage);
  const result = decodeDeepgramApiKeyStorage(stored, safeStorage);

  assert.equal(result.apiKey, 'dg_encrypted');
  assert.deepEqual(result.storage, stored);
  assert.equal(result.needsRewrite, false);
});

test('an encrypted blob is preserved when secure storage is temporarily unavailable', () => {
  const stored = {
    encrypted: true,
    value: Buffer.from('encrypted:dg_wait_for_storage').toString('base64')
  };
  const result = decodeDeepgramApiKeyStorage(
    stored,
    createSafeStorage({ available: false })
  );

  assert.equal(result.apiKey, '');
  assert.deepEqual(result.storage, stored);
  assert.equal(result.needsRewrite, false);
});
