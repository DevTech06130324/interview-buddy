const modeMenu = document.getElementById('modeMenu');

const MODE_SELECTION_DELAY_MS = 320;

let promptModes = [];
let selectedPromptModeId = null;
let editingModeId = null;
let pendingModeSelectionTimer = null;

function setProtectedTooltip(element, text) {
  if (!element) {
    return;
  }

  if (window.protectedTooltips && typeof window.protectedTooltips.setTooltip === 'function') {
    window.protectedTooltips.setTooltip(element, text);
    return;
  }

  const tooltipText = String(text || '').trim();
  element.removeAttribute('title');
  if (tooltipText) {
    element.setAttribute('data-protected-tooltip', tooltipText);
  } else {
    element.removeAttribute('data-protected-tooltip');
  }
}

function clearPendingModeSelection() {
  if (pendingModeSelectionTimer !== null) {
    window.clearTimeout(pendingModeSelectionTimer);
    pendingModeSelectionTimer = null;
  }
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
    .map((part) => part.trim())
    .filter(Boolean)
    .map(formatHotkeyPartForDisplay)
    .join(' + ');
}

function getSortedPromptModes() {
  return [...promptModes].sort((left, right) => left.name.localeCompare(right.name, undefined, {
    sensitivity: 'base',
    numeric: true
  }));
}

async function sendModeMenuAction(action) {
  if (!window.electronAPI?.modeMenuAction) {
    return false;
  }

  try {
    return await window.electronAPI.modeMenuAction(action);
  } catch (error) {
    console.error('[ERROR] Failed to send Mode menu action:', error);
    return false;
  }
}

function closeModeMenu() {
  if (!window.electronAPI?.closeModeMenu) {
    return;
  }

  window.electronAPI.closeModeMenu().catch((error) => {
    console.error('[ERROR] Failed to close Mode menu:', error);
  });
}

async function commitModeRename(modeId, nextName) {
  const mode = promptModes.find((entry) => entry.id === modeId);
  const trimmedName = typeof nextName === 'string' ? nextName.trim() : '';
  editingModeId = null;

  if (!mode || !trimmedName || trimmedName === mode.name) {
    renderModeMenu();
    return;
  }

  await sendModeMenuAction({
    type: 'rename',
    modeId,
    name: trimmedName
  });
  renderModeMenu();
}

function startModeRename(modeId) {
  clearPendingModeSelection();
  editingModeId = modeId;
  renderModeMenu();

  window.requestAnimationFrame(() => {
    const renameInput = document.querySelector('.mode-menu-edit-input');
    if (!renameInput) {
      return;
    }

    renameInput.focus();
    renameInput.select();
  });
}

function createEditingItem(mode) {
  const editingItem = document.createElement('div');
  editingItem.className = 'mode-menu-item mode-menu-editing';
  editingItem.setAttribute('role', 'menuitem');

  if (mode.id === selectedPromptModeId) {
    editingItem.classList.add('is-active');
  }

  const renameInput = document.createElement('input');
  renameInput.type = 'text';
  renameInput.className = 'mode-menu-edit-input';
  renameInput.value = mode.name;
  renameInput.setAttribute('aria-label', `Rename ${mode.name}`);

  let handled = false;

  renameInput.addEventListener('click', (event) => {
    event.stopPropagation();
  });

  renameInput.addEventListener('keydown', async (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      if (handled) {
        return;
      }
      handled = true;
      await commitModeRename(mode.id, renameInput.value);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      handled = true;
      editingModeId = null;
      renderModeMenu();
    }
  });

  renameInput.addEventListener('blur', async () => {
    if (handled) {
      return;
    }
    handled = true;
    await commitModeRename(mode.id, renameInput.value);
  });

  editingItem.appendChild(renameInput);
  return editingItem;
}

function createModeItem(mode) {
  const item = document.createElement('div');
  item.className = 'mode-menu-item';
  item.setAttribute('role', 'menuitem');
  item.tabIndex = 0;

  if (mode.id === selectedPromptModeId) {
    item.classList.add('is-active');
  }

  const itemCopy = document.createElement('div');
  itemCopy.className = 'mode-menu-item-copy';

  const itemLabel = document.createElement('span');
  itemLabel.className = 'mode-menu-item-label';
  itemLabel.textContent = mode.name;
  itemCopy.appendChild(itemLabel);

  const formattedHotkey = formatHotkeyForDisplay(mode.hotkey);
  if (formattedHotkey) {
    const hotkeyLabel = document.createElement('span');
    hotkeyLabel.className = 'mode-menu-item-hotkey';
    hotkeyLabel.textContent = formattedHotkey;
    itemCopy.appendChild(hotkeyLabel);
  }

  item.appendChild(itemCopy);

  const deleteButton = document.createElement('button');
  deleteButton.type = 'button';
  deleteButton.className = 'mode-menu-delete';
  deleteButton.textContent = '\u00D7';
  deleteButton.setAttribute('aria-label', `Delete ${mode.name}`);
  setProtectedTooltip(deleteButton, `Delete ${mode.name}`);
  deleteButton.disabled = promptModes.length <= 1;

  deleteButton.onclick = async (event) => {
    event.preventDefault();
    event.stopPropagation();

    if (deleteButton.disabled) {
      return;
    }

    clearPendingModeSelection();
    editingModeId = null;
    await sendModeMenuAction({ type: 'delete', modeId: mode.id });
  };

  item.appendChild(deleteButton);

  item.onclick = (event) => {
    if (event.detail > 1) {
      return;
    }

    clearPendingModeSelection();
    pendingModeSelectionTimer = window.setTimeout(async () => {
      pendingModeSelectionTimer = null;
      await sendModeMenuAction({ type: 'select', modeId: mode.id });
    }, MODE_SELECTION_DELAY_MS);
  };

  item.onkeydown = (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') {
      return;
    }

    event.preventDefault();
    clearPendingModeSelection();
    pendingModeSelectionTimer = window.setTimeout(async () => {
      pendingModeSelectionTimer = null;
      await sendModeMenuAction({ type: 'select', modeId: mode.id });
    }, MODE_SELECTION_DELAY_MS);
  };

  item.ondblclick = (event) => {
    event.preventDefault();
    event.stopPropagation();
    startModeRename(mode.id);
  };

  return item;
}

function renderModeMenu() {
  if (!modeMenu) {
    return;
  }

  modeMenu.textContent = '';

  for (const mode of getSortedPromptModes()) {
    modeMenu.appendChild(mode.id === editingModeId
      ? createEditingItem(mode)
      : createModeItem(mode));
  }

  const separator = document.createElement('div');
  separator.className = 'mode-menu-separator';
  separator.setAttribute('aria-hidden', 'true');
  modeMenu.appendChild(separator);

  const addButton = document.createElement('button');
  addButton.type = 'button';
  addButton.className = 'mode-menu-add';
  addButton.textContent = '+ Add Mode';
  addButton.setAttribute('role', 'menuitem');
  addButton.onclick = async () => {
    await sendModeMenuAction({ type: 'add' });
  };
  modeMenu.appendChild(addButton);
}

function applyModeMenuState(state = {}) {
  if (state.theme === 'light' || state.theme === 'dark') {
    document.documentElement.dataset.theme = state.theme;
  }

  if (Array.isArray(state.promptModes)) {
    promptModes = state.promptModes.map((mode) => ({
      id: mode.id,
      name: mode.name,
      suffix: typeof mode.suffix === 'string' ? mode.suffix : '',
      hotkey: typeof mode.hotkey === 'string' ? mode.hotkey : ''
    }));
  }

  if (typeof state.selectedPromptModeId === 'string') {
    selectedPromptModeId = state.selectedPromptModeId;
  }

  if (editingModeId && !promptModes.some((mode) => mode.id === editingModeId)) {
    editingModeId = null;
  }

  renderModeMenu();
}

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    event.preventDefault();
    closeModeMenu();
  }
});

window.electronAPI.onModeMenuState((state) => {
  applyModeMenuState(state);
});

window.electronAPI.getModeMenuState().then((state) => {
  applyModeMenuState(state);
}).catch((error) => {
  console.error('[ERROR] Failed to load Mode menu state:', error);
});
