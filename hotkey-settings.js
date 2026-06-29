const closeHotkeyDialogBtn = document.getElementById('closeHotkeyDialogBtn');
const hotkeyList = document.getElementById('hotkeyList');
const translationEnabledToggle = document.getElementById('translationEnabledToggle');
const {
  formatHotkeyForDisplay,
  getHotkeyCaptureFromEvent
} = window.hotkeyHelpers;

let globalHotkeys = [];
let translationEnabled = false;
const globalHotkeyFeedbackTimers = new Map();
const HOTKEY_FEEDBACK_RESET_DELAY_MS = 1400;

function updateTranslationEnabledToggle(isEnabled) {
  translationEnabled = isEnabled !== false;

  if (translationEnabledToggle) {
    translationEnabledToggle.checked = translationEnabled;
    translationEnabledToggle.disabled = false;
  }
}

function applyAppPreferences(preferences = {}) {
  if (typeof preferences?.translationEnabled === 'boolean') {
    updateTranslationEnabledToggle(preferences.translationEnabled);
  } else {
    updateTranslationEnabledToggle(false);
  }
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

if (translationEnabledToggle) {
  translationEnabledToggle.addEventListener('change', (event) => {
    void applyTranslationEnabled(event.currentTarget.checked);
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
