const closeHotkeyDialogBtn = document.getElementById('closeHotkeyDialogBtn');
const hotkeyList = document.getElementById('hotkeyList');

let globalHotkeys = [];
const globalHotkeyFeedbackTimers = new Map();

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme === 'light' ? 'light' : 'dark';
}

function formatHotkeyPartForDisplay(part) {
  switch (part) {
    case 'CommandOrControl':
      return 'Ctrl';
    case 'Super':
      return 'Win';
    case 'Escape':
      return 'Esc';
    case 'PageUp':
      return 'PgUp';
    case 'PageDown':
      return 'PgDn';
    default:
      return part;
  }
}

function formatHotkeyForDisplay(hotkey) {
  if (typeof hotkey !== 'string' || !hotkey.trim()) {
    return '';
  }

  return hotkey
    .split('+')
    .map((part) => formatHotkeyPartForDisplay(part))
    .join('+');
}

function getHotkeyKeyFromEvent(event) {
  const code = typeof event.code === 'string' ? event.code : '';
  const key = typeof event.key === 'string' ? event.key : '';
  const upperKey = key.toUpperCase();

  if (/^Key[A-Z]$/.test(code)) {
    return code.slice(3);
  }

  if (/^Digit[0-9]$/.test(code)) {
    return code.slice(5);
  }

  if (/^Numpad[0-9]$/.test(code)) {
    return `num${code.slice(6)}`;
  }

  if (code === 'Backquote' || key === '`') {
    return '`';
  }

  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(upperKey)) {
    return upperKey;
  }

  switch (key) {
    case 'ArrowUp':
      return 'Up';
    case 'ArrowDown':
      return 'Down';
    case 'ArrowLeft':
      return 'Left';
    case 'ArrowRight':
      return 'Right';
    case ' ':
    case 'Spacebar':
      return 'Space';
    case 'Enter':
      return 'Enter';
    case 'Tab':
      return 'Tab';
    case 'Escape':
    case 'Esc':
      return 'Escape';
    case 'Backspace':
      return 'Backspace';
    case 'Delete':
    case 'Del':
      return 'Delete';
    case 'Insert':
      return 'Insert';
    case 'Home':
      return 'Home';
    case 'End':
      return 'End';
    case 'PageUp':
      return 'PageUp';
    case 'PageDown':
      return 'PageDown';
    default:
      return '';
  }
}

function getHotkeyCaptureFromEvent(event) {
  const key = getHotkeyKeyFromEvent(event);
  if (!key) {
    return null;
  }

  const acceleratorParts = [];
  const displayParts = [];

  if (event.ctrlKey) {
    acceleratorParts.push('CommandOrControl');
    displayParts.push('Ctrl');
  }

  if (event.altKey) {
    acceleratorParts.push('Alt');
    displayParts.push('Alt');
  }

  if (event.shiftKey) {
    acceleratorParts.push('Shift');
    displayParts.push('Shift');
  }

  if (event.metaKey) {
    acceleratorParts.push('Super');
    displayParts.push('Win');
  }

  acceleratorParts.push(key);
  displayParts.push(formatHotkeyPartForDisplay(key));

  return {
    accelerator: acceleratorParts.join('+'),
    displayValue: displayParts.join('+'),
    isValid: displayParts.length > 1 || /^F([1-9]|1[0-9]|2[0-4])$/.test(key)
  };
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

window.electronAPI.getAppPreferences().then((preferences) => {
  applyTheme(preferences?.theme);
}).catch((error) => {
  console.error('[ERROR] Failed to load app preferences:', error);
});

window.electronAPI.onAppPreferencesUpdated((preferences) => {
  applyTheme(preferences?.theme);
});

void refreshGlobalHotkeySettings();
