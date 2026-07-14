const tabBar = document.getElementById('tabBar');
const newTabBtn = document.getElementById('newTabBtn');
const urlInput = document.getElementById('urlInput');
const backBtn = document.getElementById('backBtn');
const forwardBtn = document.getElementById('forwardBtn');
const reloadBtn = document.getElementById('reloadBtn');
const loadingIndicator = document.getElementById('loadingIndicator');
const transcriptEl = document.getElementById('transcript');
const transcriptRowsEl = document.getElementById('transcriptRows');
const newTranscriptIndicator = document.getElementById('newTranscriptIndicator');
const transcriptSourceStatus = document.getElementById('transcriptSourceStatus');
const transcriptHeader = document.getElementById('transcriptHeader');
const transcriptSourcePill = document.getElementById('transcriptSourcePill');
const transcriptEmptyState = document.getElementById('transcriptEmptyState');
const transcriptEmptyTitle = document.getElementById('transcriptEmptyTitle');
const transcriptEmptyCopy = document.getElementById('transcriptEmptyCopy');
const deepgramUsageStatus = document.getElementById('deepgramUsageStatus');
const deepgramRemainingUsageValue = document.getElementById('deepgramRemainingUsageValue');
const saveTranscriptBtn = document.getElementById('saveTranscriptBtn');
const clearTranscriptBtn = document.getElementById('clearTranscriptBtn');
const closeAppBtn = document.getElementById('closeAppBtn');
const openHotkeySettingsBtn = document.getElementById('openHotkeySettingsBtn');
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
const modeHotkeyStatusText = document.getElementById('modeHotkeyStatus');
const modeSuffixInput = document.getElementById('modeSuffixInput');
const {
  formatHotkeyForDisplay,
  getHotkeyCaptureFromEvent
} = window.hotkeyHelpers;
const {
  getSortedPromptModes
} = window.promptModeHelpers;
const setProtectedTooltip = window.protectedTooltips?.setTooltip || (() => {});

const tabs = new Map();
let activeTabId = null;
let lastCaptionPayloadVersion = null;
let transcriptSourceStatusKind = '';
let transcriptSourceLifecycle = null;
let isUserScrolling = false;
let scrollTimeout = null;
let hasNewTranscriptBelow = false;
let liveCaptionsWindowVisible = true;
let translationsVisible = false;
let translationEnabled = false;
let transcriptSource = 'live-captions';
let hasDeepgramApiKey = false;
let deepgramCaptureActive = false;
let deepgramRemainingText = 'Remaining unavailable';
let deepgramUsageLastRequestedAtMs = 0;
let deepgramUsageRefreshInFlight = null;
let currentPanelSplitRatio = 0.4;
let isModePanelCollapsed = true;
let promptModes = [];
let selectedPromptModeId = null;
let isModeDropdownOpen = false;
let activeModeDropdownToggle = null;
let modeDropdownOpenRequestId = 0;
let isModeEditorDirty = false;
let editingPromptModeId = null;
let modeDropdownRenderSignature = '';
let modeDropdownCloseTimer = null;
let deferredModeDropdownRenderPending = false;
let modeHotkeyDisplayOverride = null;
let modeHotkeyFeedbackTimer = null;
let promptModeDraftRevision = 0;
const promptModeDraftSessionId = `prompt-draft-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
const pendingPromptModeDraftUpdates = new Set();
let latestPromptModeDraft = null;
let promptModePersistenceStatus = {
  state: 'saved',
  dirty: false,
  message: '',
  revision: 0
};
let promptModePersistenceStatusElement = null;
let promptModeStateSyncRequest = Promise.resolve();
let panelResizeState = null;
let panelRatioSyncFrame = null;
let pendingPanelRatioToSync = null;

const PANEL_DIVIDER_WIDTH = 10;
const PANEL_KEYBOARD_RESIZE_STEP_PX = 10;
const MIN_TRANSCRIPT_PANEL_WIDTH = 280;
const MIN_BROWSER_PANEL_WIDTH = 220;
const COMPACT_TRANSLATION_HOVER_MAX_WIDTH = 360;
const MODE_HOTKEY_FEEDBACK_RESET_DELAY_MS = 1400;
const MODE_RENAME_DOUBLE_CLICK_WINDOW_MS = 260;
const DEEPGRAM_USAGE_REFRESH_INTERVAL_MS = 60_000;
const {
  TRANSCRIPT_SPEAKER_TAG,
  formatTranscriptEntryMarker,
  normalizeTranscriptSpeakerTag,
  shouldIncludeTranscriptSpeaker
} = window.transcriptPrompt;
const TRANSCRIPT_SOURCE_DEEPGRAM = 'deepgram';
const TRANSCRIPT_SOURCE_LIVE_CAPTIONS = 'live-captions';
const DEEPGRAM_ROLE_ME = 'Me';
const createTranscriptDisplayGroups = typeof window.transcriptDisplayGroups?.createTranscriptDisplayGroups === 'function'
  ? window.transcriptDisplayGroups.createTranscriptDisplayGroups
  : (entries) => entries;

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

function isTabCloseControl(target) {
  return Boolean(target && typeof target.closest === 'function' && target.closest('.tab-close'));
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
  setProtectedTooltip(close, `Close ${tabData.title || 'tab'}`);
  close.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    closeTab(tabData.id);
  });
  close.addEventListener('keydown', (event) => {
    event.stopPropagation();
  });

  tab.appendChild(title);
  tab.appendChild(close);
  tab.onclick = (event) => {
    if (isTabCloseControl(event.target)) {
      return;
    }

    switchTab(tabData.id);
  };
  tab.onkeydown = (event) => {
    if (isTabCloseControl(event.target)) {
      return;
    }

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
      setProtectedTooltip(closeButton, `Close ${updates.title || 'tab'}`);
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

  applyAppPreferences(snapshot);

  if (Number.isFinite(snapshot.panelSplitRatio)) {
    applyPanelSplitRatio(snapshot.panelSplitRatio);
  }

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

function setNewTranscriptIndicatorVisible(isVisible) {
  hasNewTranscriptBelow = Boolean(isVisible);

  if (newTranscriptIndicator) {
    newTranscriptIndicator.classList.toggle('is-visible', hasNewTranscriptBelow);
    newTranscriptIndicator.setAttribute('aria-hidden', String(!hasNewTranscriptBelow));
    newTranscriptIndicator.tabIndex = hasNewTranscriptBelow ? 0 : -1;
  }

  if (transcriptEl) {
    transcriptEl.classList.toggle('has-new-transcript-below', hasNewTranscriptBelow);
  }
}

function scrollTranscriptToBottom() {
  if (!transcriptEl) {
    return;
  }

  transcriptEl.scrollTop = transcriptEl.scrollHeight;
  setNewTranscriptIndicatorVisible(false);
}

function normalizeTranscriptEntries(data) {
  if (Array.isArray(data?.entries)) {
    return data.entries
      .filter((entry) => entry && typeof entry.sourceText === 'string' && entry.sourceText.trim())
      .map((entry, index) => {
        const status = ['pending', 'translated', 'error', 'disabled'].includes(entry.status)
          ? entry.status
          : 'pending';

        return {
          id: typeof entry.id === 'string' && entry.id ? entry.id : `caption-${index}`,
          sourceText: entry.sourceText,
          translatedText: typeof entry.translatedText === 'string' ? entry.translatedText : '',
          status,
          isFinal: Boolean(entry.isFinal),
          isSubmitted: Boolean(entry.isSubmitted),
          submittedSourceText: typeof entry.submittedSourceText === 'string' ? entry.submittedSourceText : '',
          speakerTag: normalizeTranscriptSpeakerTag(entry.speakerTag)
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
    isFinal: false,
    isSubmitted: false,
    speakerTag: TRANSCRIPT_SPEAKER_TAG
  }];
}

function normalizeTranscriptSource(source) {
  return source === TRANSCRIPT_SOURCE_DEEPGRAM
    ? TRANSCRIPT_SOURCE_DEEPGRAM
    : TRANSCRIPT_SOURCE_LIVE_CAPTIONS;
}

function getTranscriptSpeakerRoleClass(entry) {
  return normalizeTranscriptSpeakerTag(entry?.speakerTag) === DEEPGRAM_ROLE_ME
    ? 'transcript-row-role-me'
    : 'transcript-row-role-them';
}

function getTranscriptMarkerSignature(entry, options = {}) {
  return JSON.stringify({
    speakerTag: entry.speakerTag,
    includeSpeaker: Boolean(options.includeSpeaker)
  });
}

function normalizeTranscriptSourceSegments(entry) {
  const sourceText = String(entry?.sourceText || '');
  if (!sourceText) {
    return [];
  }

  if (Array.isArray(entry?.sourceSegments)) {
    const sourceSegments = entry.sourceSegments
      .map((segment) => ({
        text: typeof segment?.text === 'string' ? segment.text : '',
        isSubmitted: Boolean(segment?.isSubmitted)
      }))
      .filter((segment) => segment.text);

    if (sourceSegments.length > 0) {
      return sourceSegments;
    }
  }

  const submittedSourceText = typeof entry?.submittedSourceText === 'string'
    ? entry.submittedSourceText
    : '';

  if (entry?.isSubmitted || submittedSourceText === sourceText) {
    return [{ text: sourceText, isSubmitted: true }];
  }

  if (submittedSourceText && sourceText.startsWith(submittedSourceText)) {
    const remainderText = sourceText.slice(submittedSourceText.length);
    const sourceSegments = [{ text: submittedSourceText, isSubmitted: true }];

    if (remainderText) {
      sourceSegments.push({ text: remainderText, isSubmitted: false });
    }

    return sourceSegments;
  }

  return [{ text: sourceText, isSubmitted: false }];
}

function getTranscriptSourceSignature(entry) {
  return JSON.stringify({
    sourceText: String(entry?.sourceText || ''),
    sourceSegments: normalizeTranscriptSourceSegments(entry)
  });
}

function getTranscriptTranslationSignature(entry) {
  return JSON.stringify({
    translatedText: entry.translatedText,
    status: entry.status
  });
}

function hasVisibleTranscriptTranslation(entry) {
  if (entry?.status === 'disabled') {
    return false;
  }

  return entry?.status === 'pending'
    || (typeof entry?.translatedText === 'string' && Boolean(entry.translatedText.trim()));
}

function isCompactTranslationHoverMode() {
  if (!transcriptEl) {
    return false;
  }

  return transcriptEl.getBoundingClientRect().width <= COMPACT_TRANSLATION_HOVER_MAX_WIDTH;
}

function shouldLockTranscriptRowHoverHeight(row) {
  return Boolean(
    row
    && transcriptEl
    && transcriptEl.classList.contains('is-live-captions-source')
    && !transcriptEl.classList.contains('is-translation-hidden')
    && !transcriptEl.classList.contains('is-translation-disabled')
    && row.classList.contains('is-partial')
    && row.classList.contains('has-translation')
    && isCompactTranslationHoverMode()
  );
}

function lockTranscriptRowHoverHeight(row) {
  if (!shouldLockTranscriptRowHoverHeight(row) || row.classList.contains('is-hover-height-locked')) {
    return;
  }

  const height = Math.ceil(row.getBoundingClientRect().height);
  if (height <= 0) {
    return;
  }

  row.style.setProperty('--transcript-hover-lock-height', `${height}px`);
  row.classList.add('is-hover-height-locked');
}

function unlockTranscriptRowHoverHeight(row) {
  if (!row) {
    return;
  }

  row.classList.remove('is-hover-height-locked');
  row.style.removeProperty('--transcript-hover-lock-height');
}

function reconcileTranscriptRowHoverHeightLock(row) {
  if (row?.classList.contains('is-hover-height-locked') && !shouldLockTranscriptRowHoverHeight(row)) {
    unlockTranscriptRowHoverHeight(row);
  }
}

function clearTranscriptHoverHeightLocks() {
  if (!transcriptRowsEl) {
    return;
  }

  for (const row of transcriptRowsEl.querySelectorAll('.transcript-row.is-hover-height-locked')) {
    unlockTranscriptRowHoverHeight(row);
  }
}

function getTranscriptRowAriaLabel(entry) {
  const speaker = normalizeTranscriptSpeakerTag(entry?.speakerTag);
  return entry?.isFinal
    ? `${speaker} transcript entry`
    : `${speaker} live transcript entry`;
}

function updateTranscriptMarker(marker, entry, options = {}) {
  const signature = getTranscriptMarkerSignature(entry, options);
  if (marker.dataset.markerSignature === signature) {
    return;
  }

  marker.dataset.markerSignature = signature;
  const markerText = formatTranscriptEntryMarker(entry, options);
  marker.textContent = markerText;
  marker.hidden = !markerText;
}

function updateTranscriptHeaderVisibility(row) {
  const header = row.querySelector('.transcript-entry-header');
  if (!header) {
    return;
  }

  const marker = header.querySelector('.transcript-entry-marker');
  header.hidden = Boolean(marker?.hidden);
}

function updateTranscriptSourceCell(sourceCell, entry) {
  const signature = getTranscriptSourceSignature(entry);
  if (sourceCell.dataset.sourceSignature === signature) {
    return;
  }

  sourceCell.dataset.sourceSignature = signature;
  const sourceText = document.createElement('span');
  sourceText.className = 'transcript-entry-text';
  const sourceSegments = normalizeTranscriptSourceSegments(entry);

  if (sourceSegments.length === 0) {
    sourceText.textContent = entry.sourceText;
  } else {
    for (const segment of sourceSegments) {
      const segmentEl = document.createElement('span');
      segmentEl.className = [
        'transcript-entry-segment',
        segment.isSubmitted ? 'is-submitted-segment' : ''
      ].filter(Boolean).join(' ');
      segmentEl.textContent = segment.text;
      sourceText.append(segmentEl);
    }
  }

  sourceCell.replaceChildren(sourceText);
}

function updateTranscriptTranslationCell(translatedCell, entry) {
  const signature = getTranscriptTranslationSignature(entry);
  if (translatedCell.dataset.translationSignature === signature) {
    return;
  }

  translatedCell.dataset.translationSignature = signature;
  translatedCell.className = 'transcript-cell transcript-cell-translation';

  if (entry.status === 'disabled') {
    translatedCell.classList.add('is-placeholder');
    translatedCell.textContent = '';
  } else if (entry.status === 'pending' && !entry.translatedText) {
    translatedCell.classList.add('is-placeholder');
    translatedCell.textContent = 'Translating...';
  } else {
    translatedCell.textContent = entry.translatedText;
  }

  if (entry.status === 'pending' && entry.translatedText) {
    translatedCell.classList.add('is-refreshing');
  }
}

function createTranscriptRow(entry, index = 0, previousEntry = null) {
  const row = document.createElement('div');
  row.dataset.captionId = entry.id;
  row.setAttribute('role', 'article');
  row.addEventListener('pointerenter', () => lockTranscriptRowHoverHeight(row));
  row.addEventListener('pointerleave', () => unlockTranscriptRowHoverHeight(row));
  row.addEventListener('focusin', () => lockTranscriptRowHoverHeight(row));
  row.addEventListener('focusout', () => unlockTranscriptRowHoverHeight(row));

  const header = document.createElement('div');
  header.className = 'transcript-entry-header';

  const marker = document.createElement('span');
  marker.className = 'transcript-entry-marker';

  header.append(marker);

  const body = document.createElement('div');
  body.className = 'transcript-entry-body';

  const sourceCell = document.createElement('div');
  sourceCell.className = 'transcript-cell transcript-cell-source';

  const translatedCell = document.createElement('div');
  translatedCell.className = 'transcript-cell transcript-cell-translation';

  body.append(sourceCell, translatedCell);
  row.append(header, body);
  updateTranscriptRow(row, entry, index, previousEntry);
  return row;
}

function updateTranscriptRow(row, entry, index = 0, previousEntry = null) {
  const markerOptions = {
    includeSpeaker: shouldIncludeTranscriptSpeaker(entry, index, previousEntry)
  };

  const rowClassName = [
    'transcript-row',
    `transcript-row-${entry.status}`,
    getTranscriptSpeakerRoleClass(entry),
    markerOptions.includeSpeaker ? 'is-speaker-start' : '',
    hasVisibleTranscriptTranslation(entry) ? 'has-translation' : '',
    entry.isSubmitted ? 'is-submitted' : '',
    entry.isFinal ? '' : 'is-partial',
    row.classList.contains('is-hover-height-locked') ? 'is-hover-height-locked' : ''
  ].filter(Boolean).join(' ');

  if (row.className !== rowClassName) {
    row.className = rowClassName;
  }
  row.setAttribute('aria-label', getTranscriptRowAriaLabel(entry));

  const marker = row.querySelector('.transcript-entry-marker');
  if (marker) {
    updateTranscriptMarker(marker, entry, markerOptions);
  }

  updateTranscriptHeaderVisibility(row);

  const sourceCell = row.querySelector('.transcript-cell-source');
  if (sourceCell) {
    updateTranscriptSourceCell(sourceCell, entry);
  }

  reconcileTranscriptRowHoverHeightLock(row);

  const translatedCell = row.querySelector('.transcript-cell-translation');
  if (!translatedCell) {
    return;
  }

  updateTranscriptTranslationCell(translatedCell, entry);
}

function renderTranscriptEntries(entries) {
  if (!transcriptEl) {
    return;
  }

  const displayEntries = createTranscriptDisplayGroups(entries);

  if (!transcriptRowsEl) {
    transcriptEl.textContent = displayEntries
      .map((entry, index) => {
        const marker = formatTranscriptEntryMarker(entry, {
          includeSpeaker: shouldIncludeTranscriptSpeaker(entry, index, displayEntries[index - 1])
        });
        return marker ? `${marker}\n${entry.sourceText}` : entry.sourceText;
      })
      .join('\n\n');
    updateTranscriptEmptyState(displayEntries);
    return;
  }

  for (const nonCaptionRow of transcriptRowsEl.querySelectorAll('.transcript-row:not([data-caption-id])')) {
    nonCaptionRow.remove();
  }

  const existingRows = new Map();
  for (const row of transcriptRowsEl.querySelectorAll('.transcript-row[data-caption-id]')) {
    existingRows.set(row.dataset.captionId, row);
  }

  let expectedNextRow = transcriptRowsEl.firstElementChild;

  for (let index = 0; index < displayEntries.length; index += 1) {
    const entry = displayEntries[index];
    const previousEntry = displayEntries[index - 1] || null;
    const row = existingRows.get(entry.id) || createTranscriptRow(entry, index, previousEntry);
    updateTranscriptRow(row, entry, index, previousEntry);
    existingRows.delete(entry.id);

    if (row !== expectedNextRow) {
      transcriptRowsEl.insertBefore(row, expectedNextRow);
    }

    expectedNextRow = row.nextElementSibling;
  }

  for (const staleRow of existingRows.values()) {
    staleRow.remove();
  }

  updateTranscriptEmptyState(displayEntries);
}

function setTranslationVisibility(isVisible) {
  translationsVisible = Boolean(isVisible);

  if (transcriptEl) {
    transcriptEl.classList.toggle('is-translation-hidden', !translationsVisible);
  }

  if (!translationsVisible) {
    clearTranscriptHoverHeightLocks();
  }

  updateTranslationToggleButtonState();
}

function updateTranslationToggleButtonState() {
  if (toggleTranslationBtn) {
    toggleTranslationBtn.disabled = !translationEnabled;
    toggleTranslationBtn.setAttribute('aria-disabled', String(!translationEnabled));
    toggleTranslationBtn.classList.toggle('is-translation-disabled', !translationEnabled);

    if (!translationEnabled) {
      toggleTranslationBtn.classList.add('is-hidden-state');
      setProtectedTooltip(toggleTranslationBtn, 'Enable translation in settings');
      toggleTranslationBtn.setAttribute('aria-label', 'Enable translation in settings');
      toggleTranslationBtn.setAttribute('aria-pressed', 'false');
      return;
    }

    toggleTranslationBtn.classList.toggle('is-hidden-state', !translationsVisible);
    setProtectedTooltip(toggleTranslationBtn, translationsVisible ? 'Hide translations' : 'Show translations');
    toggleTranslationBtn.setAttribute(
      'aria-label',
      translationsVisible ? 'Hide translations' : 'Show translations'
    );
    toggleTranslationBtn.setAttribute('aria-pressed', String(translationsVisible));
  }
}

function setTranslationEnabled(isEnabled) {
  translationEnabled = Boolean(isEnabled);

  if (transcriptEl) {
    transcriptEl.classList.toggle('is-translation-disabled', !translationEnabled);
  }

  if (!translationEnabled) {
    clearTranscriptHoverHeightLocks();
  }

  updateTranslationToggleButtonState();
}

function getCurrentTranscriptLifecyclePhase() {
  if (!transcriptSourceLifecycle || transcriptSourceLifecycle.source !== transcriptSource) {
    return '';
  }

  return transcriptSourceLifecycle.phase;
}

function updateTranscriptHeaderLayout() {
  if (!transcriptHeader) {
    return;
  }

  const isDeepgramSource = transcriptSource === TRANSCRIPT_SOURCE_DEEPGRAM;
  if (isDeepgramSource) {
    clearTranscriptHoverHeightLocks();
  }

  transcriptHeader.classList.toggle('is-deepgram-source', isDeepgramSource);
  transcriptHeader.classList.toggle('is-live-captions-source', !isDeepgramSource);

  if (transcriptEl) {
    transcriptEl.classList.toggle('is-deepgram-source', isDeepgramSource);
    transcriptEl.classList.toggle('is-live-captions-source', !isDeepgramSource);
  }
}

function updateTranscriptSourcePill() {
  updateTranscriptHeaderLayout();

  if (!transcriptSourcePill) {
    return;
  }

  const phase = getCurrentTranscriptLifecyclePhase();
  let label;

  if (transcriptSource === TRANSCRIPT_SOURCE_DEEPGRAM) {
    if (!hasDeepgramApiKey) {
      label = 'Deepgram - API key needed';
    } else if (deepgramCaptureActive) {
      label = 'Deepgram - Recording';
    } else if (phase === 'connecting') {
      label = 'Deepgram - Connecting';
    } else if (phase === 'reconnecting') {
      label = 'Deepgram - Reconnecting';
    } else if (phase === 'stopping') {
      label = 'Deepgram - Stopping';
    } else if (phase === 'error') {
      label = 'Deepgram - Needs attention';
    } else {
      label = 'Deepgram - Ready';
    }
  } else if (phase === 'connecting') {
    label = 'Live Captions - Connecting';
  } else if (phase === 'reconnecting') {
    label = 'Live Captions - Reconnecting';
  } else if (phase === 'stopping') {
    label = 'Live Captions - Stopping';
  } else if (phase === 'error') {
    label = 'Live Captions - Needs attention';
  } else if (phase === 'active') {
    label = 'Live Captions - Listening';
  } else {
    label = 'Live Captions - Waiting';
  }

  transcriptSourcePill.textContent = label;
}

function getTranscriptEmptyStateContent() {
  if (transcriptSource === TRANSCRIPT_SOURCE_DEEPGRAM) {
    if (!hasDeepgramApiKey) {
      return {
        title: 'Deepgram needs an API key',
        copy: 'Add a Deepgram API key in settings to use transcription.'
      };
    }

    if (deepgramCaptureActive) {
      return {
        title: 'Listening for transcript...',
        copy: 'Deepgram transcript will appear here when audio is detected.'
      };
    }

    return {
      title: 'Deepgram is ready',
      copy: 'Start Deepgram transcription to capture audio.'
    };
  }

  return {
    title: 'Listening for transcript...',
    copy: 'Live Captions will appear here when speech is detected.'
  };
}

function updateTranscriptEmptyState(entries) {
  if (!transcriptEl || !transcriptEmptyState) {
    return;
  }

  const hasTranscriptContent = Array.isArray(entries)
    ? entries.some((entry) => typeof entry?.sourceText === 'string' && entry.sourceText.trim())
    : Boolean(transcriptRowsEl?.querySelector('.transcript-row[data-caption-id]'));
  const emptyStateContent = getTranscriptEmptyStateContent();

  transcriptEl.classList.toggle('has-transcript-content', hasTranscriptContent);
  if (transcriptEmptyTitle) {
    transcriptEmptyTitle.textContent = emptyStateContent.title;
  }
  if (transcriptEmptyCopy) {
    transcriptEmptyCopy.textContent = emptyStateContent.copy;
  }
}

function getDeepgramRecorderMimeType() {
  if (typeof MediaRecorder !== 'function' || typeof MediaRecorder.isTypeSupported !== 'function') {
    return '';
  }

  return [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/ogg;codecs=opus'
  ].find((mimeType) => MediaRecorder.isTypeSupported(mimeType)) || '';
}

const deepgramCaptureController = new window.deepgramCaptureController.DeepgramCaptureController({
  mediaDevices: navigator.mediaDevices,
  MediaRecorderImpl: typeof MediaRecorder === 'function' ? MediaRecorder : null,
  MediaStreamImpl: typeof MediaStream === 'function' ? MediaStream : null,
  recorderMimeType: getDeepgramRecorderMimeType(),
  sendAudioChunk: async (role, chunk) => {
    window.electronAPI?.sendDeepgramAudioChunk?.({ role, chunk });
  },
  onFailure: async (error) => {
    console.error('[ERROR] Deepgram capture failed:', error);
    await window.electronAPI?.stopDeepgramTranscription?.();
  }
});

async function stopDeepgramCapture() {
  return deepgramCaptureController.stop();
}

async function startDeepgramCapture() {
  try {
    return await deepgramCaptureController.start();
  } catch (error) {
    console.error('[ERROR] Failed to start Deepgram capture:', error);
    return false;
  }
}

function updateTranscriptSourceUi() {
  updateTranscriptSourceControlButton();
  updateTranscriptSourcePill();
  updateTranscriptEmptyState();
}

function updateDeepgramUsageStatus(usage = {}) {
  if (usage && typeof usage === 'object') {
    if (usage.active !== undefined) {
      deepgramCaptureActive = Boolean(usage.active);
    }

    if (typeof usage.remainingText === 'string' && usage.remainingText.trim()) {
      deepgramRemainingText = usage.remainingText;
    }
  }

  const isDeepgramSource = transcriptSource === TRANSCRIPT_SOURCE_DEEPGRAM;
  if (deepgramUsageStatus) {
    deepgramUsageStatus.hidden = !isDeepgramSource;
  }

  if (deepgramRemainingUsageValue) {
    deepgramRemainingUsageValue.textContent = deepgramRemainingText;
  }

  updateTranscriptSourceUi();
}

function syncDeepgramCaptureFromPreferences() {
  if (transcriptSource !== TRANSCRIPT_SOURCE_DEEPGRAM || !hasDeepgramApiKey) {
    deepgramCaptureActive = false;
    stopDeepgramCapture();
  }

  updateDeepgramUsageStatus();
}

function applyDeepgramCaptureState(state = {}) {
  deepgramCaptureActive = Boolean(state?.active);
  updateDeepgramUsageStatus(state);
}

function refreshDeepgramUsageStatus() {
  if (
    transcriptSource !== TRANSCRIPT_SOURCE_DEEPGRAM
    || !hasDeepgramApiKey
    || !window.electronAPI?.refreshDeepgramUsage
  ) {
    return;
  }

  const msSinceLastRequest = Date.now() - deepgramUsageLastRequestedAtMs;
  if (
    deepgramUsageRefreshInFlight
    || (deepgramUsageLastRequestedAtMs > 0 && msSinceLastRequest < DEEPGRAM_USAGE_REFRESH_INTERVAL_MS)
  ) {
    return;
  }

  deepgramUsageLastRequestedAtMs = Date.now();
  deepgramUsageRefreshInFlight = window.electronAPI.refreshDeepgramUsage()
    .then((usage) => {
      updateDeepgramUsageStatus(usage);
    })
    .catch((error) => {
      console.error('[ERROR] Failed to refresh Deepgram usage:', error);
    })
    .finally(() => {
      deepgramUsageRefreshInFlight = null;
    });
}

function getTranscriptSourceLabel(source) {
  return source === TRANSCRIPT_SOURCE_DEEPGRAM ? 'Deepgram' : 'Live Captions';
}

function normalizeCaptionErrorPayload(error) {
  const source = error?.source === TRANSCRIPT_SOURCE_DEEPGRAM
    ? TRANSCRIPT_SOURCE_DEEPGRAM
    : TRANSCRIPT_SOURCE_LIVE_CAPTIONS;
  const message = typeof error?.message === 'string' && error.message
    ? error.message
    : (typeof error === 'string' && error ? error : 'Transcript source error.');

  return {
    source,
    code: typeof error?.code === 'string' ? error.code : 'TRANSCRIPT_ERROR',
    message,
    recoverable: typeof error?.recoverable === 'boolean' ? error.recoverable : true
  };
}

function setTranscriptSourceStatus(message, { kind = 'lifecycle' } = {}) {
  if (!transcriptSourceStatus) {
    return;
  }

  transcriptSourceStatus.textContent = message;
  transcriptSourceStatus.hidden = !message;
  transcriptSourceStatus.classList.toggle('is-error', kind === 'error');
  transcriptSourceStatus.classList.toggle('is-recovering', kind === 'lifecycle');
  transcriptSourceStatusKind = message ? kind : '';
}

function clearTranscriptSourceStatus({ lifecycleOnly = false } = {}) {
  if (lifecycleOnly && transcriptSourceStatusKind !== 'lifecycle') {
    return;
  }

  setTranscriptSourceStatus('', { kind: '' });
}

function showCaptionErrorStatus(error) {
  const normalizedError = normalizeCaptionErrorPayload(error);
  const errorText = normalizedError.message;
  const isMissingNativeAddon =
    errorText.includes('Live Captions native addon was not found')
    || errorText.includes('livecaptions_native.node')
    || errorText.includes('Cannot find module');
  const sourceLabel = getTranscriptSourceLabel(normalizedError.source);
  const recoveryText = normalizedError.recoverable
    ? ' You can retry without clearing the transcript.'
    : '';
  const supportText = isMissingNativeAddon
    ? ' This build is missing the Live Captions native addon. Run "npm run build-native" and package the app again.'
    : '';

  setTranscriptSourceStatus(
    `${sourceLabel}: ${errorText}${supportText}${recoveryText}`,
    { kind: 'error' }
  );
}

function applyTranscriptSourceLifecycle(state = {}) {
  if (!state || typeof state !== 'object') {
    return;
  }

  const source = state.source === TRANSCRIPT_SOURCE_DEEPGRAM
    ? TRANSCRIPT_SOURCE_DEEPGRAM
    : TRANSCRIPT_SOURCE_LIVE_CAPTIONS;
  const phase = typeof state.phase === 'string' ? state.phase : 'inactive';
  const allowedPhases = new Set([
    'inactive',
    'connecting',
    'active',
    'reconnecting',
    'stopping',
    'error'
  ]);
  if (!allowedPhases.has(phase)) {
    return;
  }

  transcriptSourceLifecycle = {
    source,
    phase,
    sessionId: typeof state.sessionId === 'string' ? state.sessionId : '',
    retryAttempt: Number.isSafeInteger(state.retryAttempt) ? state.retryAttempt : 0
  };

  if (source !== transcriptSource) {
    return;
  }

  updateTranscriptSourcePill();
  updateTranscriptEmptyState();

  const sourceLabel = getTranscriptSourceLabel(source);
  if (phase === 'error') {
    showCaptionErrorStatus({
      source,
      code: typeof state.reason === 'string' ? state.reason : 'SOURCE_ERROR',
      message: typeof state.error === 'string' && state.error
        ? state.error
        : `${sourceLabel} could not continue.`,
      recoverable: true
    });
    return;
  }

  if (phase === 'connecting' || phase === 'reconnecting' || phase === 'stopping') {
    const action = phase === 'connecting'
      ? 'is connecting'
      : (phase === 'reconnecting' ? 'is reconnecting' : 'is stopping');
    const retryText = phase === 'reconnecting' && transcriptSourceLifecycle.retryAttempt > 0
      ? ` (retry ${transcriptSourceLifecycle.retryAttempt})`
      : '';
    setTranscriptSourceStatus(`${sourceLabel} ${action}${retryText}.`, { kind: 'lifecycle' });
    return;
  }

  clearTranscriptSourceStatus({ lifecycleOnly: true });
}

function setCurrentSplitRatio(ratio) {
  if (!Number.isFinite(ratio)) {
    return;
  }

  currentPanelSplitRatio = ratio;
}

function applyAppPreferences(preferences = {}) {
  const previousTranscriptSource = transcriptSource;
  const previousHasDeepgramApiKey = hasDeepgramApiKey;

  if (typeof preferences.translationsVisible === 'boolean') {
    setTranslationVisibility(preferences.translationsVisible);
  }

  if (typeof preferences.translationEnabled === 'boolean') {
    setTranslationEnabled(preferences.translationEnabled);
  }

  if (typeof preferences.liveCaptionsWindowVisible === 'boolean') {
    updateLiveCaptionsToggleButton(preferences.liveCaptionsWindowVisible);
  }

  if (typeof preferences.transcriptSource === 'string') {
    transcriptSource = normalizeTranscriptSource(preferences.transcriptSource);
  }

  if (preferences.transcriptSourceState && typeof preferences.transcriptSourceState === 'object') {
    applyTranscriptSourceLifecycle(preferences.transcriptSourceState);
  }

  if (typeof preferences.hasDeepgramApiKey === 'boolean') {
    hasDeepgramApiKey = preferences.hasDeepgramApiKey;
  }

  if (previousTranscriptSource !== transcriptSource || previousHasDeepgramApiKey !== hasDeepgramApiKey) {
    deepgramUsageLastRequestedAtMs = 0;
  }

  if (preferences.deepgramUsage && typeof preferences.deepgramUsage === 'object') {
    applyDeepgramCaptureState(preferences.deepgramUsage);
  } else {
    syncDeepgramCaptureFromPreferences();
  }

  refreshDeepgramUsageStatus();

  if (Number.isFinite(preferences.horizontalTranscriptPanelRatio)) {
    setCurrentSplitRatio(preferences.horizontalTranscriptPanelRatio);
  }

  if (leftPanel) {
    applyPanelSplitRatio(currentPanelSplitRatio);
  }
}

function getPanelMetrics() {
  if (!browserContainer) {
    return null;
  }

  const adjustableSize = Math.max(
    0,
    browserContainer.clientWidth - PANEL_DIVIDER_WIDTH
  );

  if (adjustableSize <= 0) {
    return {
      adjustableSize: 0,
      minTranscriptSize: 0,
      maxTranscriptSize: 0
    };
  }

  let minTranscriptSize = MIN_TRANSCRIPT_PANEL_WIDTH;
  let minBrowserPanelSize = MIN_BROWSER_PANEL_WIDTH;

  if (adjustableSize < (minTranscriptSize + minBrowserPanelSize)) {
    const fallbackSize = Math.floor(adjustableSize / 2);
    minTranscriptSize = Math.min(minTranscriptSize, fallbackSize);
    minBrowserPanelSize = Math.min(minBrowserPanelSize, Math.max(0, adjustableSize - minTranscriptSize));
  }

  const maxTranscriptSize = Math.max(minTranscriptSize, adjustableSize - minBrowserPanelSize);

  return {
    adjustableSize,
    minTranscriptSize,
    maxTranscriptSize
  };
}

function updatePanelDividerAccessibility() {
  if (!panelDivider) {
    return;
  }

  const metrics = getPanelMetrics();
  if (!metrics || metrics.adjustableSize <= 0) {
    return;
  }

  const transcriptSize = Math.round(metrics.adjustableSize * currentPanelSplitRatio);
  panelDivider.setAttribute('aria-valuemin', String(Math.round(metrics.minTranscriptSize)));
  panelDivider.setAttribute('aria-valuemax', String(Math.round(metrics.maxTranscriptSize)));
  panelDivider.setAttribute('aria-valuenow', String(transcriptSize));
  panelDivider.setAttribute('aria-valuetext', `Transcript panel width ${transcriptSize} pixels`);
}

function clampPanelSplitRatio(ratio) {
  const metrics = getPanelMetrics();
  const nextRatio = Number.isFinite(ratio) ? ratio : currentPanelSplitRatio;

  if (!metrics || metrics.adjustableSize <= 0) {
    return nextRatio;
  }

  const desiredTranscriptSize = metrics.adjustableSize * nextRatio;
  const clampedTranscriptSize = Math.min(
    metrics.maxTranscriptSize,
    Math.max(metrics.minTranscriptSize, desiredTranscriptSize)
  );

  return clampedTranscriptSize / metrics.adjustableSize;
}

function applyPanelSplitRatio(ratio) {
  if (!leftPanel) {
    return;
  }

  clearTranscriptHoverHeightLocks();
  currentPanelSplitRatio = clampPanelSplitRatio(ratio);
  setCurrentSplitRatio(currentPanelSplitRatio);

  const metrics = getPanelMetrics();
  if (!metrics || metrics.adjustableSize <= 0) {
    return;
  }

  const transcriptSize = Math.round(metrics.adjustableSize * currentPanelSplitRatio);
  leftPanel.style.width = `${transcriptSize}px`;
  leftPanel.style.height = '';
  updatePanelDividerAccessibility();
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

function updatePanelSplitFromPointer(clientX) {
  if (!panelResizeState || !browserContainer) {
    return;
  }

  const rect = browserContainer.getBoundingClientRect();
  const metrics = getPanelMetrics();
  if (!metrics || metrics.adjustableSize <= 0) {
    return;
  }

  const rawTranscriptSize = clientX - rect.left - panelResizeState.pointerOffset;
  const ratio = rawTranscriptSize / metrics.adjustableSize;
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
  updatePanelSplitFromPointer(event.clientX);
}

function handlePanelDividerPointerUp(event) {
  event.preventDefault();
  stopPanelResize(event.pointerId);
}

function handlePanelDividerKeydown(event) {
  const metrics = getPanelMetrics();
  if (!metrics || metrics.adjustableSize <= 0) {
    return;
  }

  let nextTranscriptSize = Math.round(metrics.adjustableSize * currentPanelSplitRatio);
  if (event.key === 'ArrowLeft') {
    nextTranscriptSize -= PANEL_KEYBOARD_RESIZE_STEP_PX;
  } else if (event.key === 'ArrowRight') {
    nextTranscriptSize += PANEL_KEYBOARD_RESIZE_STEP_PX;
  } else if (event.key === 'Home') {
    nextTranscriptSize = metrics.minTranscriptSize;
  } else if (event.key === 'End') {
    nextTranscriptSize = metrics.maxTranscriptSize;
  } else {
    return;
  }

  event.preventDefault();
  const nextRatio = nextTranscriptSize / metrics.adjustableSize;
  applyPanelSplitRatio(nextRatio);
  queuePanelSplitRatioSync(currentPanelSplitRatio);
}

function setButtonBusy(button, isBusy) {
  if (!button) {
    return;
  }

  button.disabled = isBusy;
  button.setAttribute('aria-busy', isBusy ? 'true' : 'false');
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

  setProtectedTooltip(modeToggleBtn, actionLabel);
  modeToggleBtn.setAttribute('aria-label', actionLabel);
  modeToggleBtn.setAttribute('aria-expanded', String(!isModePanelCollapsed));
}

function getSelectedPromptMode() {
  return promptModes.find((mode) => mode.id === selectedPromptModeId) || null;
}

function getModeDropdownMenus() {
  return [modeDropdownMenu, collapsedModeDropdownMenu].filter(Boolean);
}

function getModeDropdownRovingItems(menuElement) {
  if (!menuElement) {
    return [];
  }

  return Array.from(menuElement.querySelectorAll('[role="menuitem"]')).filter((item) => (
    !item.classList.contains('mode-dropdown-item-editing') && !item.disabled
  ));
}

function updateModeDropdownRovingTabStop(menuElement, preferredItem = null) {
  const items = getModeDropdownRovingItems(menuElement);
  if (items.length === 0) {
    return;
  }

  const tabStop = items.includes(preferredItem)
    ? preferredItem
    : (items.find((item) => item.classList.contains('is-active')) || items[0]);

  for (const item of items) {
    item.tabIndex = item === tabStop ? 0 : -1;
  }
}

function handleModeDropdownRovingFocus(event) {
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
    return;
  }

  const menuElement = event.currentTarget;
  const currentItem = event.target?.closest?.('[role="menuitem"]');
  const items = getModeDropdownRovingItems(menuElement);
  const currentIndex = items.indexOf(currentItem);
  if (currentIndex === -1) {
    return;
  }

  let nextIndex = currentIndex;
  if (event.key === 'ArrowDown') {
    nextIndex = (currentIndex + 1) % items.length;
  } else if (event.key === 'ArrowUp') {
    nextIndex = (currentIndex - 1 + items.length) % items.length;
  } else if (event.key === 'Home') {
    nextIndex = 0;
  } else if (event.key === 'End') {
    nextIndex = items.length - 1;
  }

  event.preventDefault();
  const nextItem = items[nextIndex];
  updateModeDropdownRovingTabStop(menuElement, nextItem);
  nextItem.focus();
}

function handleModeDropdownFocusIn(event) {
  const currentItem = event.target?.closest?.('[role="menuitem"]');
  if (!currentItem || currentItem.classList.contains('mode-dropdown-item-editing')) {
    return;
  }

  updateModeDropdownRovingTabStop(event.currentTarget, currentItem);
}

function getModeDropdownToggles() {
  return [modeDropdownToggle, collapsedModeDropdownToggle].filter(Boolean);
}

function getModeDropdownContainers() {
  return [modeDropdown, collapsedModeDropdown].filter(Boolean);
}

function getModeMenuAnchor(toggleElement) {
  if (!toggleElement) {
    return null;
  }

  const rect = toggleElement.getBoundingClientRect();
  return {
    x: rect.left,
    y: rect.top,
    width: rect.width,
    height: rect.height
  };
}

function getFallbackModeDropdownToggle() {
  return isModePanelCollapsed
    ? (collapsedModeDropdownToggle || modeDropdownToggle)
    : (modeDropdownToggle || collapsedModeDropdownToggle);
}

async function openModeMenuWindow() {
  const toggleElement = activeModeDropdownToggle || getFallbackModeDropdownToggle();
  const anchor = getModeMenuAnchor(toggleElement);

  if (!anchor || !window.electronAPI?.openModeMenu) {
    return false;
  }

  try {
    return await window.electronAPI.openModeMenu({ anchor });
  } catch (error) {
    console.error('[ERROR] Failed to open Mode menu window:', error);
    return false;
  }
}

function closeModeMenuWindow() {
  if (!window.electronAPI?.closeModeMenu) {
    return;
  }

  window.electronAPI.closeModeMenu().catch((error) => {
    console.error('[ERROR] Failed to close Mode menu window:', error);
  });
}

function clearModeHotkeyFeedbackTimer() {
  if (modeHotkeyFeedbackTimer !== null) {
    window.clearTimeout(modeHotkeyFeedbackTimer);
    modeHotkeyFeedbackTimer = null;
  }
}

function setModeHotkeyStatus(status, message = '') {
  if (modeHotkeyInput) {
    modeHotkeyInput.classList.toggle('is-success', status === 'success');
    modeHotkeyInput.classList.toggle('is-error', status === 'error');
    modeHotkeyInput.setAttribute('aria-invalid', status === 'error' ? 'true' : 'false');
  }

  if (!modeHotkeyStatusText) {
    return;
  }

  const defaultMessage = status === 'success'
    ? 'Global hotkey saved.'
    : (status === 'error'
      ? 'Unable to save that global hotkey. Try another shortcut.'
      : 'Press a shortcut to set a global hotkey.');
  modeHotkeyStatusText.textContent = message || defaultMessage;
  modeHotkeyStatusText.classList.toggle('is-success', status === 'success');
  modeHotkeyStatusText.classList.toggle('is-error', status === 'error');
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
  setModeHotkeyStatus(
    'error',
    displayValue
      ? `${displayValue} could not be used as a global hotkey. Try another shortcut.`
      : 'Unable to save that global hotkey. Try another shortcut.'
  );
  updateModeHotkeyInput();

  modeHotkeyFeedbackTimer = window.setTimeout(() => {
    modeHotkeyFeedbackTimer = null;
    modeHotkeyDisplayOverride = null;
    setModeHotkeyStatus('idle');
    updateModeHotkeyInput();
  }, MODE_HOTKEY_FEEDBACK_RESET_DELAY_MS);
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
      modeHotkeyFeedbackTimer = window.setTimeout(() => {
        modeHotkeyFeedbackTimer = null;
        setModeHotkeyStatus('idle');
      }, MODE_HOTKEY_FEEDBACK_RESET_DELAY_MS);
      return;
    }
  } catch (error) {
    console.error('[ERROR] Failed to update prompt mode hotkey:', error);
  }

  showModeHotkeyFailure(displayValue);
}

function getActiveModeDropdownMenu() {
  if (activeModeDropdownToggle === collapsedModeDropdownToggle) {
    return collapsedModeDropdownMenu || modeDropdownMenu;
  }

  return modeDropdownMenu || collapsedModeDropdownMenu;
}

function setInlineModeDropdownFallbackVisible(isVisible) {
  const activeMenu = getActiveModeDropdownMenu();

  modePanel?.classList.toggle('is-inline-menu-open', Boolean(isVisible));

  for (const dropdownMenu of getModeDropdownMenus()) {
    dropdownMenu.hidden = !(isVisible && dropdownMenu === activeMenu);
  }
}

function isModeDropdownRenderDeferredForRename() {
  return modeDropdownCloseTimer !== null;
}

function flushDeferredModeDropdownRender() {
  if (!deferredModeDropdownRenderPending) {
    return;
  }

  deferredModeDropdownRenderPending = false;
  renderModeDropdownMenu();
}

function cancelPendingModeDropdownClose() {
  if (modeDropdownCloseTimer === null) {
    return;
  }

  window.clearTimeout(modeDropdownCloseTimer);
  modeDropdownCloseTimer = null;
}

function scheduleModeDropdownCloseAfterRenameWindow() {
  cancelPendingModeDropdownClose();
  modeDropdownCloseTimer = window.setTimeout(() => {
    modeDropdownCloseTimer = null;
    setModeDropdownOpen(false);
    flushDeferredModeDropdownRender();
  }, MODE_RENAME_DOUBLE_CLICK_WINDOW_MS);
}

async function setModeDropdownOpen(isOpen, options = {}) {
  if (getModeDropdownMenus().length === 0 || getModeDropdownToggles().length === 0) {
    return false;
  }

  const requestId = ++modeDropdownOpenRequestId;
  isModeDropdownOpen = Boolean(isOpen);
  if (!isModeDropdownOpen) {
    cancelPendingModeDropdownClose();
    editingPromptModeId = null;
    setInlineModeDropdownFallbackVisible(false);
    activeModeDropdownToggle = null;
    flushDeferredModeDropdownRender();
  }

  for (const dropdownContainer of getModeDropdownContainers()) {
    dropdownContainer.classList.toggle('is-open', isModeDropdownOpen);
  }

  for (const dropdownToggle of getModeDropdownToggles()) {
    dropdownToggle.setAttribute('aria-expanded', String(isModeDropdownOpen));
  }

  for (const dropdownMenu of getModeDropdownMenus()) {
    dropdownMenu.hidden = true;
  }

  if (options.syncMenu === false) {
    return true;
  }

  if (isModeDropdownOpen) {
    const opened = await openModeMenuWindow();
    if (requestId !== modeDropdownOpenRequestId || !isModeDropdownOpen) {
      return opened;
    }

    if (!opened) {
      setInlineModeDropdownFallbackVisible(true);
      return false;
    }

    setInlineModeDropdownFallbackVisible(false);
    return true;
  } else {
    closeModeMenuWindow();
    return true;
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

function ensurePromptModePersistenceStatusElement() {
  if (promptModePersistenceStatusElement || !modeSuffixInput) {
    return promptModePersistenceStatusElement;
  }

  const statusElement = document.createElement('p');
  statusElement.id = 'promptModePersistenceStatus';
  statusElement.className = 'mode-persistence-status';
  statusElement.setAttribute('role', 'status');
  statusElement.setAttribute('aria-live', 'polite');
  statusElement.setAttribute('aria-atomic', 'true');
  const editorPane = modeSuffixInput.closest('.mode-editor-pane') || modeSuffixInput.parentElement;
  editorPane?.appendChild(statusElement);

  const existingDescription = modeSuffixInput.getAttribute('aria-describedby') || '';
  const descriptionIds = new Set(existingDescription.split(/\s+/).filter(Boolean));
  descriptionIds.add(statusElement.id);
  modeSuffixInput.setAttribute('aria-describedby', Array.from(descriptionIds).join(' '));
  promptModePersistenceStatusElement = statusElement;
  return promptModePersistenceStatusElement;
}

function getPromptModePersistenceStatusMessage(status) {
  if (status.state === 'error') {
    const detail = status.message ? ` ${status.message}` : '';
    return `Prompt save failed. Your draft is still kept in memory.${detail}`;
  }

  if (status.dirty || status.state === 'dirty' || status.state === 'saving') {
    return 'Saving prompt…';
  }

  return 'Prompt saved.';
}

function updatePromptModePersistenceStatus(status) {
  if (!status || typeof status !== 'object') {
    return;
  }

  promptModePersistenceStatus = {
    state: typeof status.state === 'string' ? status.state : 'saved',
    dirty: Boolean(status.dirty),
    message: typeof status.message === 'string' ? status.message : '',
    revision: Number.isSafeInteger(status.revision) ? status.revision : 0
  };

  const statusElement = ensurePromptModePersistenceStatusElement();
  if (!statusElement) {
    return;
  }

  statusElement.textContent = getPromptModePersistenceStatusMessage(promptModePersistenceStatus);
  statusElement.classList.toggle('is-error', promptModePersistenceStatus.state === 'error');
  statusElement.classList.toggle('is-saving', promptModePersistenceStatus.dirty);
}

function reportPromptModeDraftFailure(error) {
  const message = error instanceof Error && error.message
    ? error.message
    : 'The prompt draft could not be sent to the main process.';
  console.error('[ERROR] Failed to update prompt mode draft:', error);
  updatePromptModePersistenceStatus({
    state: 'error',
    dirty: true,
    message,
    revision: promptModeDraftRevision
  });
}

function submitPromptModeDraft(draft) {
  if (typeof window.electronAPI?.updatePromptModeDraft !== 'function') {
    reportPromptModeDraftFailure(new Error('Prompt draft updates are unavailable.'));
    return Promise.resolve(false);
  }

  const request = Promise.resolve().then(() => window.electronAPI.updatePromptModeDraft({
    modeId: draft.modeId,
    suffix: draft.suffix,
    sessionId: promptModeDraftSessionId,
    revision: draft.revision
  }));
  const completion = request.then((result) => {
    if (result?.promptModePersistence) {
      updatePromptModePersistenceStatus(result.promptModePersistence);
    }

    if (latestPromptModeDraft === draft && result) {
      draft.acknowledged = true;
    }

    return result;
  }).catch((error) => {
    reportPromptModeDraftFailure(error);
    return false;
  });

  pendingPromptModeDraftUpdates.add(completion);
  void completion.finally(() => {
    pendingPromptModeDraftUpdates.delete(completion);
  });
  return completion;
}

function queuePromptModeAutosave() {
  if (!modeSuffixInput) {
    return;
  }

  updateModeEditorDirtyState();
  const selectedMode = getSelectedPromptMode();
  if (!selectedMode) {
    return;
  }

  const draft = {
    modeId: selectedMode.id,
    suffix: modeSuffixInput.value,
    revision: ++promptModeDraftRevision,
    acknowledged: false
  };
  latestPromptModeDraft = draft;
  updatePromptModePersistenceStatus({
    state: 'dirty',
    dirty: true,
    message: '',
    revision: draft.revision
  });
  void submitPromptModeDraft(draft);
}

async function waitForPendingPromptModeDraftUpdates() {
  while (pendingPromptModeDraftUpdates.size > 0) {
    await Promise.all(Array.from(pendingPromptModeDraftUpdates));
  }
}

async function flushPendingPromptModeAutosave() {
  await waitForPendingPromptModeDraftUpdates();

  if (latestPromptModeDraft && !latestPromptModeDraft.acknowledged) {
    const retryDraft = {
      ...latestPromptModeDraft,
      revision: ++promptModeDraftRevision,
      acknowledged: false
    };
    latestPromptModeDraft = retryDraft;
    await submitPromptModeDraft(retryDraft);
    await waitForPendingPromptModeDraftUpdates();
  }

  if (typeof window.electronAPI?.flushPromptModeDrafts !== 'function') {
    reportPromptModeDraftFailure(new Error('Prompt draft persistence is unavailable.'));
    return false;
  }

  try {
    const result = await window.electronAPI.flushPromptModeDrafts();
    if (result?.promptModePersistence) {
      updatePromptModePersistenceStatus(result.promptModePersistence);
    }
    return result?.success !== false;
  } catch (error) {
    reportPromptModeDraftFailure(error);
    return false;
  }
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
  cancelPendingModeDropdownClose();
  deferredModeDropdownRenderPending = false;
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

async function selectPromptModeFromMenu(modeId, options = {}) {
  const shouldDeferCloseForRename = Boolean(options.deferCloseForRename);

  if (shouldDeferCloseForRename) {
    scheduleModeDropdownCloseAfterRenameWindow();
  } else {
    cancelPendingModeDropdownClose();
  }

  try {
    await flushPendingPromptModeAutosave();
    const nextState = await window.electronAPI.selectPromptMode(modeId);
    updatePromptModeState(nextState);
    if (!shouldDeferCloseForRename) {
      setModeDropdownOpen(false);
    }
  } catch (error) {
    cancelPendingModeDropdownClose();
    console.error('[ERROR] Failed to select prompt mode:', error);
  }
}

async function deletePromptModeFromMenu(modeId) {
  editingPromptModeId = null;

  try {
    const nextState = await window.electronAPI.deletePromptMode(modeId);
    updatePromptModeState(nextState);
  } catch (error) {
    console.error('[ERROR] Failed to delete prompt mode:', error);
  }
}

async function addPromptModeFromMenu() {
  try {
    await flushPendingPromptModeAutosave();
    const nextState = await window.electronAPI.addPromptMode();
    updatePromptModeState(nextState);
    setModeDropdownOpen(false);
    modeSuffixInput?.focus();
  } catch (error) {
    console.error('[ERROR] Failed to add prompt mode:', error);
  }
}

function getModeDropdownRenderSignature() {
  return JSON.stringify({
    selectedPromptModeId,
    editingPromptModeId,
    canDeleteModes: promptModes.length > 1,
    modes: getSortedPromptModes(promptModes).map((mode) => ({
      id: mode.id,
      name: mode.name,
      hotkey: mode.hotkey || ''
    }))
  });
}

function populateModeDropdownMenu(menuElement) {
  if (!menuElement) {
    return;
  }

  menuElement.textContent = '';
  const sortedPromptModes = getSortedPromptModes(promptModes);

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
    setProtectedTooltip(deleteButton, `Delete ${mode.name}`);

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

    item.onclick = async (event) => {
      if (event.detail > 1) {
        return;
      }

      await selectPromptModeFromMenu(mode.id, { deferCloseForRename: true });
    };

    item.onkeydown = async (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        await selectPromptModeFromMenu(mode.id);
      }
    };

    item.ondblclick = (event) => {
      event.preventDefault();
      event.stopPropagation();
      cancelPendingModeDropdownClose();
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
    await addPromptModeFromMenu();
  };
  menuElement.appendChild(addButton);
  updateModeDropdownRovingTabStop(menuElement);
}

function renderModeDropdownMenu() {
  const nextSignature = getModeDropdownRenderSignature();
  if (nextSignature === modeDropdownRenderSignature) {
    return;
  }

  modeDropdownRenderSignature = nextSignature;

  for (const menuElement of getModeDropdownMenus()) {
    populateModeDropdownMenu(menuElement);
  }
}

function renderModeDropdownMenuUnlessDeferred() {
  if (isModeDropdownRenderDeferredForRename()) {
    deferredModeDropdownRenderPending = true;
    return;
  }

  renderModeDropdownMenu();
}

async function handleModeMenuAction(action) {
  if (!action || typeof action.type !== 'string') {
    return;
  }

  switch (action.type) {
    case 'select':
      await selectPromptModeFromMenu(action.modeId, {
        deferCloseForRename: Boolean(action.deferCloseForRename)
      });
      break;
    case 'begin-rename':
      cancelPendingModeDropdownClose();
      break;
    case 'delete':
      await deletePromptModeFromMenu(action.modeId);
      break;
    case 'rename':
      await commitPromptModeRename(action.modeId, action.name);
      break;
    case 'add':
      await addPromptModeFromMenu();
      break;
    case 'close':
      setModeDropdownOpen(false);
      break;
    default:
      break;
  }
}

function updatePromptModeState(state, options = {}) {
  const previousSelectedModeId = selectedPromptModeId;
  const currentPromptDraft = modeSuffixInput ? modeSuffixInput.value : '';
  const shouldPreservePromptDraft = Boolean(modeSuffixInput && isModeEditorDirty);

  if (state?.promptModePersistence) {
    updatePromptModePersistenceStatus(state.promptModePersistence);
  }

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

  if (latestPromptModeDraft && activeMode?.id !== latestPromptModeDraft.modeId) {
    latestPromptModeDraft = null;
  } else if (
    latestPromptModeDraft
    && activeMode?.suffix === latestPromptModeDraft.suffix
  ) {
    latestPromptModeDraft.acknowledged = true;
  }

  if (modePromptPreview) {
    const promptPreviewText = typeof activeMode?.suffix === 'string'
      ? activeMode.suffix.trim()
      : '';
    const singleLinePrompt = promptPreviewText.replace(/\s+/g, ' ');
    const displayPrompt = singleLinePrompt || 'No prompt';
    modePromptPreview.textContent = displayPrompt;
    setProtectedTooltip(modePromptPreview, promptPreviewText || 'No prompt');
  }

  renderModeDropdownMenuUnlessDeferred();
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

function updateTranscriptSourceControlButton() {
  if (!toggleLiveCaptionsBtn) {
    return;
  }

  const isLiveCaptionsSource = transcriptSource === TRANSCRIPT_SOURCE_LIVE_CAPTIONS;
  const isDeepgramSource = transcriptSource === TRANSCRIPT_SOURCE_DEEPGRAM;
  const isDisabled = isDeepgramSource && !hasDeepgramApiKey;

  toggleLiveCaptionsBtn.disabled = isDisabled;
  toggleLiveCaptionsBtn.setAttribute('aria-disabled', String(isDisabled));
  toggleLiveCaptionsBtn.classList.toggle('is-disabled', isDisabled);
  toggleLiveCaptionsBtn.classList.toggle('is-deepgram-source', isDeepgramSource);
  toggleLiveCaptionsBtn.classList.toggle('is-deepgram-running', isDeepgramSource && deepgramCaptureActive);

  if (isDeepgramSource) {
    toggleLiveCaptionsBtn.classList.remove('is-hidden-state');
    const actionLabel = !hasDeepgramApiKey
      ? 'Add Deepgram API key in settings'
      : (deepgramCaptureActive ? 'Stop Deepgram transcription' : 'Start Deepgram transcription');
    setProtectedTooltip(toggleLiveCaptionsBtn, actionLabel);
    toggleLiveCaptionsBtn.setAttribute('aria-label', actionLabel);
    toggleLiveCaptionsBtn.setAttribute('aria-pressed', String(deepgramCaptureActive));
    return;
  }

  toggleLiveCaptionsBtn.classList.remove('is-deepgram-running');
  toggleLiveCaptionsBtn.classList.toggle('is-hidden-state', !liveCaptionsWindowVisible);

  const actionLabel = liveCaptionsWindowVisible
    ? 'Hide Live Captions window'
    : 'Show Live Captions window';

  setProtectedTooltip(toggleLiveCaptionsBtn, actionLabel);
  toggleLiveCaptionsBtn.setAttribute('aria-label', actionLabel);
  toggleLiveCaptionsBtn.setAttribute('aria-pressed', String(liveCaptionsWindowVisible));
}

function updateLiveCaptionsToggleButton(isVisible) {
  if (typeof isVisible === 'boolean') {
    liveCaptionsWindowVisible = isVisible;
  }

  updateTranscriptSourceControlButton();
}

async function refreshLiveCaptionsToggleButton() {
  if (!toggleLiveCaptionsBtn) {
    return false;
  }

  if (transcriptSource !== TRANSCRIPT_SOURCE_LIVE_CAPTIONS) {
    updateLiveCaptionsToggleButton(liveCaptionsWindowVisible);
    return true;
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

if (openHotkeySettingsBtn) {
  openHotkeySettingsBtn.onclick = async () => {
    try {
      await window.electronAPI.openHotkeySettings();
    } catch (error) {
      console.error('[ERROR] Failed to open hotkey settings:', error);
    }
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

if (saveTranscriptBtn) {
  saveTranscriptBtn.onclick = async () => {
    setButtonBusy(saveTranscriptBtn, true);

    try {
      const result = await window.electronAPI.saveTranscript();
      if (result && result.success === false && !result.canceled && result.reason !== 'empty') {
        console.error('[ERROR] Failed to save transcript:', result.error || result.reason);
      }
    } catch (error) {
      console.error('[ERROR] Failed to save transcript:', error);
    } finally {
      setButtonBusy(saveTranscriptBtn, false);
    }
  };
}

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
    if (transcriptSource === TRANSCRIPT_SOURCE_DEEPGRAM) {
      if (!hasDeepgramApiKey) {
        updateTranscriptSourceControlButton();
        return;
      }

      setButtonBusy(toggleLiveCaptionsBtn, true);

      try {
        const state = deepgramCaptureActive
          ? await window.electronAPI.stopDeepgramTranscription()
          : await window.electronAPI.startDeepgramTranscription();
        applyDeepgramCaptureState(state);
      } catch (error) {
        console.error('[ERROR] Failed to toggle Deepgram transcription:', error);
      } finally {
        setButtonBusy(toggleLiveCaptionsBtn, false);
        updateTranscriptSourceControlButton();
      }
      return;
    }

    if (transcriptSource !== TRANSCRIPT_SOURCE_LIVE_CAPTIONS) {
      return;
    }

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

  toggleTranslationBtn.onclick = async () => {
    if (!translationEnabled) {
      return;
    }

    const previousVisible = translationsVisible;
    const nextVisible = !translationsVisible;
    setTranslationVisibility(nextVisible);

    try {
      const preferences = await window.electronAPI.setTranslationVisible(nextVisible);
      applyAppPreferences(preferences);
    } catch (error) {
      setTranslationVisibility(previousVisible);
      console.error('[ERROR] Failed to persist translation visibility:', error);
    }
  };
} else {
  setTranslationVisibility(translationsVisible);
}

if (newTranscriptIndicator) {
  newTranscriptIndicator.onclick = () => {
    scrollTranscriptToBottom();
  };
}

if (panelDivider && browserContainer) {
  panelDivider.onpointerdown = (event) => {
    if (event.button !== 0) {
      return;
    }

    event.preventDefault();

    const dividerRect = panelDivider.getBoundingClientRect();
    panelResizeState = {
      pointerOffset: event.clientX - dividerRect.left
    };

    browserContainer.classList.add('is-resizing');
    document.body.classList.add('is-resizing-panels');

    if (typeof panelDivider.setPointerCapture === 'function') {
      panelDivider.setPointerCapture(event.pointerId);
    }

    document.addEventListener('pointermove', handlePanelDividerPointerMove);
    document.addEventListener('pointerup', handlePanelDividerPointerUp);
    document.addEventListener('pointercancel', handlePanelDividerPointerUp);

    updatePanelSplitFromPointer(event.clientX);
  };

  panelDivider.addEventListener('keydown', handlePanelDividerKeydown);
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
    const shouldOpen = !isModeDropdownOpen || activeModeDropdownToggle !== modeDropdownToggle;
    activeModeDropdownToggle = modeDropdownToggle;
    setModeDropdownOpen(shouldOpen);
  };
}

if (collapsedModeDropdownToggle) {
  collapsedModeDropdownToggle.onclick = (event) => {
    event.stopPropagation();
    const shouldOpen = !isModeDropdownOpen || activeModeDropdownToggle !== collapsedModeDropdownToggle;
    activeModeDropdownToggle = collapsedModeDropdownToggle;
    setModeDropdownOpen(shouldOpen);
  };
}

if (modeDropdownMenu) {
  modeDropdownMenu.addEventListener('click', (event) => {
    event.stopPropagation();
  });
  modeDropdownMenu.addEventListener('keydown', handleModeDropdownRovingFocus);
  modeDropdownMenu.addEventListener('focusin', handleModeDropdownFocusIn);
}

if (collapsedModeDropdownMenu) {
  collapsedModeDropdownMenu.addEventListener('click', (event) => {
    event.stopPropagation();
  });
  collapsedModeDropdownMenu.addEventListener('keydown', handleModeDropdownRovingFocus);
  collapsedModeDropdownMenu.addEventListener('focusin', handleModeDropdownFocusIn);
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

window.addEventListener('beforeunload', () => {
  void flushPendingPromptModeAutosave();
});

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

window.electronAPI.onPromptModePersistenceStatus((status) => {
  updatePromptModePersistenceStatus(status);
});

window.electronAPI.onModeMenuAction((action) => {
  handleModeMenuAction(action).catch((error) => {
    console.error('[ERROR] Failed to handle Mode menu action:', error);
  });
});

window.electronAPI.onModeMenuClosed(() => {
  if (isModeDropdownOpen) {
    setModeDropdownOpen(false, { syncMenu: false });
  }
});

window.electronAPI.onAppPreferencesUpdated((preferences) => {
  applyAppPreferences(preferences);
});

window.electronAPI.onDeepgramCaptureCommand(async (command) => {
  const action = command?.action;
  let success = false;
  try {
    if (action === 'start') {
      success = await startDeepgramCapture();
    } else if (action === 'stop') {
      await stopDeepgramCapture();
      success = true;
    }
  } catch (error) {
    console.error(`[ERROR] Deepgram renderer ${String(action || 'unknown')} command failed:`, error);
  }

  try {
    await window.electronAPI.acknowledgeDeepgramCaptureCommand({
      requestId: command?.requestId,
      action,
      success
    });
  } catch (error) {
    console.error('[ERROR] Failed to acknowledge Deepgram capture command:', error);
  }
});

window.electronAPI.onDeepgramCaptureState((state) => {
  applyDeepgramCaptureState(state);
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
  clearTranscriptHoverHeightLocks();
  applyPanelSplitRatio(currentPanelSplitRatio);
});
window.addEventListener('beforeunload', () => {
  void stopDeepgramCapture();
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

    if (checkIfAtBottom()) {
      setNewTranscriptIndicatorVisible(false);
    }

    isUserScrolling = true;
    scrollTimeout = setTimeout(() => {
      isUserScrolling = false;
      if (checkIfAtBottom()) {
        setNewTranscriptIndicatorVisible(false);
      }
    }, 150);
  });
}

window.electronAPI.onCaptionUpdate((data) => {
  if (!transcriptEl || !data || (typeof data.fullText !== 'string' && !Array.isArray(data.entries))) {
    return;
  }

  clearTranscriptSourceStatus();

  const nextEntries = normalizeTranscriptEntries(data);
  const nextTranscript = typeof data.fullText === 'string'
    ? data.fullText
    : nextEntries.map((entry) => entry.sourceText).join('\n');
  const nextPayloadVersion = typeof data.payloadVersion === 'number'
    ? data.payloadVersion
    : null;

  if (nextPayloadVersion !== null && nextPayloadVersion === lastCaptionPayloadVersion) {
    return;
  }

  const wasAtBottom = checkIfAtBottom();
  const previousScrollTop = transcriptEl.scrollTop;

  lastCaptionPayloadVersion = nextPayloadVersion;
  renderTranscriptEntries(nextEntries);

  setTimeout(() => {
    const hasTranscriptContent = nextEntries.length > 0 || nextTranscript.trim().length > 0;
    if (!hasTranscriptContent) {
      setNewTranscriptIndicatorVisible(false);
    } else if (wasAtBottom && !isUserScrolling) {
      scrollTranscriptToBottom();
    } else {
      transcriptEl.scrollTop = previousScrollTop;
      setNewTranscriptIndicatorVisible(true);
    }
  }, 0);
});

window.electronAPI.onCaptionError((error) => {
  showCaptionErrorStatus(error);
});

window.electronAPI.onTranscriptSourceState((state) => {
  applyTranscriptSourceLifecycle(state);
});
