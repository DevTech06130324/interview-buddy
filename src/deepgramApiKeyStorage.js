function normalizeDeepgramApiKey(apiKey) {
  return String(apiKey || '').trim();
}

function canEncryptDeepgramApiKey(safeStorage) {
  try {
    return Boolean(safeStorage && safeStorage.isEncryptionAvailable());
  } catch (_) {
    return false;
  }
}

function encodeDeepgramApiKeyForStorage(apiKey, safeStorage) {
  const normalizedApiKey = normalizeDeepgramApiKey(apiKey);
  if (!normalizedApiKey || !canEncryptDeepgramApiKey(safeStorage)) {
    return null;
  }

  try {
    return {
      encrypted: true,
      value: safeStorage.encryptString(normalizedApiKey).toString('base64')
    };
  } catch (_) {
    return null;
  }
}

function decodeDeepgramApiKeyStorage(storage, safeStorage) {
  if (!storage || typeof storage !== 'object' || typeof storage.value !== 'string') {
    return {
      apiKey: '',
      storage: null,
      needsRewrite: Boolean(storage)
    };
  }

  if (!storage.encrypted) {
    const apiKey = normalizeDeepgramApiKey(storage.value);
    return {
      apiKey,
      storage: encodeDeepgramApiKeyForStorage(apiKey, safeStorage),
      needsRewrite: true
    };
  }

  if (!canEncryptDeepgramApiKey(safeStorage)) {
    return {
      apiKey: '',
      storage,
      needsRewrite: false
    };
  }

  try {
    return {
      apiKey: normalizeDeepgramApiKey(
        safeStorage.decryptString(Buffer.from(storage.value, 'base64'))
      ),
      storage,
      needsRewrite: false
    };
  } catch (_) {
    return {
      apiKey: '',
      storage,
      needsRewrite: false
    };
  }
}

module.exports = {
  canEncryptDeepgramApiKey,
  decodeDeepgramApiKeyStorage,
  encodeDeepgramApiKeyForStorage
};
