const closeHotkeyDialogBtn = document.getElementById('closeHotkeyDialogBtn');
const hotkeyList = document.getElementById('hotkeyList');
const translationEnabledToggle = document.getElementById('translationEnabledToggle');
const transcriptSourceSelect = document.getElementById('transcriptSourceSelect');
const deepgramApiKeyInput = document.getElementById('deepgramApiKeyInput');
const saveDeepgramApiKeyBtn = document.getElementById('saveDeepgramApiKeyBtn');
const clearDeepgramApiKeyBtn = document.getElementById('clearDeepgramApiKeyBtn');
const {
  formatHotkeyForDisplay,
  getHotkeyCaptureFromEvent
} = window.hotkeyHelpers;

const TRANSCRIPT_SOURCE_LIVE_CAPTIONS = 'live-captions';
const TRANSCRIPT_SOURCE_DEEPGRAM = 'deepgram';
const DEEPGRAM_KEY_MASK_PREFIX = '********';

let globalHotkeys = [];
let translationEnabled = false;
let transcriptSource = TRANSCRIPT_SOURCE_LIVE_CAPTIONS;
let hasDeepgramApiKey = false;
let deepgramApiKeyLast4 = '';
const globalHotkeyFeedbackTimers = new Map();
const HOTKEY_FEEDBACK_RESET_DELAY_MS = 1400;

function normalizeTranscriptSource(source) {
  return source === TRANSCRIPT_SOURCE_DEEPGRAM
    ? TRANSCRIPT_SOURCE_DEEPGRAM
    : TRANSCRIPT_SOURCE_LIVE_CAPTIONS;
}

function maskDeepgramApiKey(last4) {
  const suffix = String(last4 || '').trim();
  return suffix ? `${DEEPGRAM_KEY_MASK_PREFIX}${suffix}` : '';
}

function getCurrentDeepgramMask() {
  return hasDeepgramApiKey ? maskDeepgramApiKey(deepgramApiKeyLast4) : '';
}

function isShowingStoredDeepgramMask() {
  return Boolean(
    deepgramApiKeyInput
    && hasDeepgramApiKey
    && deepgramApiKeyInput.value === getCurrentDeepgramMask()
  );
}

function updateTranslationEnabledToggle(isEnabled) {
  translationEnabled = isEnabled !== false;

  if (translationEnabledToggle) {
    translationEnabledToggle.checked = translationEnabled;
    translationEnabledToggle.disabled = false;
  }
}

function updateTranscriptSourceSelect(source) {
  transcriptSource = normalizeTranscriptSource(source);

  if (transcriptSourceSelect) {
    transcriptSourceSelect.value = transcriptSource;
  }
}

function updateDeepgramKeyControls(preferences = {}) {
  hasDeepgramApiKey = Boolean(preferences.hasDeepgramApiKey);
  deepgramApiKeyLast4 = typeof preferences.deepgramApiKeyLast4 === 'string'
    ? preferences.deepgramApiKeyLast4
    : '';

  if (deepgramApiKeyInput && document.activeElement !== deepgramApiKeyInput) {
    deepgramApiKeyInput.type = hasDeepgramApiKey ? 'text' : 'password';
    deepgramApiKeyInput.value = getCurrentDeepgramMask();
    deepgramApiKeyInput.placeholder = hasDeepgramApiKey
      ? 'Saved key'
      : 'Enter Deepgram API key';
  }

  if (clearDeepgramApiKeyBtn) {
    clearDeepgramApiKeyBtn.disabled = !hasDeepgramApiKey;
  }
}

function applyAppPreferences(preferences = {}) {
  if (typeof preferences?.translationEnabled === 'boolean') {
    updateTranslationEnabledToggle(preferences.translationEnabled);
  } else {
    updateTranslationEnabledToggle(false);
  }

  updateTranscriptSourceSelect(preferences?.transcriptSource);
  updateDeepgramKeyControls(preferences);
}

function clearGlobalHotkeyFeedbackTimer(id) {
  const timer = globalHotkeyFeedbackTimers.get(id);
  if (timer !== undefined) {
    window.clearTimeout(timer);
    globalHotkeyFeedbackTimers.delete(id);
  }
}

function getGlobalHotkeyInput(id) {
  if (!hotkeyList) {
    return null;
  }

  return hotkeyList.querySelector(`[data-hotkey-id="${id}"]`);
}

function setGlobalHotkeyStatus(id, status) {
  const input = getGlobalHotkeyInput(id);
  if (!input) {
    return;
  }

  input.classList.toggle('is-success', status === 'success');
  input.classList.toggle('is-error', status === 'error');
}

function showGlobalHotkeyStatus(id, status) {
  clearGlobalHotkeyFeedbackTimer(id);
  setGlobalHotkeyStatus(id, status);

  if (status === 'idle') {
    return;
  }

  const timer = window.setTimeout(() => {
    globalHotkeyFeedbackTimers.delete(id);
    setGlobalHotkeyStatus(id, 'idle');
  }, HOTKEY_FEEDBACK_RESET_DELAY_MS);
  globalHotkeyFeedbackTimers.set(id, timer);
}

function updateGlobalHotkeyState(state) {
  globalHotkeys = Array.isArray(state?.hotkeys)
    ? state.hotkeys.map((entry) => ({
      id: typeof entry.id === 'string' ? entry.id : '',
      label: typeof entry.label === 'string' ? entry.label : 'Hotkey',
      description: typeof entry.description === 'string' ? entry.description : '',
      accelerator: typeof entry.accelerator === 'string' ? entry.accelerator : '',
      defaultAccelerator: typeof entry.defaultAccelerator === 'string' ? entry.defaultAccelerator : ''
    })).filter((entry) => entry.id)
    : [];

  renderGlobalHotkeySettings();
}

async function refreshGlobalHotkeySettings() {
  if (!hotkeyList) {
    return;
  }

  hotkeyList.textContent = 'Loading...';

  try {
    const state = await window.electronAPI.getGlobalHotkeys();
    updateGlobalHotkeyState(state);
  } catch (error) {
    console.error('[ERROR] Failed to load global hotkeys:', error);
    hotkeyList.textContent = 'Failed to load hotkeys.';
  }
}

function renderGlobalHotkeySettings() {
  if (!hotkeyList) {
    return;
  }

  hotkeyList.textContent = '';

  for (const entry of globalHotkeys) {
    const row = document.createElement('div');
    row.className = 'hotkey-row';

    const meta = document.createElement('div');
    meta.className = 'hotkey-meta';

    const name = document.createElement('div');
    name.className = 'hotkey-name';
    name.textContent = entry.label;

    const description = document.createElement('div');
    description.className = 'hotkey-description';
    description.textContent = entry.description;

    const input = document.createElement('input');
    input.className = 'hotkey-input';
    input.type = 'text';
    input.readOnly = true;
    input.spellcheck = false;
    input.autocomplete = 'off';
    input.placeholder = 'Disabled';
    input.value = formatHotkeyForDisplay(entry.accelerator);
    input.dataset.hotkeyId = entry.id;
    input.setAttribute('aria-label', `${entry.label} hotkey`);
    input.addEventListener('keydown', handleGlobalHotkeyInputKeydown);

    meta.appendChild(name);
    meta.appendChild(description);
    row.appendChild(meta);
    row.appendChild(input);
    hotkeyList.appendChild(row);
  }
}

async function applyGlobalHotkey(id, accelerator) {
  showGlobalHotkeyStatus(id, 'idle');

  try {
    const result = await window.electronAPI.setGlobalHotkey({
      id,
      accelerator
    });

    if (result?.globalHotkeyState) {
      updateGlobalHotkeyState(result.globalHotkeyState);
    }

    if (result?.success) {
      showGlobalHotkeyStatus(id, 'success');
      return;
    }
  } catch (error) {
    console.error('[ERROR] Failed to update global hotkey:', error);
  }

  showGlobalHotkeyStatus(id, 'error');
}

function handleGlobalHotkeyInputKeydown(event) {
  const input = event.currentTarget;
  const id = input?.dataset?.hotkeyId;
  if (!id) {
    return;
  }

  const noModifiers = !event.ctrlKey && !event.altKey && !event.shiftKey && !event.metaKey;
  if (event.key === 'Tab' && noModifiers) {
    return;
  }

  event.preventDefault();
  event.stopPropagation();

  if (event.key === 'Escape' && noModifiers) {
    input.blur();
    return;
  }

  if ((event.key === 'Backspace' || event.key === 'Delete') && noModifiers) {
    void applyGlobalHotkey(id, '');
    input.blur();
    return;
  }

  const hotkeyCapture = getHotkeyCaptureFromEvent(event);
  if (!hotkeyCapture || !hotkeyCapture.isValid) {
    showGlobalHotkeyStatus(id, 'error');
    input.blur();
    return;
  }

  void applyGlobalHotkey(id, hotkeyCapture.accelerator);
  input.blur();
}

if (closeHotkeyDialogBtn) {
  closeHotkeyDialogBtn.onclick = () => {
    window.close();
  };
}

async function applyTranslationEnabled(isEnabled) {
  const previousEnabled = translationEnabled;
  updateTranslationEnabledToggle(isEnabled);

  try {
    const preferences = await window.electronAPI.setTranslationEnabled(Boolean(isEnabled));
    applyAppPreferences(preferences);
  } catch (error) {
    updateTranslationEnabledToggle(previousEnabled);
    console.error('[ERROR] Failed to update translation setting:', error);
  }
}

async function setTranscriptSource(source) {
  const previousSource = transcriptSource;
  updateTranscriptSourceSelect(source);

  try {
    const preferences = await window.electronAPI.setTranscriptSource(transcriptSource);
    applyAppPreferences(preferences);
  } catch (error) {
    updateTranscriptSourceSelect(previousSource);
    console.error('[ERROR] Failed to update transcript source:', error);
  }
}

async function setDeepgramApiKey(apiKey) {
  const normalizedApiKey = String(apiKey || '').trim();
  if (!normalizedApiKey || normalizedApiKey === getCurrentDeepgramMask()) {
    updateDeepgramKeyControls({
      hasDeepgramApiKey,
      deepgramApiKeyLast4
    });
    return;
  }

  if (saveDeepgramApiKeyBtn) {
    saveDeepgramApiKeyBtn.disabled = true;
  }

  try {
    const preferences = await window.electronAPI.setDeepgramApiKey(normalizedApiKey);
    applyAppPreferences(preferences);
  } catch (error) {
    console.error('[ERROR] Failed to save Deepgram API key:', error);
  } finally {
    if (saveDeepgramApiKeyBtn) {
      saveDeepgramApiKeyBtn.disabled = false;
    }
  }
}

async function clearDeepgramApiKey() {
  if (clearDeepgramApiKeyBtn) {
    clearDeepgramApiKeyBtn.disabled = true;
  }

  try {
    const preferences = await window.electronAPI.clearDeepgramApiKey();
    applyAppPreferences(preferences);
  } catch (error) {
    console.error('[ERROR] Failed to clear Deepgram API key:', error);
    updateDeepgramKeyControls({
      hasDeepgramApiKey,
      deepgramApiKeyLast4
    });
  }
}

if (translationEnabledToggle) {
  translationEnabledToggle.addEventListener('change', (event) => {
    void applyTranslationEnabled(event.currentTarget.checked);
  });
}

if (transcriptSourceSelect) {
  transcriptSourceSelect.addEventListener('change', (event) => {
    void setTranscriptSource(event.currentTarget.value);
  });
}

if (deepgramApiKeyInput) {
  deepgramApiKeyInput.addEventListener('focus', () => {
    if (!isShowingStoredDeepgramMask()) {
      return;
    }

    deepgramApiKeyInput.type = 'password';
    deepgramApiKeyInput.value = '';
    deepgramApiKeyInput.placeholder = 'Enter new Deepgram API key';
  });

  deepgramApiKeyInput.addEventListener('blur', () => {
    if (!deepgramApiKeyInput.value.trim()) {
      updateDeepgramKeyControls({
        hasDeepgramApiKey,
        deepgramApiKeyLast4
      });
    }
  });

  deepgramApiKeyInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      void setDeepgramApiKey(deepgramApiKeyInput.value);
    }
  });
}

if (saveDeepgramApiKeyBtn) {
  saveDeepgramApiKeyBtn.addEventListener('click', () => {
    void setDeepgramApiKey(deepgramApiKeyInput?.value || '');
  });
}

if (clearDeepgramApiKeyBtn) {
  clearDeepgramApiKeyBtn.addEventListener('click', () => {
    void clearDeepgramApiKey();
  });
}

window.electronAPI.getAppPreferences().then((preferences) => {
  applyAppPreferences(preferences);
}).catch((error) => {
  console.error('[ERROR] Failed to load app preferences:', error);
});

window.electronAPI.onAppPreferencesUpdated((preferences) => {
  applyAppPreferences(preferences);
});

void refreshGlobalHotkeySettings();
