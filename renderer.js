const tabBar = document.getElementById('tabBar');
const newTabBtn = document.getElementById('newTabBtn');
const urlInput = document.getElementById('urlInput');
const backBtn = document.getElementById('backBtn');
const forwardBtn = document.getElementById('forwardBtn');
const reloadBtn = document.getElementById('reloadBtn');
const loadingIndicator = document.getElementById('loadingIndicator');
const transcriptEl = document.getElementById('transcript');
const transcriptRowsEl = document.getElementById('transcriptRows');
const clearTranscriptBtn = document.getElementById('clearTranscriptBtn');
const closeAppBtn = document.getElementById('closeAppBtn');
const toggleTranscriptPanelBtn = document.getElementById('toggleTranscriptPanelBtn');
const toggleLiveCaptionsBtn = document.getElementById('toggleLiveCaptionsBtn');
const toggleTranslationBtn = document.getElementById('toggleTranslationBtn');
const browserContainer = document.querySelector('.browser-container');
const leftPanel = document.querySelector('.left-panel');
const panelDivider = document.getElementById('panelDivider');
const modePanel = document.querySelector('.mode-panel');
const modeToggleBtn = document.getElementById('modeToggleBtn');
const modeDropdown = document.getElementById('modeDropdown');
const modeDropdownToggle = document.getElementById('modeDropdownToggle');
const modeDropdownLabel = document.getElementById('modeDropdownLabel');
const modeDropdownMenu = document.getElementById('modeDropdownMenu');
const collapsedModeDropdown = document.getElementById('collapsedModeDropdown');
const collapsedModeDropdownToggle = document.getElementById('collapsedModeDropdownToggle');
const collapsedModeDropdownLabel = document.getElementById('collapsedModeDropdownLabel');
const collapsedModeDropdownMenu = document.getElementById('collapsedModeDropdownMenu');
const modePromptPreview = document.getElementById('modePromptPreview');
const modeHotkeyInput = document.getElementById('modeHotkeyInput');
const modeSuffixInput = document.getElementById('modeSuffixInput');

const tabs = new Map();
let activeTabId = null;
let transcriptHistory = '';
let transcriptEntriesSignature = '';
let isUserScrolling = false;
let scrollTimeout = null;
let liveCaptionsWindowVisible = true;
let translationsVisible = false;
let isTranscriptPanelCollapsed = true;
let currentPanelSplitRatio = 0.2;
let isModePanelCollapsed = true;
let promptModes = [];
let selectedPromptModeId = null;
let isModeDropdownOpen = false;
let isModeEditorDirty = false;
let editingPromptModeId = null;
let modeHotkeyStatus = 'idle';
let modeHotkeyDisplayOverride = null;
let modeHotkeyFeedbackTimer = null;
let pendingModeSelectionTimer = null;
let promptModeAutosaveTimer = null;
let promptModeAutosaveRequest = Promise.resolve();
let promptModeStateSyncRequest = Promise.resolve();
let panelResizeState = null;
let panelRatioSyncFrame = null;
let pendingPanelRatioToSync = null;

const PANEL_DIVIDER_WIDTH = 10;
const MIN_TRANSCRIPT_PANEL_HEIGHT = 55;
const MIN_BROWSER_PANEL_HEIGHT = 190;
const MODE_SELECTION_DELAY_MS = 320;
const PROMPT_MODE_AUTOSAVE_DELAY_MS = 400;
const MODE_HOTKEY_FEEDBACK_RESET_DELAY_MS = 1400;

function formatUrl(input) {
  if (!input || input.trim() === '') {
    return 'about:blank';
  }

  const trimmed = input.trim();

  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    return trimmed;
  }

  if (trimmed.includes('.') && !trimmed.includes(' ')) {
    return 'https://' + trimmed;
  }

  return 'https://www.google.com/search?q=' + encodeURIComponent(trimmed);
}

function getTabElement(tabId) {
  return tabBar.querySelector(`[data-tab-id="${tabId}"]`);
}

function updateNavigationButtons(canGoBack, canGoForward) {
  backBtn.disabled = !canGoBack;
  forwardBtn.disabled = !canGoForward;
}

function createTabElement(tabData) {
  const tab = document.createElement('div');
  tab.className = 'tab';
  tab.dataset.tabId = tabData.id;
  tab.tabIndex = 0;
  tab.setAttribute('role', 'tab');
  tab.setAttribute('aria-selected', 'false');

  const title = document.createElement('span');
  title.className = 'tab-title';
  title.textContent = tabData.title || 'New Tab';

  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'tab-close';
  close.textContent = '\u00D7';
  close.setAttribute('aria-label', `Close ${tabData.title || 'tab'}`);
  close.onclick = (event) => {
    event.stopPropagation();
    closeTab(tabData.id);
  };

  tab.appendChild(title);
  tab.appendChild(close);
  tab.onclick = () => switchTab(tabData.id);
  tab.onkeydown = (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      switchTab(tabData.id);
    }
  };

  return tab;
}

function updateTabElement(tabId, updates) {
  const tabElement = getTabElement(tabId);
  if (!tabElement) {
    return;
  }

  if (updates.title !== undefined) {
    const titleElement = tabElement.querySelector('.tab-title');
    if (titleElement) {
      titleElement.textContent = updates.title || 'New Tab';
    }

    const closeButton = tabElement.querySelector('.tab-close');
    if (closeButton) {
      closeButton.setAttribute('aria-label', `Close ${updates.title || 'tab'}`);
    }
  }

  if (updates.active !== undefined) {
    tabElement.classList.toggle('active', updates.active);
    tabElement.setAttribute('aria-selected', updates.active ? 'true' : 'false');
  }
}

function setActiveTabState(tabId) {
  if (activeTabId !== null && activeTabId !== tabId) {
    updateTabElement(activeTabId, { active: false });
  }

  activeTabId = tabId;

  if (activeTabId !== null) {
    updateTabElement(activeTabId, { active: true });
  }
}

function syncFromSnapshot(snapshot) {
  if (!snapshot || !Array.isArray(snapshot.tabs)) {
    return;
  }

  if (Number.isFinite(snapshot.panelSplitRatio)) {
    applyPanelSplitRatio(snapshot.panelSplitRatio);
  }

  updateTranscriptPanelCollapsed(Boolean(snapshot.transcriptPanelCollapsed));
  updateModePanelCollapsed(Boolean(snapshot.modePanelCollapsed));
  updatePromptModeState(snapshot);

  tabs.clear();
  activeTabId = null;

  for (const tabElement of tabBar.querySelectorAll('.tab')) {
    tabElement.remove();
  }

  for (const tabData of snapshot.tabs) {
    tabs.set(tabData.id, tabData);
    tabBar.insertBefore(createTabElement(tabData), newTabBtn);
  }

  if (snapshot.activeTabId !== null && tabs.has(snapshot.activeTabId)) {
    const activeTab = tabs.get(snapshot.activeTabId);
    setActiveTabState(snapshot.activeTabId);
    urlInput.value = activeTab.url === 'about:blank' ? '' : activeTab.url;
    updateNavigationButtons(activeTab.canGoBack, activeTab.canGoForward);
    loadingIndicator.style.display = activeTab.isLoading ? 'block' : 'none';
    return;
  }

  urlInput.value = '';
  loadingIndicator.style.display = 'none';
  updateNavigationButtons(false, false);
}

function closeTab(tabId) {
  window.electronAPI.closeTab(tabId);
}

function switchTab(tabId) {
  window.electronAPI.switchTab(tabId);
}

function checkIfAtBottom() {
  if (!transcriptEl) {
    return false;
  }

  const threshold = 50;
  const { scrollTop, scrollHeight, clientHeight } = transcriptEl;
  return (scrollHeight - scrollTop - clientHeight) <= threshold;
}

function normalizeTranscriptEntries(data) {
  if (Array.isArray(data?.entries)) {
    return data.entries
      .filter((entry) => entry && typeof entry.sourceText === 'string' && entry.sourceText.trim())
      .map((entry, index) => {
        const status = ['pending', 'translated', 'error'].includes(entry.status)
          ? entry.status
          : 'pending';

        return {
          id: typeof entry.id === 'string' && entry.id ? entry.id : `caption-${index}`,
          sourceText: entry.sourceText,
          translatedText: typeof entry.translatedText === 'string' ? entry.translatedText : '',
          status,
          isFinal: Boolean(entry.isFinal)
        };
      });
  }

  const fallbackText = typeof data?.fullText === 'string' ? data.fullText.trim() : '';
  if (!fallbackText) {
    return [];
  }

  return [{
    id: 'caption-fallback',
    sourceText: fallbackText,
    translatedText: '',
    status: 'pending',
    isFinal: false
  }];
}

function getTranscriptEntriesSignature(entries) {
  return JSON.stringify(entries.map((entry) => ({
    id: entry.id,
    sourceText: entry.sourceText,
    translatedText: entry.translatedText,
    status: entry.status,
    isFinal: entry.isFinal
  })));
}

function renderTranscriptEntries(entries) {
  if (!transcriptEl) {
    return;
  }

  transcriptEl.classList.remove('has-error');

  if (!transcriptRowsEl) {
    transcriptEl.textContent = entries.map((entry) => entry.sourceText).join('\n');
    return;
  }

  transcriptRowsEl.textContent = '';

  for (const entry of entries) {
    const row = document.createElement('div');
    row.className = `transcript-row transcript-row-${entry.status}`;
    row.dataset.captionId = entry.id;
    row.classList.toggle('is-partial', !entry.isFinal);

    const sourceCell = document.createElement('div');
    sourceCell.className = 'transcript-cell transcript-cell-source';
    sourceCell.textContent = entry.sourceText;

    const translatedCell = document.createElement('div');
    translatedCell.className = 'transcript-cell transcript-cell-translation';

    if (entry.status === 'pending' && !entry.translatedText) {
      translatedCell.classList.add('is-placeholder');
      translatedCell.textContent = 'Translating...';
    } else {
      translatedCell.textContent = entry.translatedText;
    }

    if (entry.status === 'pending' && entry.translatedText) {
      translatedCell.classList.add('is-refreshing');
    }

    row.appendChild(sourceCell);
    row.appendChild(translatedCell);
    transcriptRowsEl.appendChild(row);
  }
}

function setTranslationVisibility(isVisible) {
  translationsVisible = Boolean(isVisible);

  if (transcriptEl) {
    transcriptEl.classList.toggle('is-translation-hidden', !translationsVisible);
  }

  if (toggleTranslationBtn) {
    toggleTranslationBtn.classList.toggle('is-hidden-state', !translationsVisible);
    toggleTranslationBtn.title = translationsVisible ? 'Hide translations' : 'Show translations';
    toggleTranslationBtn.setAttribute(
      'aria-label',
      translationsVisible ? 'Hide translations' : 'Show translations'
    );
    toggleTranslationBtn.setAttribute('aria-pressed', String(!translationsVisible));
  }
}

function renderTranscriptError(errorMessage) {
  if (!transcriptEl) {
    return;
  }

  transcriptEl.classList.add('has-error');

  if (!transcriptRowsEl) {
    transcriptEl.textContent = errorMessage;
    return;
  }

  transcriptRowsEl.textContent = '';

  const errorRow = document.createElement('div');
  errorRow.className = 'transcript-row transcript-error-row';

  const errorCell = document.createElement('div');
  errorCell.className = 'transcript-cell transcript-error-cell';
  errorCell.textContent = errorMessage;

  errorRow.appendChild(errorCell);
  transcriptRowsEl.appendChild(errorRow);
}

function getPanelMetrics() {
  if (!browserContainer) {
    return null;
  }

  const adjustableHeight = Math.max(0, browserContainer.clientHeight - PANEL_DIVIDER_WIDTH);

  if (adjustableHeight <= 0) {
    return {
      adjustableHeight: 0,
      minTranscriptHeight: 0,
      maxTranscriptHeight: 0
    };
  }

  let minTranscriptHeight = MIN_TRANSCRIPT_PANEL_HEIGHT;
  let minBrowserPanelHeight = MIN_BROWSER_PANEL_HEIGHT;

  if (adjustableHeight < (minTranscriptHeight + minBrowserPanelHeight)) {
    const fallbackHeight = Math.floor(adjustableHeight / 2);
    minTranscriptHeight = Math.min(minTranscriptHeight, fallbackHeight);
    minBrowserPanelHeight = Math.min(minBrowserPanelHeight, Math.max(0, adjustableHeight - minTranscriptHeight));
  }

  const maxTranscriptHeight = Math.max(minTranscriptHeight, adjustableHeight - minBrowserPanelHeight);

  return {
    adjustableHeight,
    minTranscriptHeight,
    maxTranscriptHeight
  };
}

function clampPanelSplitRatio(ratio) {
  const metrics = getPanelMetrics();
  const nextRatio = Number.isFinite(ratio) ? ratio : currentPanelSplitRatio;

  if (!metrics || metrics.adjustableHeight <= 0) {
    return nextRatio;
  }

  const desiredTranscriptHeight = metrics.adjustableHeight * nextRatio;
  const clampedTranscriptHeight = Math.min(
    metrics.maxTranscriptHeight,
    Math.max(metrics.minTranscriptHeight, desiredTranscriptHeight)
  );

  return clampedTranscriptHeight / metrics.adjustableHeight;
}

function applyPanelSplitRatio(ratio) {
  if (!leftPanel) {
    return;
  }

  currentPanelSplitRatio = clampPanelSplitRatio(ratio);

  const metrics = getPanelMetrics();
  if (!metrics || metrics.adjustableHeight <= 0) {
    return;
  }

  const transcriptHeight = Math.round(metrics.adjustableHeight * currentPanelSplitRatio);
  leftPanel.style.height = `${transcriptHeight}px`;
}

function queuePanelSplitRatioSync(ratio) {
  pendingPanelRatioToSync = ratio;

  if (panelRatioSyncFrame !== null) {
    return;
  }

  panelRatioSyncFrame = window.requestAnimationFrame(() => {
    const ratioToSync = pendingPanelRatioToSync;
    panelRatioSyncFrame = null;
    pendingPanelRatioToSync = null;

    window.electronAPI.setPanelSplitRatio(ratioToSync).catch((error) => {
      console.error('[ERROR] Failed to sync panel split ratio:', error);
    });
  });
}

function updatePanelSplitFromPointer(clientY) {
  if (!panelResizeState || !browserContainer) {
    return;
  }

  const rect = browserContainer.getBoundingClientRect();
  const metrics = getPanelMetrics();
  if (!metrics || metrics.adjustableHeight <= 0) {
    return;
  }

  const rawTranscriptHeight = clientY - rect.top - panelResizeState.pointerOffset;
  const ratio = rawTranscriptHeight / metrics.adjustableHeight;
  applyPanelSplitRatio(ratio);
  queuePanelSplitRatioSync(currentPanelSplitRatio);
}

function stopPanelResize(pointerId = null) {
  if (!panelResizeState) {
    return;
  }

  panelResizeState = null;
  browserContainer?.classList.remove('is-resizing');
  document.body.classList.remove('is-resizing-panels');

  if (
    panelDivider
    && pointerId !== null
    && typeof panelDivider.hasPointerCapture === 'function'
    && panelDivider.hasPointerCapture(pointerId)
  ) {
    panelDivider.releasePointerCapture(pointerId);
  }

  document.removeEventListener('pointermove', handlePanelDividerPointerMove);
  document.removeEventListener('pointerup', handlePanelDividerPointerUp);
  document.removeEventListener('pointercancel', handlePanelDividerPointerUp);
}

function handlePanelDividerPointerMove(event) {
  if (!panelResizeState) {
    return;
  }

  event.preventDefault();
  updatePanelSplitFromPointer(event.clientY);
}

function handlePanelDividerPointerUp(event) {
  event.preventDefault();
  stopPanelResize(event.pointerId);
}

function setButtonBusy(button, isBusy) {
  if (!button) {
    return;
  }

  button.disabled = isBusy;
  button.setAttribute('aria-busy', isBusy ? 'true' : 'false');
}

function updateTranscriptPanelCollapsed(isCollapsed) {
  if (!leftPanel || !toggleTranscriptPanelBtn) {
    return;
  }

  isTranscriptPanelCollapsed = Boolean(isCollapsed);
  leftPanel.classList.toggle('is-collapsed', isTranscriptPanelCollapsed);

  const actionLabel = isTranscriptPanelCollapsed
    ? 'Expand transcript panel'
    : 'Collapse transcript panel';

  toggleTranscriptPanelBtn.title = actionLabel;
  toggleTranscriptPanelBtn.setAttribute('aria-label', actionLabel);
  toggleTranscriptPanelBtn.setAttribute('aria-expanded', String(!isTranscriptPanelCollapsed));

  if (!isTranscriptPanelCollapsed) {
    applyPanelSplitRatio(currentPanelSplitRatio);
  }
}

function updateModePanelCollapsed(isCollapsed) {
  if (!modePanel || !modeToggleBtn) {
    return;
  }

  isModePanelCollapsed = Boolean(isCollapsed);
  if (isModePanelCollapsed) {
    setModeDropdownOpen(false);
  }
  modePanel.classList.toggle('is-collapsed', isModePanelCollapsed);

  const actionLabel = isModePanelCollapsed
    ? 'Expand Mode panel'
    : 'Collapse Mode panel';

  modeToggleBtn.title = actionLabel;
  modeToggleBtn.setAttribute('aria-label', actionLabel);
  modeToggleBtn.setAttribute('aria-expanded', String(!isModePanelCollapsed));
}

function getSelectedPromptMode() {
  return promptModes.find((mode) => mode.id === selectedPromptModeId) || null;
}

function getSortedPromptModes() {
  return [...promptModes].sort((left, right) => left.name.localeCompare(right.name, undefined, {
    sensitivity: 'base',
    numeric: true
  }));
}

function getModeDropdownMenus() {
  return [modeDropdownMenu, collapsedModeDropdownMenu].filter(Boolean);
}

function getModeDropdownToggles() {
  return [modeDropdownToggle, collapsedModeDropdownToggle].filter(Boolean);
}

function getModeDropdownContainers() {
  return [modeDropdown, collapsedModeDropdown].filter(Boolean);
}

function clearModeHotkeyFeedbackTimer() {
  if (modeHotkeyFeedbackTimer !== null) {
    window.clearTimeout(modeHotkeyFeedbackTimer);
    modeHotkeyFeedbackTimer = null;
  }
}

function setModeHotkeyStatus(status) {
  modeHotkeyStatus = status;

  if (!modeHotkeyInput) {
    return;
  }

  modeHotkeyInput.classList.toggle('is-success', status === 'success');
  modeHotkeyInput.classList.toggle('is-error', status === 'error');
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

function updateModeHotkeyInput() {
  if (!modeHotkeyInput) {
    return;
  }

  const selectedMode = getSelectedPromptMode();
  modeHotkeyInput.disabled = !selectedMode;
  modeHotkeyInput.placeholder = selectedMode ? 'Press shortcut' : 'Select a mode';
  modeHotkeyInput.value = modeHotkeyDisplayOverride !== null
    ? modeHotkeyDisplayOverride
    : formatHotkeyForDisplay(selectedMode?.hotkey || '');
}

function resetModeHotkeyFeedback() {
  clearModeHotkeyFeedbackTimer();
  modeHotkeyDisplayOverride = null;
  setModeHotkeyStatus('idle');
  updateModeHotkeyInput();
}

function releaseModeHotkeyInputFocus() {
  if (!modeHotkeyInput) {
    return;
  }

  window.requestAnimationFrame(() => {
    if (document.activeElement === modeHotkeyInput) {
      modeHotkeyInput.blur();
    }
  });
}

function showModeHotkeyFailure(displayValue = '') {
  clearModeHotkeyFeedbackTimer();
  modeHotkeyDisplayOverride = displayValue;
  setModeHotkeyStatus('error');
  updateModeHotkeyInput();

  modeHotkeyFeedbackTimer = window.setTimeout(() => {
    modeHotkeyFeedbackTimer = null;
    modeHotkeyDisplayOverride = null;
    updateModeHotkeyInput();
  }, MODE_HOTKEY_FEEDBACK_RESET_DELAY_MS);
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

async function applyPromptModeHotkey(modeId, hotkey, displayValue) {
  try {
    const result = await window.electronAPI.setPromptModeHotkey({
      modeId,
      hotkey
    });

    if (result?.promptModeState) {
      updatePromptModeState(result.promptModeState, { resetHotkeyFeedback: false });
    }

    if (result?.success) {
      clearModeHotkeyFeedbackTimer();
      modeHotkeyDisplayOverride = null;
      setModeHotkeyStatus('success');
      updateModeHotkeyInput();
      return;
    }
  } catch (error) {
    console.error('[ERROR] Failed to update prompt mode hotkey:', error);
  }

  showModeHotkeyFailure(displayValue);
}

function setModeDropdownOpen(isOpen) {
  if (getModeDropdownMenus().length === 0 || getModeDropdownToggles().length === 0) {
    return;
  }

  isModeDropdownOpen = Boolean(isOpen);
  if (!isModeDropdownOpen) {
    editingPromptModeId = null;
    clearPendingModeSelection();
  }

  for (const dropdownContainer of getModeDropdownContainers()) {
    dropdownContainer.classList.toggle('is-open', isModeDropdownOpen);
  }

  for (const dropdownToggle of getModeDropdownToggles()) {
    dropdownToggle.setAttribute('aria-expanded', String(isModeDropdownOpen));
  }

  for (const dropdownMenu of getModeDropdownMenus()) {
    dropdownMenu.hidden = !isModeDropdownOpen;
  }
}

function clearPendingModeSelection() {
  if (pendingModeSelectionTimer !== null) {
    window.clearTimeout(pendingModeSelectionTimer);
    pendingModeSelectionTimer = null;
  }
}

function updateModeEditorDirtyState() {
  if (!modeSuffixInput) {
    return;
  }

  const selectedMode = getSelectedPromptMode();
  const originalSuffix = selectedMode?.suffix || '';
  isModeEditorDirty = Boolean(selectedMode) && modeSuffixInput.value !== originalSuffix;
}

async function saveCurrentPromptModeIfNeeded() {
  if (!modeSuffixInput) {
    return;
  }

  updateModeEditorDirtyState();

  const selectedMode = getSelectedPromptMode();
  if (!selectedMode || !isModeEditorDirty) {
    return;
  }

  const nextState = await window.electronAPI.savePromptMode({
    modeId: selectedMode.id,
    suffix: modeSuffixInput.value
  });
  updatePromptModeState(nextState);
}

function queuePromptModeAutosave() {
  if (!modeSuffixInput) {
    return;
  }

  updateModeEditorDirtyState();

  if (!isModeEditorDirty) {
    if (promptModeAutosaveTimer !== null) {
      window.clearTimeout(promptModeAutosaveTimer);
      promptModeAutosaveTimer = null;
    }
    return;
  }

  if (promptModeAutosaveTimer !== null) {
    window.clearTimeout(promptModeAutosaveTimer);
  }

  promptModeAutosaveTimer = window.setTimeout(() => {
    promptModeAutosaveTimer = null;
    promptModeAutosaveRequest = saveCurrentPromptModeIfNeeded().catch((error) => {
      console.error('[ERROR] Failed to auto-save prompt mode:', error);
      throw error;
    });
  }, PROMPT_MODE_AUTOSAVE_DELAY_MS);
}

async function flushPendingPromptModeAutosave() {
  if (promptModeAutosaveTimer !== null) {
    window.clearTimeout(promptModeAutosaveTimer);
    promptModeAutosaveTimer = null;
    await saveCurrentPromptModeIfNeeded();
    return;
  }

  await promptModeAutosaveRequest.catch((error) => {
    console.error('[ERROR] Prompt mode auto-save request failed:', error);
    throw error;
  });
}

async function commitPromptModeRename(modeId, nextName) {
  const trimmedName = typeof nextName === 'string' ? nextName.trim() : '';
  const mode = promptModes.find((entry) => entry.id === modeId);
  editingPromptModeId = null;

  if (!mode || !trimmedName || trimmedName === mode.name) {
    renderModeDropdownMenu();
    return;
  }

  try {
    await flushPendingPromptModeAutosave();
    const nextState = await window.electronAPI.renamePromptMode({
      modeId,
      name: trimmedName
    });
    updatePromptModeState(nextState);
  } catch (error) {
    console.error('[ERROR] Failed to rename prompt mode:', error);
    renderModeDropdownMenu();
  }
}

function startPromptModeRename(modeId, sourceMenuElement = null) {
  clearPendingModeSelection();
  editingPromptModeId = modeId;
  renderModeDropdownMenu();

  window.requestAnimationFrame(() => {
    const renameInput = sourceMenuElement?.querySelector('.mode-dropdown-edit-input')
      || document.querySelector('.mode-dropdown-edit-input');
    if (!renameInput) {
      return;
    }

    renameInput.focus();
    renameInput.select();
  });
}

async function selectPromptModeFromMenu(modeId) {
  try {
    await flushPendingPromptModeAutosave();
    const nextState = await window.electronAPI.selectPromptMode(modeId);
    updatePromptModeState(nextState);
    setModeDropdownOpen(false);
  } catch (error) {
    console.error('[ERROR] Failed to select prompt mode:', error);
  }
}

async function deletePromptModeFromMenu(modeId) {
  clearPendingModeSelection();
  editingPromptModeId = null;

  try {
    const nextState = await window.electronAPI.deletePromptMode(modeId);
    updatePromptModeState(nextState);
  } catch (error) {
    console.error('[ERROR] Failed to delete prompt mode:', error);
  }
}

function populateModeDropdownMenu(menuElement) {
  if (!menuElement) {
    return;
  }

  menuElement.textContent = '';
  const sortedPromptModes = getSortedPromptModes();

  for (const mode of sortedPromptModes) {
    if (mode.id === editingPromptModeId) {
      const editingItem = document.createElement('div');
      editingItem.className = 'mode-dropdown-item mode-dropdown-item-editing';
      editingItem.setAttribute('role', 'menuitem');

      if (mode.id === selectedPromptModeId) {
        editingItem.classList.add('is-active');
      }

      const renameInput = document.createElement('input');
      renameInput.type = 'text';
      renameInput.className = 'mode-dropdown-edit-input';
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
          await commitPromptModeRename(mode.id, renameInput.value);
        } else if (event.key === 'Escape') {
          event.preventDefault();
          handled = true;
          editingPromptModeId = null;
          renderModeDropdownMenu();
        }
      });

      renameInput.addEventListener('blur', async () => {
        if (handled) {
          return;
        }
        handled = true;
        await commitPromptModeRename(mode.id, renameInput.value);
      });

      editingItem.appendChild(renameInput);
      menuElement.appendChild(editingItem);
      continue;
    }

    const item = document.createElement('div');
    item.className = 'mode-dropdown-item';
    item.setAttribute('role', 'menuitem');
    item.tabIndex = 0;

    if (mode.id === selectedPromptModeId) {
      item.classList.add('is-active');
    }

    const itemCopy = document.createElement('div');
    itemCopy.className = 'mode-dropdown-item-copy';

    const itemLabel = document.createElement('span');
    itemLabel.className = 'mode-dropdown-item-label';
    itemLabel.textContent = mode.name;
    itemCopy.appendChild(itemLabel);

    const formattedHotkey = formatHotkeyForDisplay(mode.hotkey);
    if (formattedHotkey) {
      const hotkeyLabel = document.createElement('span');
      hotkeyLabel.className = 'mode-dropdown-item-hotkey';
      hotkeyLabel.textContent = formattedHotkey;
      itemCopy.appendChild(hotkeyLabel);
    }

    item.appendChild(itemCopy);

    const deleteButton = document.createElement('button');
    deleteButton.type = 'button';
    deleteButton.className = 'mode-dropdown-delete';
    deleteButton.textContent = '\u00D7';
    deleteButton.setAttribute('aria-label', `Delete ${mode.name}`);
    deleteButton.title = `Delete ${mode.name}`;

    if (promptModes.length <= 1) {
      deleteButton.disabled = true;
    }

    deleteButton.onclick = async (event) => {
      event.preventDefault();
      event.stopPropagation();

      if (deleteButton.disabled) {
        return;
      }

      await deletePromptModeFromMenu(mode.id);
    };

    item.appendChild(deleteButton);

    item.onclick = (event) => {
      if (event.detail > 1) {
        return;
      }

      clearPendingModeSelection();
      pendingModeSelectionTimer = window.setTimeout(async () => {
        pendingModeSelectionTimer = null;
        await selectPromptModeFromMenu(mode.id);
      }, MODE_SELECTION_DELAY_MS);
    };

    item.onkeydown = (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        clearPendingModeSelection();
        pendingModeSelectionTimer = window.setTimeout(async () => {
          pendingModeSelectionTimer = null;
          await selectPromptModeFromMenu(mode.id);
        }, MODE_SELECTION_DELAY_MS);
      }
    };

    item.ondblclick = (event) => {
      event.preventDefault();
      event.stopPropagation();
      startPromptModeRename(mode.id, menuElement);
    };

    menuElement.appendChild(item);
  }

  const separator = document.createElement('div');
  separator.className = 'mode-dropdown-separator';
  separator.setAttribute('aria-hidden', 'true');
  menuElement.appendChild(separator);

  const addButton = document.createElement('button');
  addButton.type = 'button';
  addButton.className = 'mode-dropdown-add';
  addButton.textContent = '+ Add Mode';
  addButton.setAttribute('role', 'menuitem');
  addButton.onclick = async () => {
    try {
      await flushPendingPromptModeAutosave();
      const nextState = await window.electronAPI.addPromptMode();
      updatePromptModeState(nextState);
      setModeDropdownOpen(false);
      modeSuffixInput?.focus();
    } catch (error) {
      console.error('[ERROR] Failed to add prompt mode:', error);
    }
  };
  menuElement.appendChild(addButton);
}

function renderModeDropdownMenu() {
  for (const menuElement of getModeDropdownMenus()) {
    populateModeDropdownMenu(menuElement);
  }
}

function updatePromptModeState(state, options = {}) {
  const previousSelectedModeId = selectedPromptModeId;
  const currentPromptDraft = modeSuffixInput ? modeSuffixInput.value : '';
  const shouldPreservePromptDraft = Boolean(modeSuffixInput && isModeEditorDirty);

  if (Array.isArray(state?.promptModes)) {
    promptModes = state.promptModes.map((mode) => ({
      id: mode.id,
      name: mode.name,
      suffix: typeof mode.suffix === 'string' ? mode.suffix : '',
      hotkey: typeof mode.hotkey === 'string' ? mode.hotkey : ''
    }));
  }

  if (typeof state?.selectedPromptModeId === 'string') {
    selectedPromptModeId = state.selectedPromptModeId;
  }

  const selectedMode = getSelectedPromptMode();
  if (!selectedMode && promptModes.length > 0) {
    selectedPromptModeId = promptModes[0].id;
  }

  const activeMode = getSelectedPromptMode();

  if (modeDropdownLabel) {
    modeDropdownLabel.textContent = activeMode?.name || 'Select mode';
  }

  if (collapsedModeDropdownLabel) {
    collapsedModeDropdownLabel.textContent = activeMode?.name || 'Select mode';
  }

  if (modeSuffixInput) {
    modeSuffixInput.value = shouldPreservePromptDraft && activeMode?.id === previousSelectedModeId
      ? currentPromptDraft
      : (activeMode?.suffix || '');
  }

  if (modePromptPreview) {
    const promptPreviewText = typeof activeMode?.suffix === 'string'
      ? activeMode.suffix.trim()
      : '';
    const singleLinePrompt = promptPreviewText.replace(/\s+/g, ' ');
    const displayPrompt = singleLinePrompt || 'No prompt';
    modePromptPreview.textContent = displayPrompt;
    modePromptPreview.title = promptPreviewText || 'No prompt';
  }

  renderModeDropdownMenu();
  updateModeEditorDirtyState();
  if (options.resetHotkeyFeedback !== false && previousSelectedModeId !== selectedPromptModeId) {
    resetModeHotkeyFeedback();
    return;
  }

  updateModeHotkeyInput();
}

async function applyIncomingPromptModeState(state) {
  const incomingSelectedModeId = typeof state?.selectedPromptModeId === 'string'
    ? state.selectedPromptModeId
    : null;

  if (
    modeSuffixInput
    && isModeEditorDirty
    && selectedPromptModeId
    && incomingSelectedModeId
    && incomingSelectedModeId !== selectedPromptModeId
  ) {
    try {
      await flushPendingPromptModeAutosave();
    } catch (error) {
      console.error('[ERROR] Failed to save prompt mode before switching modes:', error);
    }
  }

  updatePromptModeState(state);
}

function queueIncomingPromptModeState(state) {
  promptModeStateSyncRequest = promptModeStateSyncRequest
    .catch(() => undefined)
    .then(() => applyIncomingPromptModeState(state))
    .catch((error) => {
      console.error('[ERROR] Failed to sync prompt mode state:', error);
      updatePromptModeState(state);
    });
}

function updateLiveCaptionsToggleButton(isVisible) {
  if (!toggleLiveCaptionsBtn || typeof isVisible !== 'boolean') {
    return;
  }

  liveCaptionsWindowVisible = isVisible;
  toggleLiveCaptionsBtn.classList.toggle('is-hidden-state', !isVisible);

  const actionLabel = isVisible
    ? 'Hide Live Captions window'
    : 'Show Live Captions window';

  toggleLiveCaptionsBtn.title = actionLabel;
  toggleLiveCaptionsBtn.setAttribute('aria-label', actionLabel);
}

async function refreshLiveCaptionsToggleButton() {
  if (!toggleLiveCaptionsBtn) {
    return false;
  }

  try {
    const isVisible = await window.electronAPI.getLiveCaptionsWindowVisibility();
    if (typeof isVisible === 'boolean') {
      updateLiveCaptionsToggleButton(isVisible);
      return true;
    }
  } catch (error) {
    console.error('[ERROR] Failed to get Live Captions window visibility:', error);
  }

  return false;
}

if (closeAppBtn) {
  closeAppBtn.onclick = () => {
    window.electronAPI.closeApp().catch((error) => {
      console.error('[ERROR] Failed to close app:', error);
    });
  };
}

newTabBtn.onclick = () => {
  window.electronAPI.createTab('about:blank');
};

urlInput.onkeydown = (event) => {
  if (event.key !== 'Enter') {
    return;
  }

  const url = formatUrl(urlInput.value);
  if (activeTabId !== null) {
    window.electronAPI.navigate(url);
  } else {
    window.electronAPI.createTab(url);
  }

  urlInput.blur();
};

backBtn.onclick = () => {
  window.electronAPI.goBack();
};

forwardBtn.onclick = () => {
  window.electronAPI.goForward();
};

reloadBtn.onclick = () => {
  window.electronAPI.reload();
};

if (clearTranscriptBtn) {
  clearTranscriptBtn.onclick = async () => {
    setButtonBusy(clearTranscriptBtn, true);

    try {
      const result = await window.electronAPI.clearTranscript();
      if (typeof result?.liveCaptionsVisible === 'boolean') {
        updateLiveCaptionsToggleButton(result.liveCaptionsVisible);
      } else {
        await refreshLiveCaptionsToggleButton();
      }
    } catch (error) {
      console.error('[ERROR] Failed to clear transcript:', error);
    } finally {
      setButtonBusy(clearTranscriptBtn, false);
    }
  };
}

if (toggleLiveCaptionsBtn) {
  updateLiveCaptionsToggleButton(liveCaptionsWindowVisible);

  toggleLiveCaptionsBtn.onclick = async () => {
    setButtonBusy(toggleLiveCaptionsBtn, true);

    try {
      const isVisible = await window.electronAPI.toggleLiveCaptionsWindow();
      if (typeof isVisible === 'boolean') {
        updateLiveCaptionsToggleButton(isVisible);
      }
    } catch (error) {
      console.error('[ERROR] Failed to toggle Live Captions window visibility:', error);
    } finally {
      setButtonBusy(toggleLiveCaptionsBtn, false);
    }
  };
}

if (toggleTranslationBtn) {
  setTranslationVisibility(translationsVisible);

  toggleTranslationBtn.onclick = () => {
    setTranslationVisibility(!translationsVisible);
  };
} else {
  setTranslationVisibility(translationsVisible);
}

if (toggleTranscriptPanelBtn) {
  updateTranscriptPanelCollapsed(isTranscriptPanelCollapsed);

  toggleTranscriptPanelBtn.onclick = async () => {
    const nextCollapsed = !isTranscriptPanelCollapsed;
    updateTranscriptPanelCollapsed(nextCollapsed);

    try {
      const collapsed = await window.electronAPI.setTranscriptPanelCollapsed(nextCollapsed);
      updateTranscriptPanelCollapsed(collapsed);
    } catch (error) {
      updateTranscriptPanelCollapsed(!nextCollapsed);
      console.error('[ERROR] Failed to toggle transcript panel collapse state:', error);
    }
  };
}

if (panelDivider && browserContainer) {
  panelDivider.onpointerdown = (event) => {
    if (event.button !== 0) {
      return;
    }

    event.preventDefault();

    if (isTranscriptPanelCollapsed) {
      updateTranscriptPanelCollapsed(false);
      window.electronAPI.setTranscriptPanelCollapsed(false).catch((error) => {
        console.error('[ERROR] Failed to expand transcript panel before resizing:', error);
      });
    }

    const dividerRect = panelDivider.getBoundingClientRect();
    panelResizeState = {
      pointerOffset: event.clientY - dividerRect.top
    };

    browserContainer.classList.add('is-resizing');
    document.body.classList.add('is-resizing-panels');

    if (typeof panelDivider.setPointerCapture === 'function') {
      panelDivider.setPointerCapture(event.pointerId);
    }

    document.addEventListener('pointermove', handlePanelDividerPointerMove);
    document.addEventListener('pointerup', handlePanelDividerPointerUp);
    document.addEventListener('pointercancel', handlePanelDividerPointerUp);

    updatePanelSplitFromPointer(event.clientY);
  };
}

if (modeToggleBtn) {
  updateModePanelCollapsed(isModePanelCollapsed);

  modeToggleBtn.onclick = async (event) => {
    event.stopPropagation();
    const nextCollapsed = !isModePanelCollapsed;
    updateModePanelCollapsed(nextCollapsed);

    try {
      const collapsed = await window.electronAPI.setModePanelCollapsed(nextCollapsed);
      updateModePanelCollapsed(collapsed);
    } catch (error) {
      updateModePanelCollapsed(!nextCollapsed);
      console.error('[ERROR] Failed to toggle Mode panel collapse state:', error);
    }
  };
}

if (modeDropdownToggle) {
  modeDropdownToggle.onclick = (event) => {
    event.stopPropagation();
    setModeDropdownOpen(!isModeDropdownOpen);
  };
}

if (collapsedModeDropdownToggle) {
  collapsedModeDropdownToggle.onclick = (event) => {
    event.stopPropagation();
    setModeDropdownOpen(!isModeDropdownOpen);
  };
}

if (modeDropdownMenu) {
  modeDropdownMenu.addEventListener('click', (event) => {
    event.stopPropagation();
  });
}

if (collapsedModeDropdownMenu) {
  collapsedModeDropdownMenu.addEventListener('click', (event) => {
    event.stopPropagation();
  });
}

if (modeHotkeyInput) {
  modeHotkeyInput.addEventListener('focus', () => {
    clearModeHotkeyFeedbackTimer();
    modeHotkeyInput.select();
  });

  modeHotkeyInput.addEventListener('click', () => {
    modeHotkeyInput.select();
  });

  modeHotkeyInput.addEventListener('keydown', (event) => {
    const selectedMode = getSelectedPromptMode();
    if (!selectedMode) {
      return;
    }

    const noModifiers = !event.ctrlKey && !event.altKey && !event.shiftKey && !event.metaKey;
    if (event.key === 'Tab' && noModifiers) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    if (event.key === 'Escape' && noModifiers) {
      resetModeHotkeyFeedback();
      modeHotkeyInput.blur();
      return;
    }

    if ((event.key === 'Backspace' || event.key === 'Delete') && noModifiers) {
      void applyPromptModeHotkey(selectedMode.id, '', '');
      releaseModeHotkeyInputFocus();
      return;
    }

    const hotkeyCapture = getHotkeyCaptureFromEvent(event);
    if (!hotkeyCapture) {
      return;
    }

    if (!hotkeyCapture.isValid) {
      showModeHotkeyFailure(hotkeyCapture.displayValue);
      releaseModeHotkeyInputFocus();
      return;
    }

    void applyPromptModeHotkey(
      selectedMode.id,
      hotkeyCapture.accelerator,
      hotkeyCapture.displayValue
    );
    releaseModeHotkeyInputFocus();
  });
}

if (modeSuffixInput) {
  modeSuffixInput.addEventListener('input', () => {
    queuePromptModeAutosave();
  });

  modeSuffixInput.addEventListener('blur', () => {
    void flushPendingPromptModeAutosave();
  });
}

document.addEventListener('click', (event) => {
  if (!isModeDropdownOpen) {
    return;
  }

  for (const dropdownContainer of getModeDropdownContainers()) {
    if (dropdownContainer.contains(event.target)) {
      return;
    }
  }

  setModeDropdownOpen(false);
});

document.addEventListener('keydown', (event) => {
  if (event.ctrlKey || event.metaKey) {
    if (event.key === 't') {
      event.preventDefault();
      window.electronAPI.createTab('about:blank');
    } else if (event.key === 'r' || event.key === 'R') {
      event.preventDefault();
      window.electronAPI.reload();
    } else if (event.key === 'w' || event.key === 'W') {
      if (activeTabId !== null) {
        event.preventDefault();
        closeTab(activeTabId);
      }
    } else if (event.key === 'l' || event.key === 'L') {
      event.preventDefault();
      urlInput.focus();
      urlInput.select();
    }
  } else if (event.altKey) {
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      window.electronAPI.goBack();
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      window.electronAPI.goForward();
    }
  } else if (event.key === 'Escape' && isModeDropdownOpen) {
    setModeDropdownOpen(false);
  }
});

window.electronAPI.onTabCreated((data) => {
  const existingTab = tabs.get(data.id);
  tabs.set(data.id, { ...existingTab, ...data });

  if (!getTabElement(data.id)) {
    tabBar.insertBefore(createTabElement(data), newTabBtn);
  } else {
    updateTabElement(data.id, { title: data.title });
  }

  if (data.active !== false || activeTabId === null) {
    setActiveTabState(data.id);
    urlInput.value = data.url === 'about:blank' ? '' : data.url;
    loadingIndicator.style.display = 'none';
    updateNavigationButtons(false, false);
  }
});

window.electronAPI.onTabClosed((data) => {
  const tabElement = getTabElement(data.id);
  if (tabElement) {
    tabElement.remove();
  }

  tabs.delete(data.id);

  if (activeTabId === data.id) {
    activeTabId = null;
    loadingIndicator.style.display = 'none';
  }
});

window.electronAPI.onTabSwitched((data) => {
  if (tabs.has(data.id)) {
    tabs.set(data.id, { ...tabs.get(data.id), ...data });
  }

  setActiveTabState(data.id);
  urlInput.value = data.url === 'about:blank' ? '' : data.url;
  updateNavigationButtons(data.canGoBack, data.canGoForward);
  loadingIndicator.style.display = tabs.get(data.id)?.isLoading ? 'block' : 'none';
});

window.electronAPI.onTabUpdated((data) => {
  if (tabs.has(data.id)) {
    tabs.set(data.id, { ...tabs.get(data.id), ...data });
  }

  updateTabElement(data.id, { title: data.title });

  if (activeTabId === data.id) {
    urlInput.value = data.url === 'about:blank' ? '' : data.url;
    updateNavigationButtons(data.canGoBack, data.canGoForward);
  }
});

window.electronAPI.onTabTitleUpdated((data) => {
  if (tabs.has(data.id)) {
    tabs.set(data.id, { ...tabs.get(data.id), title: data.title });
  }

  updateTabElement(data.id, { title: data.title });
});

window.electronAPI.onTabNavigated((data) => {
  if (tabs.has(data.id)) {
    tabs.set(data.id, { ...tabs.get(data.id), ...data });
  }

  if (activeTabId === data.id) {
    urlInput.value = data.url === 'about:blank' ? '' : data.url;
    updateNavigationButtons(data.canGoBack, data.canGoForward);
  }
});

window.electronAPI.onTabLoading((data) => {
  if (tabs.has(data.id)) {
    tabs.set(data.id, { ...tabs.get(data.id), isLoading: data.loading });
  }

  if (activeTabId === data.id) {
    loadingIndicator.style.display = data.loading ? 'block' : 'none';
  }
});

window.electronAPI.onPromptModeState((state) => {
  queueIncomingPromptModeState(state);
});

window.electronAPI.onFocusUrlInput(() => {
  if (!urlInput) {
    return;
  }

  urlInput.focus();
  urlInput.select();
});

window.electronAPI.getTabs().then((snapshot) => {
  syncFromSnapshot(snapshot);
}).catch((error) => {
  console.error('[ERROR] Failed to load initial tab snapshot:', error);
});

updateModeHotkeyInput();
applyPanelSplitRatio(currentPanelSplitRatio);
window.addEventListener('resize', () => {
  applyPanelSplitRatio(currentPanelSplitRatio);
});

refreshLiveCaptionsToggleButton().then((updated) => {
  if (!updated) {
    window.setTimeout(() => {
      void refreshLiveCaptionsToggleButton();
    }, 1500);
  }
});

if (transcriptEl) {
  transcriptEl.addEventListener('scroll', () => {
    if (scrollTimeout) {
      clearTimeout(scrollTimeout);
    }

    isUserScrolling = true;
    scrollTimeout = setTimeout(() => {
      isUserScrolling = false;
    }, 150);
  });
}

window.electronAPI.onCaptionUpdate((data) => {
  if (!transcriptEl || !data || typeof data.fullText !== 'string') {
    return;
  }

  const nextTranscript = data.fullText;
  const nextEntries = normalizeTranscriptEntries(data);
  const nextEntriesSignature = getTranscriptEntriesSignature(nextEntries);
  if (nextTranscript === transcriptHistory && transcriptEntriesSignature === nextEntriesSignature) {
    return;
  }

  const wasAtBottom = checkIfAtBottom();
  const previousScrollTop = transcriptEl.scrollTop;

  transcriptHistory = nextTranscript;
  transcriptEntriesSignature = nextEntriesSignature;
  renderTranscriptEntries(nextEntries);

  setTimeout(() => {
    if (wasAtBottom && !isUserScrolling) {
      transcriptEl.scrollTop = transcriptEl.scrollHeight;
    } else {
      transcriptEl.scrollTop = previousScrollTop;
    }
  }, 0);
});

window.electronAPI.onCaptionError((error) => {
  if (!transcriptEl) {
    return;
  }

  transcriptHistory = '';
  transcriptEntriesSignature = '';
  const errorText = String(error || '');
  const isMissingNativeAddon =
    errorText.includes('Live Captions native addon was not found')
    || errorText.includes('livecaptions_native.node')
    || errorText.includes('Cannot find module');

  const displayText = isMissingNativeAddon
    ? `[ERROR] ${errorText}\n\nThis build is missing the Live Captions native addon.\nRun "npm run build-native" and package the app again.`
    : `[ERROR] ${errorText}\n\nPlease ensure Windows LiveCaptions is running.\nYou can start it by pressing Win + Ctrl + L`;

  renderTranscriptError(displayText);
});
