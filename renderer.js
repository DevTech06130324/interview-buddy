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
const deepgramUsageStatus = document.getElementById('deepgramUsageStatus');
const deepgramSessionUsageValue = document.getElementById('deepgramSessionUsageValue');
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
let transcriptHistory = '';
let lastCaptionPayloadVersion = null;
let isUserScrolling = false;
let scrollTimeout = null;
let hasNewTranscriptBelow = false;
let liveCaptionsWindowVisible = true;
let translationsVisible = false;
let translationEnabled = false;
let transcriptSource = 'live-captions';
let hasDeepgramApiKey = false;
let deepgramCaptureActive = false;
let deepgramCaptureStartedAtMs = null;
let deepgramRemainingText = 'Remaining unavailable';
let deepgramUsageTimer = null;
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
let modeHotkeyStatus = 'idle';
let modeHotkeyDisplayOverride = null;
let modeHotkeyFeedbackTimer = null;
let promptModeAutosaveTimer = null;
let promptModeAutosaveRequest = Promise.resolve();
let promptModeStateSyncRequest = Promise.resolve();
let panelResizeState = null;
let panelRatioSyncFrame = null;
let pendingPanelRatioToSync = null;

const PANEL_DIVIDER_WIDTH = 10;
const MIN_TRANSCRIPT_PANEL_WIDTH = 280;
const MIN_BROWSER_PANEL_WIDTH = 220;
const PROMPT_MODE_AUTOSAVE_DELAY_MS = 400;
const MODE_HOTKEY_FEEDBACK_RESET_DELAY_MS = 1400;
const {
  DEFAULT_TRANSCRIPT_TIMESTAMP_LABEL,
  TRANSCRIPT_SPEAKER_TAG,
  formatTranscriptEntryMarker,
  normalizeTranscriptSpeakerTag,
  normalizeTranscriptTimestampLabel,
  shouldIncludeTranscriptSpeaker
} = window.transcriptPrompt;
const TRANSCRIPT_SOURCE_DEEPGRAM = 'deepgram';
const TRANSCRIPT_SOURCE_LIVE_CAPTIONS = 'live-captions';
const DEEPGRAM_ROLE_THEM = TRANSCRIPT_SPEAKER_TAG;
const DEEPGRAM_ROLE_ME = 'Me';
const DEEPGRAM_AUDIO_TIMESLICE_MS = 500;
const createTranscriptDisplayGroups = typeof window.transcriptDisplayGroups?.createTranscriptDisplayGroups === 'function'
  ? window.transcriptDisplayGroups.createTranscriptDisplayGroups
  : (entries) => entries;
let deepgramCaptureResources = null;
let deepgramCaptureStartPromise = null;
let deepgramCaptureGeneration = 0;

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
    newTranscriptIndicator.hidden = !hasNewTranscriptBelow;
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
          timestampLabel: normalizeTranscriptTimestampLabel(entry.timestampLabel)
            || DEFAULT_TRANSCRIPT_TIMESTAMP_LABEL,
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
    timestampLabel: DEFAULT_TRANSCRIPT_TIMESTAMP_LABEL,
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
    timestampLabel: entry.timestampLabel,
    speakerTag: entry.speakerTag,
    includeSpeaker: Boolean(options.includeSpeaker)
  });
}

function getTranscriptSourceSignature(entry) {
  return String(entry?.sourceText || '');
}

function getTranscriptTranslationSignature(entry) {
  return JSON.stringify({
    translatedText: entry.translatedText,
    status: entry.status
  });
}

function updateTranscriptMarker(marker, entry, options = {}) {
  const signature = getTranscriptMarkerSignature(entry, options);
  if (marker.dataset.markerSignature === signature) {
    return;
  }

  marker.dataset.markerSignature = signature;
  marker.textContent = formatTranscriptEntryMarker(entry, options);
}

function updateTranscriptSourceCell(sourceCell, entry) {
  const signature = getTranscriptSourceSignature(entry);
  if (sourceCell.dataset.sourceSignature === signature) {
    return;
  }

  sourceCell.dataset.sourceSignature = signature;
  const sourceText = document.createElement('span');
  sourceText.className = 'transcript-entry-text';
  sourceText.textContent = entry.sourceText;

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

  const header = document.createElement('div');
  header.className = 'transcript-entry-header';

  const marker = document.createElement('span');
  marker.className = 'transcript-entry-marker';
  header.appendChild(marker);

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
    entry.isFinal ? '' : 'is-partial'
  ].filter(Boolean).join(' ');

  if (row.className !== rowClassName) {
    row.className = rowClassName;
  }

  const marker = row.querySelector('.transcript-entry-marker');
  if (marker) {
    updateTranscriptMarker(marker, entry, markerOptions);
  }

  const sourceCell = row.querySelector('.transcript-cell-source');
  if (sourceCell) {
    updateTranscriptSourceCell(sourceCell, entry);
  }

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

  transcriptEl.classList.remove('has-error');
  const displayEntries = createTranscriptDisplayGroups(entries);

  if (!transcriptRowsEl) {
    transcriptEl.textContent = displayEntries
      .map((entry, index) => `${formatTranscriptEntryMarker(entry, {
        includeSpeaker: shouldIncludeTranscriptSpeaker(entry, index, displayEntries[index - 1])
      })}\n${entry.sourceText}`)
      .join('\n\n');
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
}

function setTranslationVisibility(isVisible) {
  translationsVisible = Boolean(isVisible);

  if (transcriptEl) {
    transcriptEl.classList.toggle('is-translation-hidden', !translationsVisible);
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

  updateTranslationToggleButtonState();
}

function stopMediaStreamTracks(stream) {
  if (!stream || typeof stream.getTracks !== 'function') {
    return;
  }

  for (const track of stream.getTracks()) {
    try {
      track.stop();
    } catch (error) {
      console.error('[ERROR] Failed to stop media track:', error);
    }
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

function createAudioOnlyStream(sourceStream) {
  const audioTracks = typeof sourceStream?.getAudioTracks === 'function'
    ? sourceStream.getAudioTracks()
    : [];

  if (audioTracks.length === 0) {
    return null;
  }

  return new MediaStream(audioTracks);
}

async function sendDeepgramRecorderBlob(role, blob) {
  if (!blob || blob.size <= 0 || !window.electronAPI?.sendDeepgramAudioChunk) {
    return;
  }

  const chunk = await blob.arrayBuffer();
  window.electronAPI.sendDeepgramAudioChunk({
    role,
    chunk
  });
}

function createDeepgramRecorder(role, stream) {
  const mimeType = getDeepgramRecorderMimeType();
  const recorder = mimeType
    ? new MediaRecorder(stream, { mimeType })
    : new MediaRecorder(stream);

  recorder.addEventListener('dataavailable', (event) => {
    void sendDeepgramRecorderBlob(role, event.data);
  });
  recorder.addEventListener('error', (event) => {
    console.error('[ERROR] Deepgram recorder error:', event?.error || event);
  });
  recorder.start(DEEPGRAM_AUDIO_TIMESLICE_MS);
  return recorder;
}

function stopDeepgramCapture() {
  deepgramCaptureGeneration += 1;
  const resources = deepgramCaptureResources;
  deepgramCaptureResources = null;

  if (!resources) {
    return;
  }

  for (const recorder of resources.recorders || []) {
    try {
      if (recorder && recorder.state !== 'inactive') {
        recorder.stop();
      }
    } catch (error) {
      console.error('[ERROR] Failed to stop Deepgram recorder:', error);
    }
  }

  for (const stream of resources.streams || []) {
    stopMediaStreamTracks(stream);
  }
}

async function startDeepgramCapture() {
  if (deepgramCaptureResources) {
    return true;
  }

  if (deepgramCaptureStartPromise) {
    return deepgramCaptureStartPromise;
  }

  const captureGeneration = deepgramCaptureGeneration;
  deepgramCaptureStartPromise = (async () => {
    if (!navigator.mediaDevices?.getDisplayMedia || !navigator.mediaDevices?.getUserMedia) {
      throw new Error('Media capture is not available in this browser context.');
    }

    const displayStream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: true
    });
    const micStream = await navigator.mediaDevices.getUserMedia({
      audio: true
    });
    const systemAudioStream = createAudioOnlyStream(displayStream);
    const microphoneAudioStream = createAudioOnlyStream(micStream);

    if (!microphoneAudioStream) {
      stopMediaStreamTracks(displayStream);
      stopMediaStreamTracks(micStream);
      throw new Error('Deepgram capture requires microphone access.');
    }

    if (captureGeneration !== deepgramCaptureGeneration) {
      stopMediaStreamTracks(displayStream);
      stopMediaStreamTracks(micStream);
      return false;
    }

    const recorders = [];
    const streams = [micStream, microphoneAudioStream];

    if (systemAudioStream) {
      recorders.push(createDeepgramRecorder(DEEPGRAM_ROLE_THEM, systemAudioStream));
      streams.push(displayStream, systemAudioStream);
    } else {
      console.warn('[WARNING] System audio is not available for Deepgram capture; microphone capture will continue.');
      stopMediaStreamTracks(displayStream);
    }

    recorders.push(createDeepgramRecorder(DEEPGRAM_ROLE_ME, microphoneAudioStream));

    const stopOnTrackEnd = () => {
      if (transcriptSource === TRANSCRIPT_SOURCE_DEEPGRAM) {
        stopDeepgramCapture();
        void window.electronAPI?.stopDeepgramTranscription?.();
      }
    };

    if (systemAudioStream) {
      for (const track of displayStream.getTracks()) {
        track.addEventListener('ended', stopOnTrackEnd, { once: true });
      }
    }

    for (const track of micStream.getTracks()) {
      track.addEventListener('ended', stopOnTrackEnd, { once: true });
    }

    deepgramCaptureResources = {
      recorders,
      streams
    };
    return true;
  })().catch((error) => {
    console.error('[ERROR] Failed to start Deepgram capture:', error);
    stopDeepgramCapture();
    return false;
  }).finally(() => {
    deepgramCaptureStartPromise = null;
  });

  return deepgramCaptureStartPromise;
}

function formatDeepgramSessionDuration(totalSeconds = 0) {
  const safeSeconds = Math.max(0, Math.floor(Number(totalSeconds) || 0));
  const minutes = Math.floor(safeSeconds / 60);
  const seconds = safeSeconds % 60;

  if (minutes < 60) {
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours}:${String(remainingMinutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function getDeepgramSessionElapsedSeconds() {
  if (!deepgramCaptureActive || !deepgramCaptureStartedAtMs) {
    return 0;
  }

  return Math.floor(Math.max(0, Date.now() - deepgramCaptureStartedAtMs) / 1000);
}

function updateDeepgramUsageStatus(usage = {}) {
  if (usage && typeof usage === 'object') {
    if (usage.active !== undefined) {
      deepgramCaptureActive = Boolean(usage.active);
    }

    if (Number.isFinite(usage.sessionStartedAtMs)) {
      deepgramCaptureStartedAtMs = usage.sessionStartedAtMs;
    } else if (!deepgramCaptureActive) {
      deepgramCaptureStartedAtMs = null;
    }

    if (typeof usage.remainingText === 'string' && usage.remainingText.trim()) {
      deepgramRemainingText = usage.remainingText;
    }
  }

  const isDeepgramSource = transcriptSource === TRANSCRIPT_SOURCE_DEEPGRAM;
  if (deepgramUsageStatus) {
    deepgramUsageStatus.hidden = !isDeepgramSource;
  }

  if (deepgramSessionUsageValue) {
    deepgramSessionUsageValue.textContent = `Session ${formatDeepgramSessionDuration(getDeepgramSessionElapsedSeconds())}`;
  }

  if (deepgramRemainingUsageValue) {
    deepgramRemainingUsageValue.textContent = deepgramRemainingText;
  }
}

function syncDeepgramUsageTimer() {
  if (!deepgramCaptureActive) {
    if (deepgramUsageTimer) {
      clearInterval(deepgramUsageTimer);
      deepgramUsageTimer = null;
    }
    updateDeepgramUsageStatus();
    return;
  }

  if (!deepgramUsageTimer) {
    deepgramUsageTimer = setInterval(() => updateDeepgramUsageStatus(), 1000);
  }
}

function syncDeepgramCaptureFromPreferences() {
  if (transcriptSource !== TRANSCRIPT_SOURCE_DEEPGRAM || !hasDeepgramApiKey) {
    deepgramCaptureActive = false;
    deepgramCaptureStartedAtMs = null;
    stopDeepgramCapture();
  }

  updateDeepgramUsageStatus();
  syncDeepgramUsageTimer();
  updateTranscriptSourceControlButton();
}

function applyDeepgramCaptureState(state = {}) {
  deepgramCaptureActive = Boolean(state?.active);
  deepgramCaptureStartedAtMs = Number.isFinite(state?.sessionStartedAtMs)
    ? state.sessionStartedAtMs
    : (deepgramCaptureActive ? (deepgramCaptureStartedAtMs || Date.now()) : null);

  updateDeepgramUsageStatus(state);
  syncDeepgramUsageTimer();
  updateTranscriptSourceControlButton();

  if (deepgramCaptureActive) {
    void startDeepgramCapture();
    return;
  }

  stopDeepgramCapture();
}

function refreshDeepgramUsageStatus() {
  if (
    transcriptSource !== TRANSCRIPT_SOURCE_DEEPGRAM
    || !hasDeepgramApiKey
    || !window.electronAPI?.refreshDeepgramUsage
  ) {
    return;
  }

  window.electronAPI.refreshDeepgramUsage()
    .then((usage) => {
      updateDeepgramUsageStatus(usage);
      updateTranscriptSourceControlButton();
    })
    .catch((error) => {
      console.error('[ERROR] Failed to refresh Deepgram usage:', error);
    });
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

function setCurrentSplitRatio(ratio) {
  if (!Number.isFinite(ratio)) {
    return;
  }

  currentPanelSplitRatio = ratio;
}

function applyAppPreferences(preferences = {}) {
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

  if (typeof preferences.hasDeepgramApiKey === 'boolean') {
    hasDeepgramApiKey = preferences.hasDeepgramApiKey;
  }

  if (preferences.deepgramUsage && typeof preferences.deepgramUsage === 'object') {
    applyDeepgramCaptureState(preferences.deepgramUsage);
  } else {
    syncDeepgramCaptureFromPreferences();
  }

  updateTranscriptSourceControlButton();
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

  currentPanelSplitRatio = clampPanelSplitRatio(ratio);
  setCurrentSplitRatio(currentPanelSplitRatio);

  const metrics = getPanelMetrics();
  if (!metrics || metrics.adjustableSize <= 0) {
    return;
  }

  const transcriptSize = Math.round(metrics.adjustableSize * currentPanelSplitRatio);
  leftPanel.style.width = `${transcriptSize}px`;
  leftPanel.style.height = '';
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

function setModeHotkeyStatus(status) {
  modeHotkeyStatus = status;

  if (!modeHotkeyInput) {
    return;
  }

  modeHotkeyInput.classList.toggle('is-success', status === 'success');
  modeHotkeyInput.classList.toggle('is-error', status === 'error');
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

  for (const dropdownMenu of getModeDropdownMenus()) {
    dropdownMenu.hidden = !(isVisible && dropdownMenu === activeMenu);
  }
}

async function setModeDropdownOpen(isOpen, options = {}) {
  if (getModeDropdownMenus().length === 0 || getModeDropdownToggles().length === 0) {
    return false;
  }

  const requestId = ++modeDropdownOpenRequestId;
  isModeDropdownOpen = Boolean(isOpen);
  if (!isModeDropdownOpen) {
    editingPromptModeId = null;
    activeModeDropdownToggle = null;
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

      await selectPromptModeFromMenu(mode.id);
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

async function handleModeMenuAction(action) {
  if (!action || typeof action.type !== 'string') {
    return;
  }

  switch (action.type) {
    case 'select':
      await selectPromptModeFromMenu(action.modeId);
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
    setProtectedTooltip(modePromptPreview, promptPreviewText || 'No prompt');
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
  applyPanelSplitRatio(currentPanelSplitRatio);
});
window.addEventListener('beforeunload', () => {
  stopDeepgramCapture();
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

  transcriptHistory = nextTranscript;
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
  if (!transcriptEl) {
    return;
  }

    transcriptHistory = '';
    lastCaptionPayloadVersion = null;
  setNewTranscriptIndicatorVisible(false);
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
