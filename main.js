const { app, BrowserWindow, BrowserView, ipcMain, shell, globalShortcut, screen, clipboard, nativeTheme } = require('electron');
const fs = require('fs');
const path = require('path');

const APP_PROCESS_NAME = 'Notepadd++';
const WINDOW_TITLE = 'Interview assistant';

app.setName(APP_PROCESS_NAME);
process.title = APP_PROCESS_NAME;

// LiveCaptions integration
let captionSync = null;
if (process.platform === 'win32') {
    try {
        captionSync = require('./src/captionSync');
    } catch (error) {
        console.error('[WARNING] Failed to load caption sync service:', error.message);
        console.error('[WARNING] LiveCaptions integration will not be available');
    }
}

// Screen capture integration
const screenCapture = require('./src/screenCapture');
const translationManager = require('./src/translationManager');

// Constants
const BORDER_WIDTH = 3;
const PADDING_WIDTH = 10;
const APP_HEADBAR_HEIGHT = 38;
const TAB_BAR_HEIGHT = 40;
const URL_BAR_HEIGHT = 50;
const PANEL_DIVIDER_WIDTH = 10;
const TRANSCRIPT_PANEL_COLLAPSED_HEIGHT = 55;
const MODE_PANEL_HEIGHT = 224;
const MODE_PANEL_COLLAPSED_HEIGHT = 54;
const MOVE_DISTANCE = 100;
const OPACITY_STEP = 0.1;
const MIN_OPACITY = 0.1;
const MAX_OPACITY = 1.0;
const DEFAULT_OPACITY = 1.0;
const DEFAULT_WINDOW_WIDTH = 430;
const DEFAULT_WINDOW_HEIGHT = 700;
const MIN_TRANSCRIPT_PANEL_HEIGHT = TRANSCRIPT_PANEL_COLLAPSED_HEIGHT;
const MIN_BROWSER_PANEL_HEIGHT = 190;
const MIN_TRANSCRIPT_PANEL_WIDTH = TRANSCRIPT_PANEL_COLLAPSED_HEIGHT;
const MIN_BROWSER_PANEL_WIDTH = 220;
const SCREEN_SELECTION_MIN_SIZE = 8;
const LEGACY_DEFAULT_PROMPT_MODE_SUFFIX = 'Interviewer said like this, what should i say right now. the answer must be in easy and friendly and funny way but looks professional and polite and not too long';
const DEFAULT_PROMPT_MODE_SUFFIX = 'What should i say right now? The answer must be easy, friendly, a little funny, professional, polite, and not too long.';
const PROMPT_MODE_STORE_FILE = 'prompt-modes.json';
const GLOBAL_HOTKEY_STORE_FILE = 'global-hotkeys.json';
const APP_PREFERENCES_STORE_FILE = 'app-preferences.json';
const DEFAULT_PROMPT_MODE_NAME = 'Default';
const DEFAULT_THEME = 'dark';
const DEFAULT_LAYOUT_MODE = 'vertical';
const DEFAULT_SWITCH_ACTIVE_VIEW = 'transcript';
const DEFAULT_VERTICAL_TRANSCRIPT_PANEL_RATIO = 0.2;
const DEFAULT_HORIZONTAL_TRANSCRIPT_PANEL_RATIO = 0.3;
const SWITCH_VIEW_TABS_HEIGHT = 38;
const DEFAULT_TAB_URLS = [
  'https://chatgpt.com/',
  'https://chat.deepseek.com/'
];
const SUPPORTED_ASSISTANT_HOSTS = new Set([
  'chatgpt.com',
  'chat.openai.com',
  'chat.deepseek.com',
  'deepseek.com',
  'www.deepseek.com'
]);
const GLOBAL_HOTKEY_DEFINITIONS = [
  {
    id: 'opacityUp',
    label: 'Increase opacity',
    description: 'Make the app window less transparent.',
    defaultAccelerator: 'CommandOrControl+Shift+Alt+Up'
  },
  {
    id: 'opacityDown',
    label: 'Decrease opacity',
    description: 'Make the app window more transparent.',
    defaultAccelerator: 'CommandOrControl+Shift+Alt+Down'
  },
  {
    id: 'moveUp',
    label: 'Move up',
    description: 'Move the app window upward.',
    defaultAccelerator: 'CommandOrControl+Shift+Up'
  },
  {
    id: 'moveDown',
    label: 'Move down',
    description: 'Move the app window downward.',
    defaultAccelerator: 'CommandOrControl+Shift+Down'
  },
  {
    id: 'moveLeft',
    label: 'Move left',
    description: 'Move the app window left.',
    defaultAccelerator: 'CommandOrControl+Shift+Left'
  },
  {
    id: 'moveRight',
    label: 'Move right',
    description: 'Move the app window right.',
    defaultAccelerator: 'CommandOrControl+Shift+Right'
  },
  {
    id: 'toggleWindow',
    label: 'Show or hide app',
    description: 'Toggle the app window visibility.',
    defaultAccelerator: 'CommandOrControl+Shift+`'
  },
  {
    id: 'captureArea',
    label: 'Capture selected area',
    description: 'Pick a screen area for image capture.',
    defaultAccelerator: 'Alt+Z'
  },
  {
    id: 'sendTranscript',
    label: 'Send transcript',
    description: 'Paste the next transcript prompt into the assistant and send it.',
    defaultAccelerator: 'CommandOrControl+Enter'
  },
  {
    id: 'copyTranscript',
    label: 'Copy transcript',
    description: 'Copy the next transcript prompt to the clipboard.',
    defaultAccelerator: 'Alt+Enter'
  },
  {
    id: 'captureScreenToAssistant',
    label: 'Paste screen capture',
    description: 'Capture the screen and paste it into the assistant.',
    defaultAccelerator: 'CommandOrControl+Shift+Enter'
  },
  {
    id: 'toggleMute',
    label: 'Mute tabs',
    description: 'Mute or unmute all browser tabs.',
    defaultAccelerator: 'Alt+M'
  },
  {
    id: 'toggleSwitchView',
    label: 'Switch transcript/webview',
    description: 'Toggle the visible view in switching layout mode.',
    defaultAccelerator: 'F12'
  }
];

// State
let mainWindow;
let hotkeySettingsWindow = null;
const tabs = new Map();
let activeTabId = null;
let tabIdCounter = 0;
let currentOpacity = DEFAULT_OPACITY;
let isWindowVisible = true;
let isMuted = false;
let appWindowBounds = {
  width: DEFAULT_WINDOW_WIDTH,
  height: DEFAULT_WINDOW_HEIGHT
};
let currentTheme = DEFAULT_THEME;
let layoutMode = DEFAULT_LAYOUT_MODE;
let switchActiveView = DEFAULT_SWITCH_ACTIVE_VIEW;
let verticalTranscriptPanelRatio = DEFAULT_VERTICAL_TRANSCRIPT_PANEL_RATIO;
let horizontalTranscriptPanelRatio = DEFAULT_HORIZONTAL_TRANSCRIPT_PANEL_RATIO;
let isTranscriptPanelCollapsed = true;
let isModePanelCollapsed = true;
let translationsVisible = false;
let liveCaptionsWindowVisible = true;
let captureOverlayState = null;
const shortcutCooldowns = new Map();
const registeredGlobalHotkeys = new Map();
const registeredModeHotkeys = new Map();
let latestTranscriptText = '';
let promptModes = createDefaultPromptModes();
let globalHotkeys = createDefaultGlobalHotkeys();
let selectedPromptModeId = promptModes[0].id;
let captionSyncStartTimer = null;
let promptModePersistTimer = null;
let pendingPromptModePersistPayload = null;
let promptModePersistInFlight = false;
let appPreferencesPersistTimer = null;
let defaultTabWarmupTimer = null;
let lastSubmittedTranscriptText = '';
let lastClipboardTranscriptText = '';

function createDefaultPromptModes() {
  return [
    {
      id: 'default',
      name: DEFAULT_PROMPT_MODE_NAME,
      suffix: DEFAULT_PROMPT_MODE_SUFFIX
    }
  ];
}

function createDefaultGlobalHotkeys() {
  return GLOBAL_HOTKEY_DEFINITIONS.reduce((state, definition) => {
    state[definition.id] = definition.defaultAccelerator;
    return state;
  }, {});
}

function getPromptModeStorePath() {
  return path.join(app.getPath('userData'), PROMPT_MODE_STORE_FILE);
}

function getGlobalHotkeyStorePath() {
  return path.join(app.getPath('userData'), GLOBAL_HOTKEY_STORE_FILE);
}

function getAppPreferencesStorePath() {
  return path.join(app.getPath('userData'), APP_PREFERENCES_STORE_FILE);
}

function serializePromptModeStateSnapshot() {
  return JSON.stringify(getPromptModeStateSnapshot(), null, 2);
}

function createPromptModeId() {
  return `mode-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalizePromptMode(mode, index) {
  if (!mode || typeof mode !== 'object') {
    return null;
  }

  const name = typeof mode.name === 'string' && mode.name.trim()
    ? mode.name.trim()
    : `Mode ${index + 1}`;

  const rawSuffix = typeof mode.suffix === 'string' ? mode.suffix : '';
  const suffix = rawSuffix.trim() === LEGACY_DEFAULT_PROMPT_MODE_SUFFIX
    && (
      (typeof mode.id === 'string' && mode.id.trim() === 'default')
      || name === DEFAULT_PROMPT_MODE_NAME
    )
    ? DEFAULT_PROMPT_MODE_SUFFIX
    : rawSuffix;

  return {
    id: typeof mode.id === 'string' && mode.id.trim() ? mode.id.trim() : createPromptModeId(),
    name,
    suffix,
    hotkey: typeof mode.hotkey === 'string' ? mode.hotkey.trim() : ''
  };
}

function ensurePromptModeState() {
  const normalizedModes = Array.isArray(promptModes)
    ? promptModes
        .map((mode, index) => normalizePromptMode(mode, index))
        .filter(Boolean)
    : [];

  const uniqueModes = [];
  const seenIds = new Set();

  for (const mode of normalizedModes) {
    if (seenIds.has(mode.id)) {
      mode.id = createPromptModeId();
    }

    seenIds.add(mode.id);
    uniqueModes.push(mode);
  }

  promptModes = uniqueModes.length > 0 ? uniqueModes : createDefaultPromptModes();

  if (!promptModes.some((mode) => mode.id === selectedPromptModeId)) {
    selectedPromptModeId = promptModes[0].id;
  }
}

function getSelectedPromptMode() {
  ensurePromptModeState();
  return promptModes.find((mode) => mode.id === selectedPromptModeId) || promptModes[0];
}

function getPromptModeStateSnapshot() {
  ensurePromptModeState();

  return {
    promptModes: promptModes.map((mode) => ({
      id: mode.id,
      name: mode.name,
      suffix: mode.suffix,
      hotkey: mode.hotkey
    })),
    selectedPromptModeId
  };
}

function broadcastPromptModeState() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('prompt-mode-state', getPromptModeStateSnapshot());
  }
}

function normalizeTheme(value) {
  return value === 'light' ? 'light' : 'dark';
}

function normalizeLayoutMode(value) {
  return ['horizontal', 'vertical', 'switch'].includes(value) ? value : DEFAULT_LAYOUT_MODE;
}

function normalizeSwitchActiveView(value) {
  return value === 'webview' ? 'webview' : 'transcript';
}

function normalizeBoolean(value, fallback) {
  return typeof value === 'boolean' ? value : fallback;
}

function normalizeOpacity(value) {
  const opacity = Number(value);
  return Number.isFinite(opacity) ? Math.min(MAX_OPACITY, Math.max(MIN_OPACITY, opacity)) : DEFAULT_OPACITY;
}

function normalizeSplitRatio(value, fallback) {
  const ratio = Number(value);
  return Number.isFinite(ratio) ? Math.min(0.9, Math.max(0.1, ratio)) : fallback;
}

function normalizeWindowBounds(value) {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const width = Number(value.width);
  const height = Number(value.height);
  if (!Number.isFinite(width) || !Number.isFinite(height)) {
    return null;
  }

  const bounds = {
    width: Math.max(400, Math.round(width)),
    height: Math.max(300, Math.round(height))
  };

  const x = Number(value.x);
  const y = Number(value.y);
  if (Number.isFinite(x) && Number.isFinite(y)) {
    bounds.x = Math.round(x);
    bounds.y = Math.round(y);
  }

  return bounds;
}

function doRectsOverlap(left, right) {
  return (
    left.x < right.x + right.width
    && left.x + left.width > right.x
    && left.y < right.y + right.height
    && left.y + left.height > right.y
  );
}

function getCenteredWindowBounds(width, height) {
  const workArea = screen.getPrimaryDisplay().workArea;
  return {
    x: Math.round(workArea.x + (workArea.width - width) / 2),
    y: Math.round(workArea.y + (workArea.height - height) / 2),
    width,
    height
  };
}

function getRestoredWindowBounds() {
  const bounds = normalizeWindowBounds(appWindowBounds) || {
    width: DEFAULT_WINDOW_WIDTH,
    height: DEFAULT_WINDOW_HEIGHT
  };

  if (!Number.isFinite(bounds.x) || !Number.isFinite(bounds.y)) {
    return getCenteredWindowBounds(bounds.width, bounds.height);
  }

  const isVisibleOnAnyDisplay = screen.getAllDisplays().some((display) => {
    return doRectsOverlap(bounds, display.workArea);
  });

  return isVisibleOnAnyDisplay
    ? bounds
    : getCenteredWindowBounds(bounds.width, bounds.height);
}

function getCurrentWindowBoundsSnapshot() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    appWindowBounds = normalizeWindowBounds(mainWindow.getBounds()) || appWindowBounds;
  }

  return normalizeWindowBounds(appWindowBounds) || {
    width: DEFAULT_WINDOW_WIDTH,
    height: DEFAULT_WINDOW_HEIGHT
  };
}

function getAppPreferenceStateSnapshot() {
  return {
    theme: currentTheme,
    layoutMode,
    switchActiveView,
    verticalTranscriptPanelRatio,
    horizontalTranscriptPanelRatio,
    windowBounds: getCurrentWindowBoundsSnapshot(),
    opacity: currentOpacity,
    isMuted,
    transcriptPanelCollapsed: layoutMode === 'horizontal' ? false : isTranscriptPanelCollapsed,
    modePanelCollapsed: isModePanelCollapsed,
    translationsVisible,
    liveCaptionsWindowVisible
  };
}

function persistAppPreferencesSync() {
  if (appPreferencesPersistTimer) {
    clearTimeout(appPreferencesPersistTimer);
    appPreferencesPersistTimer = null;
  }

  try {
    fs.writeFileSync(
      getAppPreferencesStorePath(),
      JSON.stringify(getAppPreferenceStateSnapshot(), null, 2)
    );
  } catch (error) {
    console.error('[ERROR] Failed to persist app preferences:', error);
  }
}

function scheduleAppPreferencesPersist(delayMs = 250) {
  if (appPreferencesPersistTimer) {
    clearTimeout(appPreferencesPersistTimer);
  }

  appPreferencesPersistTimer = setTimeout(() => {
    appPreferencesPersistTimer = null;
    persistAppPreferencesSync();
  }, delayMs);
}

function flushAppPreferencesPersist() {
  if (appPreferencesPersistTimer) {
    clearTimeout(appPreferencesPersistTimer);
    appPreferencesPersistTimer = null;
  }

  persistAppPreferencesSync();
}

function loadAppPreferences() {
  try {
    const rawData = fs.readFileSync(getAppPreferencesStorePath(), 'utf8');
    const parsed = JSON.parse(rawData);

    currentTheme = normalizeTheme(parsed?.theme);
    layoutMode = normalizeLayoutMode(parsed?.layoutMode);
    switchActiveView = normalizeSwitchActiveView(parsed?.switchActiveView);
    verticalTranscriptPanelRatio = normalizeSplitRatio(
      parsed?.verticalTranscriptPanelRatio,
      DEFAULT_VERTICAL_TRANSCRIPT_PANEL_RATIO
    );
    horizontalTranscriptPanelRatio = normalizeSplitRatio(
      parsed?.horizontalTranscriptPanelRatio,
      DEFAULT_HORIZONTAL_TRANSCRIPT_PANEL_RATIO
    );
    appWindowBounds = normalizeWindowBounds(parsed?.windowBounds) || appWindowBounds;
    currentOpacity = normalizeOpacity(parsed?.opacity);
    isMuted = normalizeBoolean(parsed?.isMuted, false);
    isTranscriptPanelCollapsed = normalizeBoolean(parsed?.transcriptPanelCollapsed, true);
    isModePanelCollapsed = normalizeBoolean(parsed?.modePanelCollapsed, true);
    translationsVisible = normalizeBoolean(parsed?.translationsVisible, false);
    liveCaptionsWindowVisible = normalizeBoolean(parsed?.liveCaptionsWindowVisible, true);
  } catch (error) {
    currentTheme = DEFAULT_THEME;
    layoutMode = DEFAULT_LAYOUT_MODE;
    switchActiveView = DEFAULT_SWITCH_ACTIVE_VIEW;
    verticalTranscriptPanelRatio = DEFAULT_VERTICAL_TRANSCRIPT_PANEL_RATIO;
    horizontalTranscriptPanelRatio = DEFAULT_HORIZONTAL_TRANSCRIPT_PANEL_RATIO;
    appWindowBounds = {
      width: DEFAULT_WINDOW_WIDTH,
      height: DEFAULT_WINDOW_HEIGHT
    };
    currentOpacity = DEFAULT_OPACITY;
    isMuted = false;
    isTranscriptPanelCollapsed = true;
    isModePanelCollapsed = true;
    translationsVisible = false;
    liveCaptionsWindowVisible = true;
  }

  if (layoutMode === 'horizontal') {
    isTranscriptPanelCollapsed = false;
  }
}

function broadcastAppPreferences() {
  const snapshot = getAppPreferenceStateSnapshot();

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('app-preferences-updated', snapshot);
  }

  if (hotkeySettingsWindow && !hotkeySettingsWindow.isDestroyed()) {
    hotkeySettingsWindow.webContents.send('app-preferences-updated', snapshot);
  }
}

function applyNativeTheme() {
  nativeTheme.themeSource = currentTheme;
}

function getThemeWindowBackground() {
  return currentTheme === 'light' ? '#ffffff' : '#181818';
}

function applyThemeWindowBackgrounds() {
  if (hotkeySettingsWindow && !hotkeySettingsWindow.isDestroyed()) {
    hotkeySettingsWindow.setBackgroundColor(getThemeWindowBackground());
  }
}

function setAppTheme(theme) {
  currentTheme = normalizeTheme(theme);
  applyNativeTheme();
  applyThemeWindowBackgrounds();
  persistAppPreferencesSync();
  broadcastAppPreferences();
  applyWebThemeToAllTabs();
  return getAppPreferenceStateSnapshot();
}

function toggleAppTheme() {
  return setAppTheme(currentTheme === 'dark' ? 'light' : 'dark');
}

function setLayoutMode(nextLayoutMode) {
  const previousLayoutMode = layoutMode;
  layoutMode = normalizeLayoutMode(nextLayoutMode);

  if (layoutMode === 'horizontal') {
    isTranscriptPanelCollapsed = false;
  }

  if (layoutMode === 'switch' && previousLayoutMode !== 'switch') {
    switchActiveView = DEFAULT_SWITCH_ACTIVE_VIEW;
  } else {
    switchActiveView = normalizeSwitchActiveView(switchActiveView);
  }

  persistAppPreferencesSync();
  broadcastAppPreferences();
  resizeTabs();
  return getAppPreferenceStateSnapshot();
}

function cycleLayoutMode() {
  const order = ['vertical', 'horizontal', 'switch'];
  const currentIndex = Math.max(0, order.indexOf(layoutMode));
  return setLayoutMode(order[(currentIndex + 1) % order.length]);
}

function setSwitchActiveView(nextView) {
  switchActiveView = normalizeSwitchActiveView(nextView);
  persistAppPreferencesSync();
  broadcastAppPreferences();
  resizeTabs();
  return getAppPreferenceStateSnapshot();
}

function toggleSwitchActiveView() {
  if (layoutMode !== 'switch') {
    return getAppPreferenceStateSnapshot();
  }

  return setSwitchActiveView(switchActiveView === 'transcript' ? 'webview' : 'transcript');
}

function setTranslationVisible(isVisible) {
  translationsVisible = Boolean(isVisible);
  persistAppPreferencesSync();
  broadcastAppPreferences();
  return getAppPreferenceStateSnapshot();
}

async function applyLiveCaptionsVisibilityPreference() {
  if (!captionSync || typeof captionSync.setLiveCaptionsVisibility !== 'function') {
    return null;
  }

  try {
    const isVisible = await captionSync.setLiveCaptionsVisibility(liveCaptionsWindowVisible);
    if (typeof isVisible === 'boolean') {
      liveCaptionsWindowVisible = isVisible;
      persistAppPreferencesSync();
      broadcastAppPreferences();
    }
    return isVisible;
  } catch (error) {
    console.error('[WARNING] Failed to restore Live Captions window visibility:', error.message || error);
    return null;
  }
}

function ensureGlobalHotkeyState() {
  const defaults = createDefaultGlobalHotkeys();
  const nextHotkeys = {};

  for (const definition of GLOBAL_HOTKEY_DEFINITIONS) {
    const configuredHotkey = typeof globalHotkeys?.[definition.id] === 'string'
      ? globalHotkeys[definition.id].trim()
      : defaults[definition.id];

    nextHotkeys[definition.id] = configuredHotkey;
  }

  globalHotkeys = nextHotkeys;
}

function getGlobalHotkeyDefinition(id) {
  return GLOBAL_HOTKEY_DEFINITIONS.find((definition) => definition.id === id) || null;
}

function getGlobalHotkeyStateSnapshot() {
  ensureGlobalHotkeyState();

  return {
    hotkeys: GLOBAL_HOTKEY_DEFINITIONS.map((definition) => ({
      id: definition.id,
      label: definition.label,
      description: definition.description,
      defaultAccelerator: definition.defaultAccelerator,
      accelerator: globalHotkeys[definition.id] || ''
    }))
  };
}

function persistGlobalHotkeyStateSync() {
  ensureGlobalHotkeyState();

  try {
    fs.writeFileSync(
      getGlobalHotkeyStorePath(),
      JSON.stringify({ hotkeys: globalHotkeys }, null, 2)
    );
  } catch (error) {
    console.error('[ERROR] Failed to persist global hotkey state:', error);
  }
}

function loadGlobalHotkeyState() {
  try {
    const rawData = fs.readFileSync(getGlobalHotkeyStorePath(), 'utf8');
    const parsed = JSON.parse(rawData);
    globalHotkeys = {
      ...createDefaultGlobalHotkeys(),
      ...(parsed && typeof parsed.hotkeys === 'object' && parsed.hotkeys ? parsed.hotkeys : {})
    };
  } catch (error) {
    globalHotkeys = createDefaultGlobalHotkeys();
  }

  ensureGlobalHotkeyState();
}

function runGlobalHotkeyAction(id) {
  if (isHotkeySettingsWindowFocused()) {
    return;
  }

  switch (id) {
    case 'opacityUp':
      if (currentOpacity < MAX_OPACITY && mainWindow) {
        currentOpacity = Math.min(MAX_OPACITY, currentOpacity + OPACITY_STEP);
        mainWindow.setOpacity(currentOpacity);
        scheduleAppPreferencesPersist();
      }
      return;
    case 'opacityDown':
      if (currentOpacity > MIN_OPACITY && mainWindow) {
        currentOpacity = Math.max(MIN_OPACITY, currentOpacity - OPACITY_STEP);
        mainWindow.setOpacity(currentOpacity);
        scheduleAppPreferencesPersist();
      }
      return;
    case 'moveUp':
      moveWindow(0, -MOVE_DISTANCE);
      return;
    case 'moveDown':
      moveWindow(0, MOVE_DISTANCE);
      return;
    case 'moveLeft':
      moveWindow(-MOVE_DISTANCE, 0);
      return;
    case 'moveRight':
      moveWindow(MOVE_DISTANCE, 0);
      return;
    case 'toggleWindow':
      if (!mainWindow) {
        return;
      }

      if (isWindowVisible) {
        mainWindow.hide();
        isWindowVisible = false;
      } else {
        mainWindow.showInactive();
        isWindowVisible = true;
      }
      return;
    case 'captureArea':
      runShortcutAction('captureSelectedArea', () => captureSelectedArea(getCurrentDisplayId()));
      return;
    case 'sendTranscript':
      runShortcutAction('submitTranscriptToAssistant', () => submitTranscriptToAssistant());
      return;
    case 'copyTranscript':
      runShortcutAction('copyTranscriptPromptToClipboard', () => copyTranscriptPromptToClipboard());
      return;
    case 'captureScreenToAssistant':
      runShortcutAction('pasteFullScreenIntoAssistant', () => pasteFullScreenIntoAssistant());
      return;
    case 'toggleMute':
      toggleMuteAllTabs();
      return;
    case 'toggleSwitchView':
      toggleSwitchActiveView();
      return;
    default:
      console.error(`[ERROR] Unknown global hotkey action: ${id}`);
  }
}

function unregisterGlobalHotkey(id) {
  const registeredHotkey = registeredGlobalHotkeys.get(id);
  if (!registeredHotkey) {
    return;
  }

  globalShortcut.unregister(registeredHotkey);
  registeredGlobalHotkeys.delete(id);
}

function registerGlobalHotkey(id, accelerator) {
  const definition = getGlobalHotkeyDefinition(id);
  const nextAccelerator = typeof accelerator === 'string' ? accelerator.trim() : '';

  if (!definition) {
    return false;
  }

  if (!nextAccelerator) {
    unregisterGlobalHotkey(id);
    return true;
  }

  const registered = globalShortcut.register(nextAccelerator, () => {
    runGlobalHotkeyAction(id);
  });

  if (registered) {
    registeredGlobalHotkeys.set(id, nextAccelerator);
  }

  return registered;
}

function registerAllGlobalHotkeys() {
  for (const id of registeredGlobalHotkeys.keys()) {
    unregisterGlobalHotkey(id);
  }

  ensureGlobalHotkeyState();

  for (const definition of GLOBAL_HOTKEY_DEFINITIONS) {
    const accelerator = globalHotkeys[definition.id];
    if (!accelerator) {
      continue;
    }

    const registered = registerGlobalHotkey(definition.id, accelerator);
    if (!registered) {
      console.error(`[ERROR] Failed to register global hotkey "${accelerator}" for "${definition.label}"`);
    }
  }
}

function setGlobalHotkey(id, accelerator) {
  const definition = getGlobalHotkeyDefinition(id);
  if (!definition) {
    return {
      success: false,
      globalHotkeyState: getGlobalHotkeyStateSnapshot()
    };
  }

  ensureGlobalHotkeyState();

  const previousAccelerator = globalHotkeys[id] || '';
  const previousRegisteredAccelerator = registeredGlobalHotkeys.get(id) || '';
  const nextAccelerator = typeof accelerator === 'string' ? accelerator.trim() : '';
  const previousSignature = getAcceleratorSignature(previousAccelerator);
  const nextSignature = getAcceleratorSignature(nextAccelerator);

  const matchesConfiguredAccelerator = nextAccelerator === previousAccelerator || nextSignature === previousSignature;

  if (matchesConfiguredAccelerator && (!nextAccelerator || previousRegisteredAccelerator)) {
    globalHotkeys[id] = nextAccelerator;
    persistGlobalHotkeyStateSync();
    return {
      success: true,
      globalHotkeyState: getGlobalHotkeyStateSnapshot()
    };
  }

  if (nextAccelerator && getAcceleratorSignature(nextAccelerator) !== getAcceleratorSignature(previousRegisteredAccelerator)) {
    let registered = false;
    try {
      registered = globalShortcut.register(nextAccelerator, () => {
        runGlobalHotkeyAction(id);
      });
    } catch (error) {
      console.error('[ERROR] Failed to register global hotkey:', error);
      registered = false;
    }

    if (!registered) {
      return {
        success: false,
        globalHotkeyState: getGlobalHotkeyStateSnapshot()
      };
    }

    if (previousRegisteredAccelerator) {
      globalShortcut.unregister(previousRegisteredAccelerator);
    }
    registeredGlobalHotkeys.set(id, nextAccelerator);
  } else if (!nextAccelerator) {
    unregisterGlobalHotkey(id);
  }

  globalHotkeys[id] = nextAccelerator;
  persistGlobalHotkeyStateSync();

  return {
    success: true,
    globalHotkeyState: getGlobalHotkeyStateSnapshot()
  };
}

function getHotkeyKeyFromInput(input) {
  const key = typeof input?.key === 'string' ? input.key : '';

  switch (key) {
    case 'ArrowUp':
    case 'Up':
      return 'Up';
    case 'ArrowDown':
    case 'Down':
      return 'Down';
    case 'ArrowLeft':
    case 'Left':
      return 'Left';
    case 'ArrowRight':
    case 'Right':
      return 'Right';
    case ' ':
    case 'Spacebar':
      return 'Space';
    case 'Esc':
      return 'Escape';
    case 'Del':
      return 'Delete';
    default:
      if (/^F([1-9]|1[0-9]|2[0-4])$/i.test(key)) {
        return key.toUpperCase();
      }

      if (key.length === 1) {
        return key.toUpperCase();
      }

      return key;
  }
}

function getAcceleratorSignature(accelerator) {
  const parts = typeof accelerator === 'string'
    ? accelerator.split('+').map((part) => part.trim()).filter(Boolean)
    : [];

  if (parts.length === 0) {
    return '';
  }

  const keyPart = parts[parts.length - 1];
  const modifierOrder = ['CommandOrControl', 'Alt', 'Shift', 'Super'];
  const modifiers = new Set(parts.slice(0, -1));
  const normalizedModifiers = modifierOrder.filter((modifier) => modifiers.has(modifier));

  return [...normalizedModifiers, keyPart].join('+');
}

function acceleratorMatchesInput(accelerator, input) {
  const parts = typeof accelerator === 'string'
    ? accelerator.split('+').map((part) => part.trim()).filter(Boolean)
    : [];

  if (parts.length === 0) {
    return false;
  }

  const modifierParts = new Set(parts.slice(0, -1));
  const keyPart = parts[parts.length - 1];
  const inputKey = getHotkeyKeyFromInput(input);
  const wantsPrimary = modifierParts.has('CommandOrControl');
  const wantsAlt = modifierParts.has('Alt');
  const wantsShift = modifierParts.has('Shift');
  const wantsSuper = modifierParts.has('Super');
  const hasPrimary = Boolean(input.control || input.meta);

  if (keyPart !== inputKey) {
    return false;
  }

  if (wantsPrimary ? !hasPrimary : Boolean(input.control)) {
    return false;
  }

  if (wantsSuper ? !input.meta : Boolean(input.meta && !wantsPrimary)) {
    return false;
  }

  return Boolean(input.alt) === wantsAlt && Boolean(input.shift) === wantsShift;
}

function getGlobalHotkeyIdFromInput(input) {
  ensureGlobalHotkeyState();

  for (const definition of GLOBAL_HOTKEY_DEFINITIONS) {
    const accelerator = globalHotkeys[definition.id];
    if (acceleratorMatchesInput(accelerator, input)) {
      return definition.id;
    }
  }

  return null;
}

function unregisterModeHotkey(modeId) {
  const registeredHotkey = registeredModeHotkeys.get(modeId);
  if (!registeredHotkey) {
    return;
  }

  globalShortcut.unregister(registeredHotkey);
  registeredModeHotkeys.delete(modeId);
}

function registerModeHotkey(modeId, hotkey) {
  const accelerator = typeof hotkey === 'string' ? hotkey.trim() : '';
  if (!accelerator) {
    unregisterModeHotkey(modeId);
    return true;
  }

  const registered = globalShortcut.register(accelerator, () => {
    if (isHotkeySettingsWindowFocused()) {
      return;
    }

    selectPromptMode(modeId);
  });

  if (registered) {
    registeredModeHotkeys.set(modeId, accelerator);
  }

  return registered;
}

function registerAllModeHotkeys() {
  for (const modeId of registeredModeHotkeys.keys()) {
    unregisterModeHotkey(modeId);
  }

  ensurePromptModeState();

  for (const mode of promptModes) {
    if (!mode.hotkey) {
      continue;
    }

    const registered = registerModeHotkey(mode.id, mode.hotkey);
    if (!registered) {
      console.error(`[ERROR] Failed to register stored hotkey "${mode.hotkey}" for mode "${mode.name}"`);
    }
  }
}

function persistPromptModeState() {
  pendingPromptModePersistPayload = serializePromptModeStateSnapshot();

  if (promptModePersistTimer) {
    clearTimeout(promptModePersistTimer);
  }

  promptModePersistTimer = setTimeout(() => {
    promptModePersistTimer = null;
    void flushPromptModeStatePersist();
  }, 150);
}

async function flushPromptModeStatePersist() {
  if (promptModePersistInFlight || !pendingPromptModePersistPayload) {
    return;
  }

  promptModePersistInFlight = true;
  const payload = pendingPromptModePersistPayload;
  pendingPromptModePersistPayload = null;

  try {
    const storePath = getPromptModeStorePath();
    await fs.promises.mkdir(path.dirname(storePath), { recursive: true });
    await fs.promises.writeFile(storePath, payload, 'utf8');
  } catch (error) {
    console.error('[ERROR] Failed to save prompt mode state:', error);
  } finally {
    promptModePersistInFlight = false;

    if (pendingPromptModePersistPayload) {
      void flushPromptModeStatePersist();
    }
  }
}

function flushPromptModeStatePersistSync() {
  if (promptModePersistTimer) {
    clearTimeout(promptModePersistTimer);
    promptModePersistTimer = null;
  }

  pendingPromptModePersistPayload = null;

  try {
    const storePath = getPromptModeStorePath();
    fs.mkdirSync(path.dirname(storePath), { recursive: true });
    fs.writeFileSync(storePath, serializePromptModeStateSnapshot(), 'utf8');
  } catch (error) {
    console.error('[ERROR] Failed to flush prompt mode state:', error);
  }
}

function loadPromptModeState() {
  try {
    const storePath = getPromptModeStorePath();
    if (!fs.existsSync(storePath)) {
      ensurePromptModeState();
      return;
    }

    const raw = fs.readFileSync(storePath, 'utf8');
    const parsed = JSON.parse(raw);
    promptModes = Array.isArray(parsed?.promptModes) ? parsed.promptModes : createDefaultPromptModes();
    selectedPromptModeId = typeof parsed?.selectedPromptModeId === 'string'
      ? parsed.selectedPromptModeId
      : createDefaultPromptModes()[0].id;
    ensurePromptModeState();
  } catch (error) {
    console.error('[ERROR] Failed to load prompt mode state:', error);
    promptModes = createDefaultPromptModes();
    selectedPromptModeId = promptModes[0].id;
  }
}

function getNextPromptModeName() {
  ensurePromptModeState();

  let nextIndex = 1;
  while (promptModes.some((mode) => mode.name === `Mode ${nextIndex}`)) {
    nextIndex += 1;
  }

  return `Mode ${nextIndex}`;
}

function addPromptMode() {
  ensurePromptModeState();

  const newMode = {
    id: createPromptModeId(),
    name: getNextPromptModeName(),
    suffix: '',
    hotkey: ''
  };

  promptModes.push(newMode);
  selectedPromptModeId = newMode.id;
  persistPromptModeState();
  broadcastPromptModeState();
  return getPromptModeStateSnapshot();
}

function deletePromptMode(modeId) {
  ensurePromptModeState();

  const modeIndex = promptModes.findIndex((entry) => entry.id === modeId);
  if (modeIndex === -1) {
    throw new Error(`Prompt mode "${modeId}" was not found.`);
  }

  if (promptModes.length <= 1) {
    return getPromptModeStateSnapshot();
  }

  unregisterModeHotkey(modeId);
  promptModes.splice(modeIndex, 1);

  if (selectedPromptModeId === modeId) {
    const fallbackMode = promptModes[modeIndex] || promptModes[modeIndex - 1] || promptModes[0];
    selectedPromptModeId = fallbackMode?.id || promptModes[0].id;
  }

  persistPromptModeState();
  broadcastPromptModeState();
  return getPromptModeStateSnapshot();
}

function selectPromptMode(modeId) {
  ensurePromptModeState();

  if (typeof modeId === 'string' && promptModes.some((mode) => mode.id === modeId)) {
    selectedPromptModeId = modeId;
    persistPromptModeState();
    broadcastPromptModeState();
  }

  return getPromptModeStateSnapshot();
}

function savePromptMode(modeId, suffix) {
  ensurePromptModeState();

  const mode = promptModes.find((entry) => entry.id === modeId);
  if (!mode) {
    throw new Error(`Prompt mode "${modeId}" was not found.`);
  }

  mode.suffix = typeof suffix === 'string' ? suffix : '';
  persistPromptModeState();
  broadcastPromptModeState();
  return getPromptModeStateSnapshot();
}

function renamePromptMode(modeId, name) {
  ensurePromptModeState();

  const mode = promptModes.find((entry) => entry.id === modeId);
  if (!mode) {
    throw new Error(`Prompt mode "${modeId}" was not found.`);
  }

  const trimmedName = typeof name === 'string' ? name.trim() : '';
  if (trimmedName) {
    mode.name = trimmedName;
    persistPromptModeState();
    broadcastPromptModeState();
  }

  return getPromptModeStateSnapshot();
}

function setPromptModeHotkey(modeId, hotkey) {
  ensurePromptModeState();

  const mode = promptModes.find((entry) => entry.id === modeId);
  if (!mode) {
    throw new Error(`Prompt mode "${modeId}" was not found.`);
  }

  const previousHotkey = typeof mode.hotkey === 'string' ? mode.hotkey.trim() : '';
  const nextHotkey = typeof hotkey === 'string' ? hotkey.trim() : '';

  if (nextHotkey === previousHotkey) {
    return {
      success: true,
      promptModeState: getPromptModeStateSnapshot()
    };
  }

  unregisterModeHotkey(modeId);

  if (nextHotkey) {
    let registered = false;

    try {
      registered = registerModeHotkey(modeId, nextHotkey);
    } catch (error) {
      console.error('[ERROR] Failed to register prompt mode hotkey:', error);
      registered = false;
    }

    if (!registered) {
      if (previousHotkey) {
        registerModeHotkey(modeId, previousHotkey);
      }

      return {
        success: false,
        promptModeState: getPromptModeStateSnapshot()
      };
    }
  }

  mode.hotkey = nextHotkey;
  persistPromptModeState();
  broadcastPromptModeState();

  return {
    success: true,
    promptModeState: getPromptModeStateSnapshot()
  };
}

function createWindow() {
  const restoredBounds = getRestoredWindowBounds();

  mainWindow = new BrowserWindow({
    ...restoredBounds,
    title: WINDOW_TITLE,
    minWidth: 400,
    minHeight: 300,
    resizable: true,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    },
    backgroundColor: '#00000000',
    opacity: currentOpacity,
    hasShadow: false
  });

  mainWindow.setContentProtection(true);
  mainWindow.setVisibleOnAllWorkspaces(false, { visibleOnFullScreen: false });
  
  mainWindow.loadFile('index.html');

  mainWindow.once('closed', () => {
    mainWindow = null;
  });

  setupGlobalShortcuts();
}

function getCenteredHotkeySettingsBounds(width, height) {
  const targetBounds = mainWindow && !mainWindow.isDestroyed()
    ? mainWindow.getBounds()
    : screen.getPrimaryDisplay().workArea;

  return {
    x: Math.round(targetBounds.x + (targetBounds.width - width) / 2),
    y: Math.round(targetBounds.y + (targetBounds.height - height) / 2),
    width,
    height
  };
}

function openHotkeySettingsWindow() {
  const width = 430;
  const height = 540;

  if (hotkeySettingsWindow && !hotkeySettingsWindow.isDestroyed()) {
    const bounds = getCenteredHotkeySettingsBounds(width, height);
    hotkeySettingsWindow.setBounds(bounds);
    hotkeySettingsWindow.setBackgroundColor(getThemeWindowBackground());
    hotkeySettingsWindow.show();
    hotkeySettingsWindow.focus();
    return true;
  }

  const bounds = getCenteredHotkeySettingsBounds(width, height);
  hotkeySettingsWindow = new BrowserWindow({
    ...bounds,
    width,
    height,
    minWidth: 380,
    minHeight: 420,
    frame: false,
    resizable: true,
    movable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    show: false,
    backgroundColor: getThemeWindowBackground(),
    modal: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  hotkeySettingsWindow.setAlwaysOnTop(true, 'screen-saver');
  hotkeySettingsWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  hotkeySettingsWindow.setMenuBarVisibility(false);
  if (typeof hotkeySettingsWindow.removeMenu === 'function') {
    hotkeySettingsWindow.removeMenu();
  }

  hotkeySettingsWindow.once('ready-to-show', () => {
    if (hotkeySettingsWindow && !hotkeySettingsWindow.isDestroyed()) {
      hotkeySettingsWindow.show();
      hotkeySettingsWindow.focus();
    }
  });

  hotkeySettingsWindow.once('closed', () => {
    hotkeySettingsWindow = null;
  });

  hotkeySettingsWindow.loadFile('hotkey-settings.html').catch((error) => {
    console.error('[ERROR] Failed to load hotkey settings window:', error);
  });

  return true;
}

function isHotkeySettingsWindowFocused() {
  return Boolean(
    hotkeySettingsWindow
    && !hotkeySettingsWindow.isDestroyed()
    && hotkeySettingsWindow.isFocused()
  );
}

function scheduleCaptionSyncStart(delayMs = 250) {
  if (!captionSync || process.platform !== 'win32') {
    return;
  }

  if (captionSyncStartTimer) {
    clearTimeout(captionSyncStartTimer);
    captionSyncStartTimer = null;
  }

  captionSyncStartTimer = setTimeout(() => {
    captionSyncStartTimer = null;
    captionSync.start()
      .then(() => applyLiveCaptionsVisibilityPreference())
      .catch((error) => {
        console.error('[ERROR] Failed to start caption sync:', error);
      });
  }, delayMs);
}

function getWebThemeCss() {
  if (currentTheme === 'light') {
    return `
      :root { color-scheme: light !important; }
      html[data-interview-buddy-theme="light"] body {
        background-color: #ffffff !important;
        color: #171717 !important;
      }
    `;
  }

  return `
    :root { color-scheme: dark !important; }
    html[data-interview-buddy-theme="dark"] body {
      background-color: #0f0f0f !important;
      color: #f4f4f4 !important;
    }
  `;
}

function applyWebThemeToTab(tabId) {
  const tab = tabs.get(tabId);
  if (!tab || !tab.view || !tab.view.webContents || tab.view.webContents.isDestroyed()) {
    return;
  }

  const theme = currentTheme;
  const css = getWebThemeCss();
  const script = `
    (() => {
      const id = 'interview-buddy-theme-style';
      let style = document.getElementById(id);
      if (!style) {
        style = document.createElement('style');
        style.id = id;
        document.documentElement.appendChild(style);
      }
      style.textContent = ${JSON.stringify(css)};
      document.documentElement.dataset.interviewBuddyTheme = ${JSON.stringify(theme)};
      document.documentElement.style.colorScheme = ${JSON.stringify(theme)};
    })();
  `;

  tab.view.webContents.executeJavaScript(script, true).catch((error) => {
    console.error('[WARNING] Failed to apply web theme:', error.message || error);
  });
}

function applyWebThemeToAllTabs() {
  for (const tabId of tabs.keys()) {
    applyWebThemeToTab(tabId);
  }
}

function getLayoutDimensions() {
  const bounds = mainWindow.getBounds();
  const totalOffset = (BORDER_WIDTH + PADDING_WIDTH) * 2;
  const totalContentWidth = Math.max(0, bounds.width - totalOffset);
  const totalContentHeight = Math.max(0, bounds.height - totalOffset);
  const modePanelHeight = isModePanelCollapsed ? MODE_PANEL_COLLAPSED_HEIGHT : MODE_PANEL_HEIGHT;
  const switchTabsHeight = layoutMode === 'switch' ? SWITCH_VIEW_TABS_HEIGHT : 0;
  const browserContainerHeight = Math.max(0, totalContentHeight - APP_HEADBAR_HEIGHT - switchTabsHeight - modePanelHeight);
  const contentX = BORDER_WIDTH + PADDING_WIDTH;
  const contentY = BORDER_WIDTH + PADDING_WIDTH + APP_HEADBAR_HEIGHT + switchTabsHeight;

  if (browserContainerHeight <= 0 || totalContentWidth <= 0) {
    return {
      transcriptPanelHeight: 0,
      transcriptPanelWidth: 0,
      browserPanelHeight: 0,
      browserPanelWidth: 0,
      browserViewX: -9999,
      browserViewY: -9999,
      browserViewWidth: totalContentWidth,
      browserViewHeight: 0
    };
  }

  if (layoutMode === 'switch') {
    const browserViewHeight = Math.max(0, browserContainerHeight - TAB_BAR_HEIGHT - URL_BAR_HEIGHT);

    return {
      transcriptPanelHeight: browserContainerHeight,
      transcriptPanelWidth: totalContentWidth,
      browserPanelHeight: browserContainerHeight,
      browserPanelWidth: totalContentWidth,
      browserViewX: switchActiveView === 'webview' ? contentX : -9999,
      browserViewY: switchActiveView === 'webview' ? contentY + TAB_BAR_HEIGHT + URL_BAR_HEIGHT : -9999,
      browserViewWidth: switchActiveView === 'webview' ? totalContentWidth : 0,
      browserViewHeight: switchActiveView === 'webview' ? browserViewHeight : 0
    };
  }

  if (layoutMode === 'horizontal') {
    const adjustableWidth = Math.max(0, totalContentWidth - PANEL_DIVIDER_WIDTH);
    if (adjustableWidth <= 0) {
      return {
        transcriptPanelHeight: browserContainerHeight,
        transcriptPanelWidth: 0,
        browserPanelHeight: browserContainerHeight,
        browserPanelWidth: 0,
        browserViewX: -9999,
        browserViewY: -9999,
        browserViewWidth: 0,
        browserViewHeight: 0
      };
    }

    let minTranscriptWidth = MIN_TRANSCRIPT_PANEL_WIDTH;
    let minBrowserPanelWidth = MIN_BROWSER_PANEL_WIDTH;

    if (adjustableWidth < (minTranscriptWidth + minBrowserPanelWidth)) {
      const fallbackWidth = Math.floor(adjustableWidth / 2);
      minTranscriptWidth = Math.min(minTranscriptWidth, fallbackWidth);
      minBrowserPanelWidth = Math.min(minBrowserPanelWidth, Math.max(0, adjustableWidth - minTranscriptWidth));
    }

    const maxTranscriptWidth = Math.max(minTranscriptWidth, adjustableWidth - minBrowserPanelWidth);
    const normalizedRatio = Number.isFinite(horizontalTranscriptPanelRatio)
      ? horizontalTranscriptPanelRatio
      : DEFAULT_HORIZONTAL_TRANSCRIPT_PANEL_RATIO;
    const desiredTranscriptWidth = adjustableWidth * normalizedRatio;
    const transcriptPanelWidth = Math.round(Math.min(
      maxTranscriptWidth,
      Math.max(minTranscriptWidth, desiredTranscriptWidth)
    ));
    horizontalTranscriptPanelRatio = transcriptPanelWidth / adjustableWidth;

    const browserPanelWidth = Math.max(0, adjustableWidth - transcriptPanelWidth);
    const browserViewHeight = Math.max(0, browserContainerHeight - TAB_BAR_HEIGHT - URL_BAR_HEIGHT);

    return {
      transcriptPanelHeight: browserContainerHeight,
      transcriptPanelWidth,
      browserPanelHeight: browserContainerHeight,
      browserPanelWidth,
      browserViewX: contentX + transcriptPanelWidth + PANEL_DIVIDER_WIDTH,
      browserViewY: contentY + TAB_BAR_HEIGHT + URL_BAR_HEIGHT,
      browserViewWidth: browserPanelWidth,
      browserViewHeight
    };
  }

  const adjustableHeight = Math.max(0, browserContainerHeight - PANEL_DIVIDER_WIDTH);
  if (adjustableHeight <= 0) {
    return {
      transcriptPanelHeight: 0,
      transcriptPanelWidth: totalContentWidth,
      browserPanelHeight: 0,
      browserPanelWidth: totalContentWidth,
      browserViewX: -9999,
      browserViewY: -9999,
      browserViewWidth: totalContentWidth,
      browserViewHeight: 0
    };
  }

  let transcriptPanelHeight = Math.min(TRANSCRIPT_PANEL_COLLAPSED_HEIGHT, adjustableHeight);

  if (!isTranscriptPanelCollapsed) {
    let minTranscriptHeight = MIN_TRANSCRIPT_PANEL_HEIGHT;
    let minBrowserPanelHeight = MIN_BROWSER_PANEL_HEIGHT;

    if (adjustableHeight < (minTranscriptHeight + minBrowserPanelHeight)) {
      const fallbackHeight = Math.floor(adjustableHeight / 2);
      minTranscriptHeight = Math.min(minTranscriptHeight, fallbackHeight);
      minBrowserPanelHeight = Math.min(minBrowserPanelHeight, Math.max(0, adjustableHeight - minTranscriptHeight));
    }

    const maxTranscriptHeight = Math.max(minTranscriptHeight, adjustableHeight - minBrowserPanelHeight);
    const normalizedRatio = Number.isFinite(verticalTranscriptPanelRatio)
      ? verticalTranscriptPanelRatio
      : DEFAULT_VERTICAL_TRANSCRIPT_PANEL_RATIO;
    const desiredTranscriptHeight = adjustableHeight * normalizedRatio;
    transcriptPanelHeight = Math.round(Math.min(
      maxTranscriptHeight,
      Math.max(minTranscriptHeight, desiredTranscriptHeight)
    ));
    verticalTranscriptPanelRatio = transcriptPanelHeight / adjustableHeight;
  }

  const browserPanelHeight = Math.max(0, adjustableHeight - transcriptPanelHeight);
  const browserViewY = contentY + transcriptPanelHeight + PANEL_DIVIDER_WIDTH + TAB_BAR_HEIGHT + URL_BAR_HEIGHT;
  const browserViewHeight = Math.max(0, browserPanelHeight - TAB_BAR_HEIGHT - URL_BAR_HEIGHT);

  return {
    transcriptPanelHeight,
    transcriptPanelWidth: totalContentWidth,
    browserPanelHeight,
    browserPanelWidth: totalContentWidth,
    browserViewX: contentX,
    browserViewY,
    browserViewWidth: totalContentWidth,
    browserViewHeight
  };
}

function getInitialTabTitle(url, deferLoad = false) {
  if (!deferLoad || !url || url === 'about:blank') {
    return 'New Tab';
  }

  try {
    return new URL(url).hostname.replace(/^www\./, '') || 'New Tab';
  } catch (error) {
    return 'New Tab';
  }
}

function loadPendingTab(tabId) {
  const tab = tabs.get(tabId);
  if (!tab || !tab.pendingUrl || !tab.view || !tab.view.webContents || tab.view.webContents.isDestroyed()) {
    return false;
  }

  const nextUrl = tab.pendingUrl;
  tab.pendingUrl = null;
  tab.view.webContents.loadURL(nextUrl);
  return true;
}

function scheduleDefaultTabWarmup(delayMs = 1200) {
  if (defaultTabWarmupTimer) {
    clearTimeout(defaultTabWarmupTimer);
  }

  defaultTabWarmupTimer = setTimeout(() => {
    defaultTabWarmupTimer = null;

    for (const [tabId, tab] of tabs.entries()) {
      if (tab && tab.pendingUrl) {
        loadPendingTab(tabId);
      }
    }
  }, delayMs);
}

function createNewTab(url = 'about:blank', options = {}) {
  const requestedUrl = url || 'about:blank';
  const shouldDeferLoad = Boolean(options.deferLoad && requestedUrl !== 'about:blank');
  const shouldActivate = activeTabId === null || options.activate !== false;
  const tabId = tabIdCounter++;
  const layout = getLayoutDimensions();
  
  const tabView = new BrowserView({
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    }
  });
  
  // Set up window open handler immediately to prevent popups
  tabView.webContents.setWindowOpenHandler(({ url }) => {
    // HTTP(S) stays in this tab; custom protocols (e.g. spotify:) go to OS handler
    if (url && (url.startsWith('http:') || url.startsWith('https:'))) {
      tabView.webContents.loadURL(url);
    } else if (url) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  if (shouldActivate) {
    mainWindow.setBrowserView(tabView);

    tabView.setBounds({
      x: layout.browserViewX,
      y: layout.browserViewY,
      width: layout.browserViewWidth,
      height: layout.browserViewHeight
    });
  } else {
    tabView.setBounds({ x: -9999, y: -9999, width: 0, height: 0 });
  }
  
  const tabData = {
    id: tabId,
    view: tabView,
    url: requestedUrl,
    title: getInitialTabTitle(requestedUrl, shouldDeferLoad),
    canGoBack: false,
    canGoForward: false,
    isLoading: false,
    pendingUrl: shouldDeferLoad ? requestedUrl : null
  };
  
  tabs.set(tabId, tabData);
  
  if (shouldActivate && activeTabId !== null) {
    const prevTab = tabs.get(activeTabId);
    if (prevTab) {
      prevTab.view.setBounds({ x: -9999, y: -9999, width: 0, height: 0 });
    }
  }
  
  if (shouldActivate) {
    activeTabId = tabId;
  }

  tabView.webContents.setAudioMuted(isMuted);
  if (!shouldDeferLoad) {
    tabView.webContents.loadURL(requestedUrl);
  }
  applyWebThemeToTab(tabId);

  setupTabListeners(tabId, tabView);
  
  mainWindow.webContents.send('tab-created', {
    id: tabId,
    title: tabData.title,
    url: requestedUrl,
    active: shouldActivate
  });
  scheduleAppPreferencesPersist();

  return tabId;
}

function setupTabListeners(tabId, tabView) {
  const webContents = tabView.webContents;
  
  webContents.on('did-start-loading', () => {
    const tab = tabs.get(tabId);
    if (tab) {
      tab.isLoading = true;
      mainWindow.webContents.send('tab-loading', { id: tabId, loading: true });
    }
  });
  
  webContents.on('did-stop-loading', () => {
    const tab = tabs.get(tabId);
    if (tab) {
      tab.isLoading = false;
      mainWindow.webContents.send('tab-loading', { id: tabId, loading: false });
    }
  });
  
  webContents.on('did-finish-load', () => {
    const tab = tabs.get(tabId);
    if (tab) {
      applyWebThemeToTab(tabId);
      const url = webContents.getURL();
      const title = webContents.getTitle();
      tab.url = url;
      tab.title = title || 'New Tab';
      tab.canGoBack = webContents.navigationHistory.canGoBack();
      tab.canGoForward = webContents.navigationHistory.canGoForward();
      
      mainWindow.webContents.send('tab-updated', {
        id: tabId,
        title: tab.title,
        url: tab.url,
        canGoBack: tab.canGoBack,
        canGoForward: tab.canGoForward
      });
      scheduleAppPreferencesPersist();
    }
  });
  
  webContents.on('page-title-updated', (event, title) => {
    const tab = tabs.get(tabId);
    if (tab) {
      tab.title = title;
      mainWindow.webContents.send('tab-title-updated', { id: tabId, title: title });
      scheduleAppPreferencesPersist();
    }
  });
  
  webContents.on('did-navigate', (event, url) => {
    const tab = tabs.get(tabId);
    if (tab) {
      tab.url = url;
      tab.canGoBack = webContents.navigationHistory.canGoBack();
      tab.canGoForward = webContents.navigationHistory.canGoForward();
      mainWindow.webContents.send('tab-navigated', {
        id: tabId,
        url: url,
        canGoBack: tab.canGoBack,
        canGoForward: tab.canGoForward
      });
      scheduleAppPreferencesPersist();
    }
  });

  webContents.on('before-input-event', (event, input) => {
    if (tabId !== activeTabId || input.type !== 'keyDown') return;

    const key = typeof input.key === 'string' ? input.key : '';
    const lowerKey = key.toLowerCase();
    const hasPrimaryModifier = Boolean(input.control || input.meta);
    const isAltNavigationLeft = Boolean(input.alt) && (key === 'ArrowLeft' || key === 'Left');
    const isAltNavigationRight = Boolean(input.alt) && (key === 'ArrowRight' || key === 'Right');
    const globalHotkeyId = getGlobalHotkeyIdFromInput(input);

    if (globalHotkeyId) {
      event.preventDefault();
      runGlobalHotkeyAction(globalHotkeyId);
      return;
    }

    if (hasPrimaryModifier && lowerKey === 't') {
      event.preventDefault();
      createNewTab('about:blank');
      return;
    }

    if (hasPrimaryModifier && lowerKey === 'r') {
      event.preventDefault();
      webContents.reload();
      return;
    }

    if (hasPrimaryModifier && lowerKey === 'w') {
      event.preventDefault();
      closeTab(tabId);
      return;
    }

    if (hasPrimaryModifier && lowerKey === 'l') {
      event.preventDefault();
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('focus-url-input');
      }
      return;
    }

    if (isAltNavigationLeft) {
      event.preventDefault();
      if (webContents.navigationHistory.canGoBack()) {
        webContents.navigationHistory.goBack();
      }
      return;
    }

    if (isAltNavigationRight) {
      event.preventDefault();
      if (webContents.navigationHistory.canGoForward()) {
        webContents.navigationHistory.goForward();
      }
      return;
    }
  });

  webContents.on('dom-ready', () => {
    applyWebThemeToTab(tabId);
  });
  
  // Handle new-window event (legacy, but still needed for some cases)
  webContents.on('new-window', (event, navigationUrl) => {
    event.preventDefault();
    // HTTP(S) stays in this tab; custom protocols (e.g. spotify:) go to OS handler
    if (navigationUrl && (navigationUrl.startsWith('http:') || navigationUrl.startsWith('https:'))) {
      webContents.loadURL(navigationUrl);
    } else if (navigationUrl) {
      shell.openExternal(navigationUrl);
    }
  });
}

function switchTab(tabId) {
  if (!tabs.has(tabId) || activeTabId === tabId) return;
  
  const prevTab = tabs.get(activeTabId);
  if (prevTab) {
    prevTab.view.setBounds({ x: -9999, y: -9999, width: 0, height: 0 });
  }
  
  activeTabId = tabId;
  const tab = tabs.get(tabId);
  if (tab) {
    const layout = getLayoutDimensions();
    
    mainWindow.setBrowserView(tab.view);
    tab.view.setBounds({
      x: layout.browserViewX,
      y: layout.browserViewY,
      width: layout.browserViewWidth,
      height: layout.browserViewHeight
    });

    if (tab.pendingUrl) {
      loadPendingTab(tabId);
    }
    
    mainWindow.webContents.send('tab-switched', {
      id: tabId,
      url: tab.url,
      title: tab.title,
      canGoBack: tab.canGoBack,
      canGoForward: tab.canGoForward
    });
    scheduleAppPreferencesPersist();
  }
}

function closeTab(tabId) {
  if (!tabs.has(tabId)) return;
  
  const tab = tabs.get(tabId);
  const wasActive = activeTabId === tabId;
  
  tab.view.webContents.destroy();
  tabs.delete(tabId);
  
  if (wasActive) {
    if (tabs.size > 0) {
      const remainingTabs = Array.from(tabs.keys());
      const replacementTabId = remainingTabs[remainingTabs.length - 1];
      activeTabId = null;
      switchTab(replacementTabId);
    } else {
      activeTabId = null;
      mainWindow.setBrowserView(null);
      createDefaultTabs();
    }
  }

  mainWindow.webContents.send('tab-closed', { id: tabId });
  scheduleAppPreferencesPersist();
}

function resizeTabs() {
  if (activeTabId === null) return;
  
  const layout = getLayoutDimensions();
  const activeTab = tabs.get(activeTabId);
  if (activeTab) {
    activeTab.view.setBounds({
      x: layout.browserViewX,
      y: layout.browserViewY,
      width: layout.browserViewWidth,
      height: layout.browserViewHeight
    });
  }
}

function createDefaultTabs() {
  const firstTabId = createNewTab(DEFAULT_TAB_URLS[0], { activate: true });
  for (const url of DEFAULT_TAB_URLS.slice(1)) {
    createNewTab(url, { activate: false, deferLoad: true });
  }
  scheduleDefaultTabWarmup();
  switchTab(firstTabId);
}

function moveWindow(deltaX, deltaY) {
  if (!mainWindow) return;
  const bounds = mainWindow.getBounds();
  mainWindow.setPosition(bounds.x + deltaX, bounds.y + deltaY);
  scheduleAppPreferencesPersist();
}

function getCurrentDisplayId() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return null;
  }

  const currentDisplay = screen.getDisplayMatching(mainWindow.getBounds());
  return currentDisplay ? currentDisplay.id : null;
}

function normalizeScreenSelectionRect(rect) {
  if (!rect || typeof rect !== 'object') {
    return null;
  }

  const x = Number(rect.x);
  const y = Number(rect.y);
  const width = Number(rect.width);
  const height = Number(rect.height);

  if (![x, y, width, height].every(Number.isFinite)) {
    return null;
  }

  return {
    x: Math.round(x),
    y: Math.round(y),
    width: Math.max(0, Math.round(width)),
    height: Math.max(0, Math.round(height))
  };
}

function resolveScreenSelection(selectionRect = null) {
  if (!captureOverlayState) {
    return;
  }

  const state = captureOverlayState;
  captureOverlayState = null;

  if (state.window && !state.window.isDestroyed()) {
    if (state.onClosed) {
      state.window.removeListener('closed', state.onClosed);
    }
    state.window.close();
  }

  if (!selectionRect) {
    state.resolve(null);
    return;
  }

  const normalizedSelection = normalizeScreenSelectionRect(selectionRect);
  if (
    !normalizedSelection
    || normalizedSelection.width < SCREEN_SELECTION_MIN_SIZE
    || normalizedSelection.height < SCREEN_SELECTION_MIN_SIZE
  ) {
    state.resolve(null);
    return;
  }

  state.resolve({
    x: state.display.bounds.x + normalizedSelection.x,
    y: state.display.bounds.y + normalizedSelection.y,
    width: normalizedSelection.width,
    height: normalizedSelection.height
  });
}

function openScreenSelectionOverlay(targetDisplay) {
  if (captureOverlayState) {
    return Promise.resolve(null);
  }

  return new Promise((resolve) => {
    const overlayWindow = new BrowserWindow({
      x: targetDisplay.bounds.x,
      y: targetDisplay.bounds.y,
      width: targetDisplay.bounds.width,
      height: targetDisplay.bounds.height,
      frame: false,
      transparent: true,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      focusable: true,
      show: false,
      hasShadow: false,
      backgroundColor: '#00000000',
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false,
        spellcheck: false
      }
    });

    overlayWindow.setAlwaysOnTop(true, 'screen-saver');
    overlayWindow.setContentProtection(true);
    overlayWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    overlayWindow.setMenuBarVisibility(false);
    if (typeof overlayWindow.removeMenu === 'function') {
      overlayWindow.removeMenu();
    }

    const onClosed = () => {
      if (captureOverlayState && captureOverlayState.window === overlayWindow) {
        captureOverlayState = null;
        resolve(null);
      }
    };

    captureOverlayState = {
      window: overlayWindow,
      resolve,
      display: targetDisplay,
      onClosed
    };

    overlayWindow.once('closed', onClosed);

    overlayWindow.once('ready-to-show', () => {
      overlayWindow.show();
      overlayWindow.focus();
    });

    overlayWindow.loadFile('capture-overlay.html').catch((error) => {
      console.error('[ERROR] Failed to load screen selection overlay:', error);

      if (captureOverlayState && captureOverlayState.window === overlayWindow) {
        captureOverlayState = null;
      }

      if (!overlayWindow.isDestroyed()) {
        overlayWindow.destroy();
      }

      resolve(null);
    });
  });
}

async function captureSelectedArea(displayId = null) {
  try {
    const preparedCapture = await screenCapture.prepareDisplayCapture(displayId);
    const selectionBounds = await openScreenSelectionOverlay(preparedCapture.display);

    if (!selectionBounds) {
      return false;
    }

    await screenCapture.captureArea(selectionBounds, displayId, preparedCapture);
    return true;
  } catch (error) {
    console.error('[ERROR] Selected area capture failed:', error);
    return false;
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function runShortcutAction(name, action, cooldownMs = 500) {
  const now = Date.now();
  const previousRunAt = shortcutCooldowns.get(name) || 0;
  if (now - previousRunAt < cooldownMs) {
    return;
  }

  shortcutCooldowns.set(name, now);

  Promise.resolve()
    .then(action)
    .catch((error) => {
      console.error(`[ERROR] Shortcut action failed (${name}):`, error);
    })
    .finally(() => {
      setTimeout(() => {
        if (shortcutCooldowns.get(name) === now) {
          shortcutCooldowns.delete(name);
        }
      }, cooldownMs);
    });
}

function getActiveTabWebContents() {
  if (activeTabId === null) {
    console.error('[ERROR] No active tab is available');
    return null;
  }

  const activeTab = tabs.get(activeTabId);
  if (!activeTab || !activeTab.view || !activeTab.view.webContents || activeTab.view.webContents.isDestroyed()) {
    console.error('[ERROR] Active tab webContents is not available');
    return null;
  }

  return activeTab.view.webContents;
}

function normalizeTranscriptTextForPrompt(text) {
  return String(text || '').trim();
}

function getTranscriptLines(text) {
  return normalizeTranscriptTextForPrompt(text)
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

function getPendingTranscriptText(transcriptText = latestTranscriptText, cursorText = lastSubmittedTranscriptText) {
  const currentTranscriptText = normalizeTranscriptTextForPrompt(transcriptText);
  const submittedTranscriptText = normalizeTranscriptTextForPrompt(cursorText);

  if (!currentTranscriptText || !submittedTranscriptText) {
    return currentTranscriptText;
  }

  if (currentTranscriptText === submittedTranscriptText) {
    return '';
  }

  if (currentTranscriptText.startsWith(submittedTranscriptText)) {
    return currentTranscriptText.slice(submittedTranscriptText.length).replace(/^\s*\n?/, '').trim();
  }

  const currentLines = getTranscriptLines(currentTranscriptText);
  const submittedLines = getTranscriptLines(submittedTranscriptText);
  let firstUnsubmittedLineIndex = 0;

  while (
    firstUnsubmittedLineIndex < currentLines.length
    && firstUnsubmittedLineIndex < submittedLines.length
    && currentLines[firstUnsubmittedLineIndex] === submittedLines[firstUnsubmittedLineIndex]
  ) {
    firstUnsubmittedLineIndex += 1;
  }

  return currentLines.slice(firstUnsubmittedLineIndex).join('\n').trim();
}

function markTranscriptSubmitted(transcriptText = latestTranscriptText) {
  lastSubmittedTranscriptText = normalizeTranscriptTextForPrompt(transcriptText);
}

function markTranscriptCopiedToClipboard(transcriptText = latestTranscriptText) {
  lastClipboardTranscriptText = normalizeTranscriptTextForPrompt(transcriptText);
}

function resetSubmittedTranscriptCursor() {
  lastSubmittedTranscriptText = '';
}

function resetClipboardTranscriptCursor() {
  lastClipboardTranscriptText = '';
}

function resetTranscriptCursors() {
  resetSubmittedTranscriptCursor();
  resetClipboardTranscriptCursor();
}

function getTranscriptPromptText(transcriptText = latestTranscriptText) {
  const normalizedTranscriptText = normalizeTranscriptTextForPrompt(transcriptText);
  const promptText = String(getSelectedPromptMode()?.suffix || '').trim();

  if (!normalizedTranscriptText) {
    return promptText;
  }

  const sections = [
    'Interviewer said like this',
    '"""',
    normalizedTranscriptText,
    '"""'
  ];

  if (promptText) {
    sections.push('', promptText);
  }

  return sections.join('\n');
}

function sendCaptionUpdate(payload = translationManager.getPayload()) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('caption-update', payload);
  }
}

function isSupportedAssistantUrl(url) {
  try {
    const { hostname } = new URL(url);
    return SUPPORTED_ASSISTANT_HOSTS.has(hostname);
  } catch (error) {
    return false;
  }
}

function ensureSupportedAssistantTab(webContents, actionName) {
  const currentUrl = webContents.getURL();
  if (isSupportedAssistantUrl(currentUrl)) {
    return true;
  }

  console.error(`[ERROR] ${actionName} requires the active tab to be ChatGPT or DeepSeek. Current URL: ${currentUrl || 'about:blank'}`);
  return false;
}

async function capturePageFocusState(webContents) {
  try {
    return await webContents.executeJavaScript(`
      (() => {
        const activeElement = document.activeElement;
        if (!activeElement || activeElement === document.body || activeElement === document.documentElement) {
          return {
            markerId: ''
          };
        }

        const markerId = 'assistant-focus-' + Math.random().toString(36).slice(2, 10);
        activeElement.setAttribute('data-assistant-focus-marker', markerId);

        return { markerId };
      })();
    `, true);
  } catch (error) {
    console.warn('[WARNING] Failed to capture page focus state:', error);
    return {
      markerId: ''
    };
  }
}

async function restorePageFocusState(webContents, focusState) {
  try {
    await webContents.executeJavaScript(`
      (() => {
        const markerId = ${JSON.stringify(String(focusState?.markerId || ''))};
        const markerSelector = markerId
          ? '[data-assistant-focus-marker="' + markerId + '"]'
          : '';
        const markedElement = markerSelector ? document.querySelector(markerSelector) : null;

        if (markedElement) {
          markedElement.removeAttribute('data-assistant-focus-marker');
        }

        const activeElement = document.activeElement;
        if (activeElement && typeof activeElement.blur === 'function') {
          activeElement.blur();
        }

        const selection = typeof window.getSelection === 'function' ? window.getSelection() : null;
        if (selection && typeof selection.removeAllRanges === 'function') {
          selection.removeAllRanges();
        }

        return false;
      })();
    `, true);
  } catch (error) {
    console.warn('[WARNING] Failed to restore page focus state:', error);
  }
}

async function settlePageFocusState(webContents, focusState) {
  const restoreDelays = [0, 120, 320];

  for (const delayMs of restoreDelays) {
    if (delayMs > 0) {
      await sleep(delayMs);
    }

    await restorePageFocusState(webContents, focusState);
  }
}

async function clearCurrentComposer(webContents) {
  try {
    return await webContents.executeJavaScript(`
      (() => {
        const selectors = [
          '#prompt-textarea',
          'textarea[data-id="root"]',
          'textarea[placeholder*="Message"]',
          'textarea',
          '[contenteditable="true"][data-lexical-editor="true"]',
          '[contenteditable="true"]'
        ];

        for (const selector of selectors) {
          const element = document.querySelector(selector);
          if (!element) continue;
          if ('disabled' in element && element.disabled) continue;
          if ('readOnly' in element && element.readOnly) continue;

          const inputType = 'deleteContentBackward';

          if (element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement) {
            const prototype = Object.getPrototypeOf(element);
            const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value');
            if (descriptor && typeof descriptor.set === 'function') {
              descriptor.set.call(element, '');
            } else {
              element.value = '';
            }

            element.dispatchEvent(new InputEvent('input', {
              bubbles: true,
              data: null,
              inputType
            }));
            element.dispatchEvent(new Event('change', { bubbles: true }));
            return true;
          }

          if (element.isContentEditable) {
            element.textContent = '';

            element.dispatchEvent(new InputEvent('input', {
              bubbles: true,
              data: null,
              inputType
            }));
            return true;
          }
        }

        return false;
      })();
    `, true);
  } catch (error) {
    console.error('[ERROR] Failed to clear assistant composer text:', error);
    return false;
  }
}

async function getCurrentComposerText(webContents) {
  try {
    return await webContents.executeJavaScript(`
      (() => {
        const selectors = [
          '#prompt-textarea',
          'textarea[data-id="root"]',
          'textarea[placeholder*="Message"]',
          'textarea',
          '[contenteditable="true"][data-lexical-editor="true"]',
          '[contenteditable="true"]'
        ];

        function isUsableComposer(element) {
          if (!element) return false;
          if ('disabled' in element && element.disabled) return false;
          if ('readOnly' in element && element.readOnly) return false;
          return true;
        }

        function readComposerText(element) {
          if (!element) return '';

          if (element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement) {
            return element.value || '';
          }

          if (element.isContentEditable) {
            return element.innerText || element.textContent || '';
          }

          return '';
        }

        const activeElement = document.activeElement;
        if (
          activeElement
          && typeof activeElement.matches === 'function'
          && selectors.some((selector) => activeElement.matches(selector))
          && isUsableComposer(activeElement)
        ) {
          return readComposerText(activeElement);
        }

        for (const selector of selectors) {
          const element = document.querySelector(selector);
          if (!element) continue;
          if (!isUsableComposer(element)) continue;

          return readComposerText(element);
        }

        return '';
      })();
    `, true);
  } catch (error) {
    console.error('[ERROR] Failed to read assistant composer text:', error);
    return '';
  }
}

function normalizeComposerText(text) {
  return String(text || '')
    .replace(/\u00A0/g, ' ')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function flattenComposerText(text) {
  return normalizeComposerText(text)
    .replace(/\s+/g, ' ')
    .trim();
}

function composerTextMatches(expectedText, currentText) {
  const normalizedExpected = normalizeComposerText(expectedText);
  const normalizedCurrent = normalizeComposerText(currentText);

  if (!normalizedExpected) {
    return normalizedCurrent.length > 0;
  }

  if (normalizedCurrent === normalizedExpected) {
    return true;
  }

  const flattenedExpected = flattenComposerText(normalizedExpected);
  const flattenedCurrent = flattenComposerText(normalizedCurrent);

  return Boolean(flattenedExpected) && flattenedCurrent === flattenedExpected;
}

async function waitForComposerText(webContents, expectedText = '', attempts = 12, delayMs = 100) {
  const normalizedExpected = normalizeComposerText(expectedText);

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const currentText = await getCurrentComposerText(webContents);
    const normalizedCurrent = normalizeComposerText(currentText);

    if (!normalizedExpected && normalizedCurrent.length > 0) {
      return true;
    }

    if (normalizedExpected && composerTextMatches(normalizedExpected, normalizedCurrent)) {
      return true;
    }

    await sleep(delayMs);
  }

  return false;
}

async function waitForComposerEmpty(webContents, attempts = 12, delayMs = 100) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const currentText = await getCurrentComposerText(webContents);
    if (!currentText.trim()) {
      return true;
    }

    await sleep(delayMs);
  }

  return false;
}

async function pasteTextIntoComposer(webContents, text) {
  try {
    return await webContents.executeJavaScript(`
      (() => {
        const nextValue = ${JSON.stringify(String(text || ''))};
        const selectors = [
          '#prompt-textarea',
          'textarea[data-id="root"]',
          'textarea[placeholder*="Message"]',
          'textarea',
          '[contenteditable="true"][data-lexical-editor="true"]',
          '[contenteditable="true"]'
        ];

        for (const selector of selectors) {
          const element = document.querySelector(selector);
          if (!element) continue;
          if ('disabled' in element && element.disabled) continue;
          if ('readOnly' in element && element.readOnly) continue;

          const inputType = nextValue ? 'insertText' : 'deleteContentBackward';

          if (element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement) {
            const prototype = Object.getPrototypeOf(element);
            const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value');
            if (descriptor && typeof descriptor.set === 'function') {
              descriptor.set.call(element, nextValue);
            } else {
              element.value = nextValue;
            }

            element.dispatchEvent(new InputEvent('input', {
              bubbles: true,
              data: nextValue || null,
              inputType
            }));
            element.dispatchEvent(new Event('change', { bubbles: true }));
            return true;
          }

          if (element.isContentEditable) {
            element.textContent = nextValue;
            element.dispatchEvent(new InputEvent('input', {
              bubbles: true,
              data: nextValue || null,
              inputType
            }));
            return true;
          }
        }

        return false;
      })();
    `, true);
  } catch (error) {
    console.error('[ERROR] Failed to paste text into assistant composer:', error);
    return false;
  }
}

function getTemporaryUploadFilePath(extension = '.png') {
  const uploadDir = path.join(app.getPath('userData'), 'assistant-temp-uploads');
  fs.mkdirSync(uploadDir, { recursive: true });
  return path.join(
    uploadDir,
    `capture-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${extension}`
  );
}

function scheduleTemporaryFileCleanup(filePath, delayMs = 120000) {
  if (!filePath) {
    return;
  }

  setTimeout(() => {
    fs.unlink(filePath, () => {});
  }, delayMs);
}

async function markImageUploadInput(webContents, markerId) {
  try {
    return await webContents.executeJavaScript(`
      (async () => {
        const markerId = ${JSON.stringify(markerId)};
        const composerSelectors = [
          '#prompt-textarea',
          'textarea[data-id="root"]',
          'textarea[placeholder*="Message"]',
          'textarea',
          '[contenteditable="true"][data-lexical-editor="true"]',
          '[contenteditable="true"]'
        ];
        const fileInputSelectors = [
          'input[type="file"][accept*="image"]',
          'input[type="file"][accept*="png"]',
          'input[type="file"]'
        ];
        const revealButtonSelectors = [
          'button[aria-label*="Attach"]',
          'button[aria-label*="attach"]',
          'button[aria-label*="Upload"]',
          'button[aria-label*="upload"]',
          'button[aria-label*="Photo"]',
          'button[aria-label*="photo"]',
          'button[aria-label*="Image"]',
          'button[aria-label*="image"]',
          '[data-testid*="attach"]',
          '[data-testid*="upload"]',
          '[data-testid*="plus"]'
        ];

        const sleep = (delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs));

        function findComposer() {
          for (const selector of composerSelectors) {
            const element = document.querySelector(selector);
            if (!element) continue;
            if ('disabled' in element && element.disabled) continue;
            if ('readOnly' in element && element.readOnly) continue;
            return element;
          }

          return null;
        }

        function getSearchScopes(composer) {
          return [
            composer,
            composer?.closest('form'),
            composer?.parentElement,
            composer?.closest('[data-testid], section, main, div'),
            document,
            document.body
          ].filter(Boolean);
        }

        function findFileInput(composer) {
          const seen = new Set();

          for (const scope of getSearchScopes(composer)) {
            if (!scope || typeof scope.querySelectorAll !== 'function') continue;

            for (const selector of fileInputSelectors) {
              for (const input of scope.querySelectorAll(selector)) {
                if (!input || seen.has(input)) continue;
                seen.add(input);

                if (input.disabled) continue;
                return input;
              }
            }
          }

          return null;
        }

        async function revealFileInput(composer) {
          const seen = new Set();

          for (const scope of getSearchScopes(composer)) {
            if (!scope || typeof scope.querySelectorAll !== 'function') continue;

            for (const selector of revealButtonSelectors) {
              for (const button of scope.querySelectorAll(selector)) {
                if (!button || seen.has(button)) continue;
                seen.add(button);

                if ('disabled' in button && button.disabled) continue;

                try {
                  button.click();
                } catch (error) {
                  continue;
                }

                await sleep(120);
                const revealedInput = findFileInput(composer);
                if (revealedInput) {
                  return revealedInput;
                }
              }
            }
          }

          return null;
        }

        document
          .querySelectorAll('[data-assistant-upload-marker]')
          .forEach((element) => element.removeAttribute('data-assistant-upload-marker'));

        const composer = findComposer();
        if (!composer) {
          return false;
        }

        let input = findFileInput(composer);
        if (!input) {
          input = await revealFileInput(composer);
        }

        if (!input) {
          return false;
        }

        input.setAttribute('data-assistant-upload-marker', markerId);
        return true;
      })();
    `, true);
  } catch (error) {
    console.error('[ERROR] Failed to mark assistant upload input:', error);
    return false;
  }
}

async function setMarkedUploadInputFiles(webContents, markerId, filePaths) {
  const debuggerSession = webContents.debugger;
  let attachedHere = false;
  let searchId = null;
  let domEnabledHere = false;

  try {
    if (!debuggerSession.isAttached()) {
      debuggerSession.attach('1.3');
      attachedHere = true;
    }

    await debuggerSession.sendCommand('DOM.enable');
    domEnabledHere = true;

    const { searchId: nextSearchId, resultCount } = await debuggerSession.sendCommand('DOM.performSearch', {
      query: `[data-assistant-upload-marker="${markerId}"]`
    });
    searchId = nextSearchId;

    if (!resultCount) {
      return false;
    }

    const { nodeIds } = await debuggerSession.sendCommand('DOM.getSearchResults', {
      searchId,
      fromIndex: 0,
      toIndex: 1
    });

    const nodeId = Array.isArray(nodeIds) ? nodeIds[0] : null;
    if (!nodeId) {
      return false;
    }

    await debuggerSession.sendCommand('DOM.setFileInputFiles', {
      nodeId,
      files: filePaths
    });

    return true;
  } catch (error) {
    console.error('[ERROR] Failed to set assistant upload input files:', error);
    return false;
  } finally {
    if (searchId) {
      try {
        await debuggerSession.sendCommand('DOM.discardSearchResults', { searchId });
      } catch (error) {
        // Ignore cleanup failures.
      }
    }

    if (domEnabledHere) {
      try {
        await debuggerSession.sendCommand('DOM.disable');
      } catch (error) {
        // Ignore cleanup failures.
      }
    }

    if (attachedHere && debuggerSession.isAttached()) {
      try {
        debuggerSession.detach();
      } catch (error) {
        // Ignore detach failures.
      }
    }
  }
}

async function dispatchMarkedUploadInputEvents(webContents, markerId, preserveMarker = false) {
  try {
    return await webContents.executeJavaScript(`
      (() => {
        const markerId = ${JSON.stringify(markerId)};
        const preserveMarker = ${JSON.stringify(Boolean(preserveMarker))};
        const input = document.querySelector('[data-assistant-upload-marker="' + markerId + '"]');
        if (!input) {
          return false;
        }

        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        if (!preserveMarker) {
          input.removeAttribute('data-assistant-upload-marker');
        }
        return true;
      })();
    `, true);
  } catch (error) {
    console.error('[ERROR] Failed to dispatch assistant upload input events:', error);
    return false;
  }
}

async function clearMarkedUploadInput(webContents, markerId) {
  try {
    await webContents.executeJavaScript(`
      (() => {
        const markerId = ${JSON.stringify(markerId)};
        const input = document.querySelector('[data-assistant-upload-marker="' + markerId + '"]');
        if (input) {
          input.removeAttribute('data-assistant-upload-marker');
        }
      })();
    `, true);
  } catch (error) {
    // Ignore cleanup failures.
  }
}

async function getAssistantImageAttachmentState(webContents, markerId = '') {
  try {
    return await webContents.executeJavaScript(`
      (() => {
        const markerId = ${JSON.stringify(String(markerId || ''))};
        const selectors = [
          '#prompt-textarea',
          'textarea[data-id="root"]',
          'textarea[placeholder*="Message"]',
          'textarea',
          '[contenteditable="true"][data-lexical-editor="true"]',
          '[contenteditable="true"]'
        ];

        function getComposer() {
          for (const selector of selectors) {
            const element = document.querySelector(selector);
            if (!element) continue;
            if ('disabled' in element && element.disabled) continue;
            if ('readOnly' in element && element.readOnly) continue;
            return element;
          }

          return null;
        }

        function getScopes(composer) {
          return [
            composer,
            composer?.closest('form'),
            composer?.parentElement,
            composer?.closest('[data-testid], section, main, div'),
            document,
            document.body
          ].filter(Boolean);
        }

        function isAttachmentIndicator(element) {
          const value = [
            element.getAttribute?.('data-testid') || '',
            element.getAttribute?.('aria-label') || '',
            typeof element.className === 'string' ? element.className : ''
          ].join(' ').toLowerCase();

          return value.includes('attachment')
            || value.includes('upload')
            || value.includes('preview')
            || value.includes('file-chip')
            || value.includes('image-chip');
        }

        const composer = getComposer();
        if (!composer) {
          return null;
        }

        const uniqueScopes = [];
        const seenScopes = new Set();
        for (const scope of getScopes(composer)) {
          if (!scope || seenScopes.has(scope)) continue;
          seenScopes.add(scope);
          uniqueScopes.push(scope);
        }

        const markedInput = markerId
          ? document.querySelector('[data-assistant-upload-marker="' + markerId + '"]')
          : null;

        const seenInputs = new Set();
        const seenImages = new Set();
        const seenIndicators = new Set();
        let fileCount = 0;
        let previewCount = 0;
        let attachmentIndicatorCount = 0;

        for (const scope of uniqueScopes) {
          if (typeof scope.querySelectorAll !== 'function') continue;

          for (const input of scope.querySelectorAll('input[type="file"]')) {
            if (!input || seenInputs.has(input)) continue;
            seenInputs.add(input);
            fileCount += Number(input.files?.length || 0);
          }

          for (const image of scope.querySelectorAll('img')) {
            if (!image || seenImages.has(image)) continue;
            seenImages.add(image);

            const src = typeof image.getAttribute === 'function'
              ? (image.getAttribute('src') || '')
              : '';

            if (src.startsWith('blob:') || src.startsWith('data:image')) {
              previewCount += 1;
            }
          }

          for (const element of scope.querySelectorAll('[data-testid], [aria-label], [class]')) {
            if (!element || seenIndicators.has(element)) continue;
            if (!isAttachmentIndicator(element)) continue;

            seenIndicators.add(element);
            attachmentIndicatorCount += 1;
          }
        }

        return {
          markedFileCount: Number(markedInput?.files?.length || 0),
          fileCount,
          previewCount,
          attachmentIndicatorCount
        };
      })();
    `, true);
  } catch (error) {
    console.error('[ERROR] Failed to inspect assistant attachment state:', error);
    return null;
  }
}

function attachmentStateShowsNewImage(previousState, nextState) {
  if (!nextState) {
    return false;
  }

  if ((nextState.markedFileCount || 0) > 0) {
    return true;
  }

  if (!previousState) {
    return (nextState.fileCount || 0) > 0 || (nextState.previewCount || 0) > 0;
  }

  return (nextState.fileCount || 0) > (previousState.fileCount || 0)
    || (nextState.previewCount || 0) > (previousState.previewCount || 0)
    || (nextState.attachmentIndicatorCount || 0) > (previousState.attachmentIndicatorCount || 0);
}

async function waitForAssistantImageAttachment(webContents, previousState, markerId = '', attempts = 20, delayMs = 150) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const currentState = await getAssistantImageAttachmentState(webContents, markerId);
    if (attachmentStateShowsNewImage(previousState, currentState)) {
      return true;
    }

    await sleep(delayMs);
  }

  return false;
}

async function pasteImageIntoComposer(webContents, image) {
  const uploadMarkerId = `upload-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const temporaryUploadPath = getTemporaryUploadFilePath('.png');
  const imagePng = image.toPNG();
  const previousAttachmentState = await getAssistantImageAttachmentState(webContents, uploadMarkerId);

  try {
    fs.writeFileSync(temporaryUploadPath, imagePng);
    scheduleTemporaryFileCleanup(temporaryUploadPath);

    const markedInput = await markImageUploadInput(webContents, uploadMarkerId);
    if (markedInput) {
      const uploaded = await setMarkedUploadInputFiles(webContents, uploadMarkerId, [temporaryUploadPath]);
      if (uploaded) {
        await dispatchMarkedUploadInputEvents(webContents, uploadMarkerId, true);
        await waitForAssistantImageAttachment(
          webContents,
          previousAttachmentState,
          uploadMarkerId,
          4,
          100
        );
        await clearMarkedUploadInput(webContents, uploadMarkerId);
        return true;
      } else {
        await clearMarkedUploadInput(webContents, uploadMarkerId);
      }
    }

    const imageBase64 = imagePng.toString('base64');
    const syntheticHandled = await webContents.executeJavaScript(`
      (() => {
        const imageBase64 = ${JSON.stringify(imageBase64)};
        const selectors = [
          '#prompt-textarea',
          'textarea[data-id="root"]',
          'textarea[placeholder*="Message"]',
          'textarea',
          '[contenteditable="true"][data-lexical-editor="true"]',
          '[contenteditable="true"]'
        ];
        function buildFileFromBase64() {
          const binary = atob(imageBase64);
          const bytes = new Uint8Array(binary.length);

          for (let index = 0; index < binary.length; index += 1) {
            bytes[index] = binary.charCodeAt(index);
          }

          return new File([bytes], 'capture.png', { type: 'image/png' });
        }

        const file = buildFileFromBase64();
        const dataTransfer = new DataTransfer();
        dataTransfer.items.add(file);

        function getComposer() {
          for (const selector of selectors) {
            const element = document.querySelector(selector);
            if (!element) continue;
            if ('disabled' in element && element.disabled) continue;
            if ('readOnly' in element && element.readOnly) continue;
            return element;
          }

          return null;
        }

        function getScopes(composer) {
          return [
            composer,
            composer?.closest('form'),
            composer?.parentElement,
            composer?.closest('[data-testid], section, main, div'),
            document,
            document.body
          ].filter(Boolean);
        }

        function getComposerTargets(composer) {
          const targets = [];
          const seen = new Set();

          for (const target of getScopes(composer)) {
            if (seen.has(target)) continue;
            seen.add(target);
            targets.push(target);
          }

          return targets;
        }

        function dispatchSyntheticPaste(target) {
          try {
            const clipboardEvent = new ClipboardEvent('paste', {
              bubbles: true,
              cancelable: true,
              composed: true
            });

            Object.defineProperty(clipboardEvent, 'clipboardData', {
              configurable: true,
              value: dataTransfer
            });

            return target.dispatchEvent(clipboardEvent) === false || clipboardEvent.defaultPrevented;
          } catch (error) {
            try {
              const pasteEvent = new Event('paste', {
                bubbles: true,
                cancelable: true,
                composed: true
              });

              Object.defineProperty(pasteEvent, 'clipboardData', {
                configurable: true,
                value: dataTransfer
              });

              return target.dispatchEvent(pasteEvent) === false || pasteEvent.defaultPrevented;
            } catch (innerError) {
              return false;
            }
          }
        }

        function dispatchSyntheticDrop(target) {
          try {
            const dropEvent = new DragEvent('drop', {
              bubbles: true,
              cancelable: true,
              composed: true,
              dataTransfer
            });

            return target.dispatchEvent(dropEvent) === false || dropEvent.defaultPrevented;
          } catch (error) {
            return false;
          }
        }

        const composer = getComposer();
        if (!composer) {
          return false;
        }

        const targets = getComposerTargets(composer);

        for (const target of targets) {
          let handled = false;

          try {
            const beforeInputEvent = new InputEvent('beforeinput', {
              bubbles: true,
              cancelable: true,
              composed: true,
              inputType: 'insertFromPaste',
              data: null,
              dataTransfer
            });

            if (target.dispatchEvent(beforeInputEvent) === false) {
              handled = true;
            }
          } catch (error) {
            // Ignore unsupported event constructors.
          }

          if (!handled && dispatchSyntheticPaste(target)) {
            handled = true;
          }

          if (!handled && dispatchSyntheticDrop(target)) {
            handled = true;
          }

          if (handled) {
            return true;
          }
        }

        return false;
      })();
    `, true);

    if (!syntheticHandled) {
      return false;
    }

    await waitForAssistantImageAttachment(webContents, previousAttachmentState, '', 4, 100);
    return true;
  } catch (error) {
    console.error('[ERROR] Failed to paste image into assistant composer without focus:', error);
    return false;
  }
}

async function waitForComposerTextChange(webContents, previousText = '', attempts = 12, delayMs = 150) {
  const normalizedPrevious = normalizeComposerText(previousText);

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const currentText = await getCurrentComposerText(webContents);
    const normalizedCurrent = normalizeComposerText(currentText);

    if (normalizedCurrent !== normalizedPrevious) {
      return true;
    }

    await sleep(delayMs);
  }

  return false;
}

async function clickComposerSendButton(webContents) {
  try {
    return await webContents.executeJavaScript(`
      (() => {
        const composerSelectors = [
          '#prompt-textarea',
          'textarea[data-id="root"]',
          'textarea[placeholder*="Message"]',
          'textarea',
          '[contenteditable="true"][data-lexical-editor="true"]',
          '[contenteditable="true"]'
        ];

        const buttonSelectors = [
          'button[data-testid="send-button"]',
          'button[aria-label="Send prompt"]',
          'button[aria-label="Send message"]',
          'button[aria-label="Send"]',
          'button[aria-label*="Send"]',
          'button[type="submit"]'
        ];

        function isComposerReady(element) {
          if (!element) return false;
          if ('disabled' in element && element.disabled) return false;
          if ('readOnly' in element && element.readOnly) return false;
          return true;
        }

        function findComposer() {
          for (const selector of composerSelectors) {
            const element = document.querySelector(selector);
            if (isComposerReady(element)) {
              return element;
            }
          }

          return null;
        }

        function isButtonReady(button) {
          if (!button) return false;

          const isDisabled = button.disabled
            || button.getAttribute('aria-disabled') === 'true'
            || button.matches('[disabled]');

          const style = window.getComputedStyle(button);
          const rect = button.getBoundingClientRect();
          const isHidden = style.display === 'none'
            || style.visibility === 'hidden'
            || style.opacity === '0'
            || rect.width === 0
            || rect.height === 0;

          return !isDisabled && !isHidden;
        }

        function findSendButton(composer) {
          const candidates = [];
          const seen = new Set();

          const addButtonsFromRoot = (root) => {
            if (!root || typeof root.querySelectorAll !== 'function') return;

            for (const selector of buttonSelectors) {
              for (const button of root.querySelectorAll(selector)) {
                if (!button || seen.has(button)) continue;
                seen.add(button);
                candidates.push(button);
              }
            }
          };

          const form = composer?.closest('form');
          addButtonsFromRoot(form);
          addButtonsFromRoot(composer?.parentElement);
          addButtonsFromRoot(composer?.closest('[data-testid], section, main, div'));
          addButtonsFromRoot(document);

          for (const button of candidates) {
            if (isButtonReady(button)) {
              return button;
            }
          }

          return null;
        }

        const composer = findComposer();
        const button = findSendButton(composer);
        if (!button) return false;

        button.scrollIntoView({ block: 'nearest', inline: 'nearest' });

        const form = button.closest('form') || composer?.closest('form');
        if (form && typeof form.requestSubmit === 'function') {
          try {
            form.requestSubmit(button);
            return true;
          } catch (error) {
            // Fall through to pointer and click dispatch below.
          }
        }

        const pointerEventInit = {
          bubbles: true,
          cancelable: true,
          composed: true,
          button: 0,
          buttons: 1
        };

        button.dispatchEvent(new PointerEvent('pointerdown', pointerEventInit));
        button.dispatchEvent(new MouseEvent('mousedown', pointerEventInit));
        button.dispatchEvent(new PointerEvent('pointerup', pointerEventInit));
        button.dispatchEvent(new MouseEvent('mouseup', pointerEventInit));
        button.click();
        return true;
      })();
    `, true);
  } catch (error) {
    console.error('[ERROR] Failed to click assistant send button:', error);
    return false;
  }
}

async function waitForSendButtonReady(webContents, attempts = 12, delayMs = 100) {
  try {
    const checkScript = `
      (() => {
        const composerSelectors = [
          '#prompt-textarea',
          'textarea[data-id="root"]',
          'textarea[placeholder*="Message"]',
          'textarea',
          '[contenteditable="true"][data-lexical-editor="true"]',
          '[contenteditable="true"]'
        ];

        const buttonSelectors = [
          'button[data-testid="send-button"]',
          'button[aria-label="Send prompt"]',
          'button[aria-label="Send message"]',
          'button[aria-label="Send"]',
          'button[aria-label*="Send"]',
          'button[type="submit"]'
        ];

        function findComposer() {
          for (const selector of composerSelectors) {
            const element = document.querySelector(selector);
            if (!element) continue;
            if ('disabled' in element && element.disabled) continue;
            if ('readOnly' in element && element.readOnly) continue;
            return element;
          }

          return null;
        }

        function isButtonReady(button) {
          if (!button) return false;

          const isDisabled = button.disabled
            || button.getAttribute('aria-disabled') === 'true'
            || button.matches('[disabled]');

          const style = window.getComputedStyle(button);
          const rect = button.getBoundingClientRect();
          const isHidden = style.display === 'none'
            || style.visibility === 'hidden'
            || style.opacity === '0'
            || rect.width === 0
            || rect.height === 0;

          return !isDisabled && !isHidden;
        }

        const composer = findComposer();
        if (!composer) {
          return false;
        }

        const form = composer.closest('form');
        const scopes = [form, composer.parentElement, composer.closest('[data-testid], section, main, div'), document];
        const seen = new Set();

        for (const scope of scopes) {
          if (!scope || typeof scope.querySelectorAll !== 'function') continue;

          for (const selector of buttonSelectors) {
            for (const button of scope.querySelectorAll(selector)) {
              if (!button || seen.has(button)) continue;
              seen.add(button);

              if (isButtonReady(button)) {
                return true;
              }
            }
          }
        }

        return false;
      })();
    `;

    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const ready = await webContents.executeJavaScript(checkScript, true);
      if (ready) {
        return true;
      }

      await sleep(delayMs);
    }
  } catch (error) {
    console.error('[ERROR] Failed to check assistant send button state:', error);
  }

  return false;
}

async function submitComposerViaDom(webContents) {
  try {
    return await webContents.executeJavaScript(`
      (() => {
        const composerSelectors = [
          '#prompt-textarea',
          'textarea[data-id="root"]',
          'textarea[placeholder*="Message"]',
          'textarea',
          '[contenteditable="true"][data-lexical-editor="true"]',
          '[contenteditable="true"]'
        ];

        const buttonSelectors = [
          'button[data-testid="send-button"]',
          'button[aria-label="Send prompt"]',
          'button[aria-label="Send message"]',
          'button[aria-label="Send"]',
          'button[aria-label*="Send"]',
          'button[type="submit"]'
        ];

        function isButtonReady(button) {
          if (!button) return false;

          const isDisabled = button.disabled
            || button.getAttribute('aria-disabled') === 'true'
            || button.matches('[disabled]');

          const style = window.getComputedStyle(button);
          const rect = button.getBoundingClientRect();
          const isHidden = style.display === 'none'
            || style.visibility === 'hidden'
            || style.opacity === '0'
            || rect.width === 0
            || rect.height === 0;

          return !isDisabled && !isHidden;
        }

        function findSendButton(composer) {
          const form = composer?.closest('form');
          if (form) {
            for (const selector of buttonSelectors) {
              for (const button of form.querySelectorAll(selector)) {
                if (isButtonReady(button)) {
                  return button;
                }
              }
            }
          }

          return null;
        }

        for (const selector of composerSelectors) {
          const element = document.querySelector(selector);
          if (!element) continue;
          if ('disabled' in element && element.disabled) continue;
          if ('readOnly' in element && element.readOnly) continue;

          const button = findSendButton(element);

          const form = element.closest('form');
          if (form) {
            if (typeof form.requestSubmit === 'function') {
              form.requestSubmit(button || undefined);
              return true;
            } else {
              form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
              return true;
            }
          }

          const eventInit = {
            key: 'Enter',
            code: 'Enter',
            keyCode: 13,
            which: 13,
            bubbles: true,
            cancelable: true
          };

          element.dispatchEvent(new KeyboardEvent('keydown', eventInit));
          element.dispatchEvent(new KeyboardEvent('keypress', eventInit));
          element.dispatchEvent(new KeyboardEvent('keyup', eventInit));
          return true;
        }

        return false;
      })();
    `, true);
  } catch (error) {
    console.error('[ERROR] Failed to submit assistant composer via DOM events:', error);
    return false;
  }
}

async function submitCurrentComposer(webContents, expectedText) {
  const clickSubmitted = await clickComposerSendButton(webContents);
  if (clickSubmitted && await waitForComposerTextChange(webContents, expectedText, 30, 200)) {
    return true;
  }

  const domSubmitted = await submitComposerViaDom(webContents);
  if (domSubmitted && await waitForComposerTextChange(webContents, expectedText, 30, 200)) {
    return true;
  }

  return false;
}

async function submitTranscriptToAssistant() {
  const transcriptSnapshot = normalizeTranscriptTextForPrompt(latestTranscriptText);
  const pendingTranscriptText = getPendingTranscriptText(transcriptSnapshot);
  if (transcriptSnapshot && !pendingTranscriptText) {
    console.error('[ERROR] No new transcript is available for Ctrl+Enter');
    return;
  }

  const composerText = getTranscriptPromptText(pendingTranscriptText);
  if (!composerText.trim()) {
    console.error('[ERROR] No new transcript or prompt text is available for Ctrl+Enter');
    return;
  }

  const webContents = getActiveTabWebContents();
  if (!webContents) {
    return;
  }

  if (!ensureSupportedAssistantTab(webContents, 'Ctrl+Enter')) {
    return;
  }

  const focusState = await capturePageFocusState(webContents);

  try {
    const cleared = await clearCurrentComposer(webContents);
    if (!cleared || !(await waitForComposerEmpty(webContents))) {
      console.error('[ERROR] Ctrl+Enter could not clear the current assistant composer without focusing it');
      return;
    }

    const pastedText = await pasteTextIntoComposer(webContents, composerText);
    if (!pastedText) {
      console.error('[ERROR] Transcript prompt could not be injected into the current assistant composer');
      return;
    }

    const pasted = await waitForComposerText(webContents, composerText);
    if (!pasted) {
      const currentText = await getCurrentComposerText(webContents);
      console.error('[ERROR] Transcript prompt did not match the expected text in the current assistant composer', {
        expectedLength: normalizeComposerText(composerText).length,
        currentLength: normalizeComposerText(currentText).length,
        expectedPreview: flattenComposerText(composerText).slice(0, 160),
        currentPreview: flattenComposerText(currentText).slice(0, 160)
      });
      return;
    }

    await sleep(50);
    const submitted = await submitCurrentComposer(webContents, composerText);
    if (submitted) {
      markTranscriptSubmitted(transcriptSnapshot);
    } else {
      const sendButtonReady = await waitForSendButtonReady(webContents, 6, 75);
      console.error('[ERROR] Ctrl+Enter could not submit the current assistant composer without focusing it');
      if (!sendButtonReady) {
        console.error('[ERROR] Assistant send button did not become ready after Ctrl+Enter injection');
      }
    }
  } finally {
    await settlePageFocusState(webContents, focusState);
  }
}

async function copyTranscriptPromptToClipboard() {
  const transcriptSnapshot = normalizeTranscriptTextForPrompt(latestTranscriptText);
  const pendingTranscriptText = getPendingTranscriptText(transcriptSnapshot, lastClipboardTranscriptText);
  if (transcriptSnapshot && !pendingTranscriptText) {
    console.error('[ERROR] No new transcript is available for Alt+Enter');
    return;
  }

  const clipboardText = getTranscriptPromptText(pendingTranscriptText);
  if (!clipboardText.trim()) {
    console.error('[ERROR] No new transcript or prompt text is available for Alt+Enter');
    return;
  }

  clipboard.writeText(clipboardText);
  markTranscriptCopiedToClipboard(transcriptSnapshot);
  console.log('[INFO] Copied transcript prompt to clipboard for Alt+Enter', {
    transcriptLength: pendingTranscriptText.length,
    clipboardLength: clipboardText.length
  });
}

async function pasteFullScreenIntoAssistant() {
  const webContents = getActiveTabWebContents();
  if (!webContents) {
    return;
  }

  if (!ensureSupportedAssistantTab(webContents, 'Ctrl+Shift+Enter')) {
    return;
  }

  const focusState = await capturePageFocusState(webContents);

  try {
    const preparedCapture = await screenCapture.prepareDisplayCapture(getCurrentDisplayId());
    const pasted = await pasteImageIntoComposer(webContents, preparedCapture.image);
    if (!pasted) {
      console.error('[ERROR] Ctrl+Shift+Enter could not inject the captured image without focusing the assistant');
      return;
    }

    await sleep(150);
  } finally {
    await settlePageFocusState(webContents, focusState);
  }
}

function toggleMuteAllTabs() {
  isMuted = !isMuted;
  tabs.forEach((tab) => {
    if (tab.view && tab.view.webContents) {
      tab.view.webContents.setAudioMuted(isMuted);
    }
  });
  persistAppPreferencesSync();
}

function setupGlobalShortcuts() {
  registerAllGlobalHotkeys();
  registerAllModeHotkeys();
}

ipcMain.on('screen-capture-overlay-select', (event, selectionRect) => {
  if (!captureOverlayState || !captureOverlayState.window) {
    return;
  }

  if (event.sender !== captureOverlayState.window.webContents) {
    return;
  }

  resolveScreenSelection(selectionRect);
});

ipcMain.on('screen-capture-overlay-cancel', (event) => {
  if (!captureOverlayState || !captureOverlayState.window) {
    return;
  }

  if (event.sender !== captureOverlayState.window.webContents) {
    return;
  }

  resolveScreenSelection(null);
});

app.whenReady().then(() => {
  loadPromptModeState();
  loadGlobalHotkeyState();
  loadAppPreferences();
  applyNativeTheme();
  createWindow();
  
  mainWindow.once('ready-to-show', () => {
    createDefaultTabs();
    scheduleCaptionSyncStart();
  });
  
  mainWindow.on('resize', () => {
    resizeTabs();
    scheduleAppPreferencesPersist();
  });
  mainWindow.on('move', () => {
    scheduleAppPreferencesPersist();
  });
  mainWindow.on('close', () => {
    flushAppPreferencesPersist();
  });
});

app.on('will-quit', () => {
  if (captionSyncStartTimer) {
    clearTimeout(captionSyncStartTimer);
    captionSyncStartTimer = null;
  }
  if (defaultTabWarmupTimer) {
    clearTimeout(defaultTabWarmupTimer);
    defaultTabWarmupTimer = null;
  }
  if (hotkeySettingsWindow && !hotkeySettingsWindow.isDestroyed()) {
    hotkeySettingsWindow.close();
  }
  flushPromptModeStatePersistSync();
  flushAppPreferencesPersist();
  translationManager.reset('');
  globalShortcut.unregisterAll();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    if (captionSync) {
      captionSync.stop();
    }
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
    mainWindow.once('ready-to-show', () => {
      createDefaultTabs();
    });
  }
});

ipcMain.handle('create-tab', (event, url) => {
  return createNewTab(url || 'about:blank');
});

ipcMain.handle('close-tab', (event, tabId) => {
  closeTab(tabId);
});

ipcMain.handle('close-app', () => {
  app.quit();
  return true;
});

ipcMain.handle('open-hotkey-settings', () => {
  return openHotkeySettingsWindow();
});

ipcMain.handle('switch-tab', (event, tabId) => {
  switchTab(tabId);
});

ipcMain.handle('navigate', (event, url) => {
  if (activeTabId !== null) {
    const tab = tabs.get(activeTabId);
    if (tab) {
      tab.view.webContents.loadURL(url);
    }
  }
});

ipcMain.handle('go-back', () => {
  if (activeTabId !== null) {
    const tab = tabs.get(activeTabId);
    if (tab && tab.view.webContents.navigationHistory.canGoBack()) {
      tab.view.webContents.navigationHistory.goBack();
    }
  }
});

ipcMain.handle('go-forward', () => {
  if (activeTabId !== null) {
    const tab = tabs.get(activeTabId);
    if (tab && tab.view.webContents.navigationHistory.canGoForward()) {
      tab.view.webContents.navigationHistory.goForward();
    }
  }
});

ipcMain.handle('reload', () => {
  if (activeTabId !== null) {
    const tab = tabs.get(activeTabId);
    if (tab) {
      tab.view.webContents.reload();
    }
  }
});

ipcMain.handle('set-panel-split-ratio', (event, ratio) => {
  if (layoutMode !== 'switch' && Number.isFinite(ratio)) {
    if (layoutMode === 'horizontal') {
      horizontalTranscriptPanelRatio = normalizeSplitRatio(ratio, DEFAULT_HORIZONTAL_TRANSCRIPT_PANEL_RATIO);
    } else {
      verticalTranscriptPanelRatio = normalizeSplitRatio(ratio, DEFAULT_VERTICAL_TRANSCRIPT_PANEL_RATIO);
    }
    persistAppPreferencesSync();
    broadcastAppPreferences();
    resizeTabs();
  }

  return layoutMode === 'horizontal' ? horizontalTranscriptPanelRatio : verticalTranscriptPanelRatio;
});

ipcMain.handle('set-transcript-panel-collapsed', (event, collapsed) => {
  if (layoutMode === 'horizontal') {
    isTranscriptPanelCollapsed = false;
    persistAppPreferencesSync();
    resizeTabs();
    return isTranscriptPanelCollapsed;
  }

  isTranscriptPanelCollapsed = Boolean(collapsed);
  persistAppPreferencesSync();
  resizeTabs();
  return isTranscriptPanelCollapsed;
});

ipcMain.handle('set-mode-panel-collapsed', (event, collapsed) => {
  isModePanelCollapsed = Boolean(collapsed);
  persistAppPreferencesSync();
  resizeTabs();
  return isModePanelCollapsed;
});

ipcMain.handle('get-app-preferences', () => {
  return getAppPreferenceStateSnapshot();
});

ipcMain.handle('set-app-theme', (event, theme) => {
  return setAppTheme(theme);
});

ipcMain.handle('toggle-app-theme', () => {
  return toggleAppTheme();
});

ipcMain.handle('set-layout-mode', (event, nextLayoutMode) => {
  return setLayoutMode(nextLayoutMode);
});

ipcMain.handle('cycle-layout-mode', () => {
  return cycleLayoutMode();
});

ipcMain.handle('set-switch-active-view', (event, nextView) => {
  return setSwitchActiveView(nextView);
});

ipcMain.handle('toggle-switch-active-view', () => {
  return toggleSwitchActiveView();
});

ipcMain.handle('set-translation-visible', (event, isVisible) => {
  return setTranslationVisible(isVisible);
});

ipcMain.handle('add-prompt-mode', () => {
  return addPromptMode();
});

ipcMain.handle('select-prompt-mode', (event, modeId) => {
  return selectPromptMode(modeId);
});

ipcMain.handle('delete-prompt-mode', (event, modeId) => {
  return deletePromptMode(modeId);
});

ipcMain.handle('rename-prompt-mode', (event, payload) => {
  return renamePromptMode(payload?.modeId, payload?.name);
});

ipcMain.handle('save-prompt-mode', (event, payload) => {
  return savePromptMode(payload?.modeId, payload?.suffix);
});

ipcMain.handle('set-prompt-mode-hotkey', (event, payload) => {
  return setPromptModeHotkey(payload?.modeId, payload?.hotkey);
});

ipcMain.handle('get-global-hotkeys', () => {
  return getGlobalHotkeyStateSnapshot();
});

ipcMain.handle('set-global-hotkey', (event, payload) => {
  return setGlobalHotkey(payload?.id, payload?.accelerator);
});

ipcMain.handle('clear-transcript', async () => {
  latestTranscriptText = '';
  resetTranscriptCursors();
  sendCaptionUpdate(translationManager.reset(''));

  if (captionSync && typeof captionSync.clearTranscript === 'function') {
    try {
      const result = await captionSync.clearTranscript();
      if (result && typeof result === 'object') {
        if (typeof result.liveCaptionsVisible === 'boolean') {
          liveCaptionsWindowVisible = result.liveCaptionsVisible;
          persistAppPreferencesSync();
          broadcastAppPreferences();
        }
        return result;
      }

      return {
        success: Boolean(result),
        liveCaptionsVisible: null
      };
    } catch (error) {
      console.error('[ERROR] Failed to clear transcript:', error);
    }
  }

  if (mainWindow && !mainWindow.isDestroyed()) {
    sendCaptionUpdate(translationManager.reset(''));
  }

  return {
    success: false,
    liveCaptionsVisible: null
  };
});

ipcMain.handle('toggle-live-captions-window', async () => {
  if (!captionSync || typeof captionSync.toggleLiveCaptionsVisibility !== 'function') {
    return null;
  }

  try {
    const isVisible = await captionSync.toggleLiveCaptionsVisibility();
    if (typeof isVisible === 'boolean') {
      liveCaptionsWindowVisible = isVisible;
      persistAppPreferencesSync();
      broadcastAppPreferences();
    }
    return isVisible;
  } catch (error) {
    console.error('[ERROR] Failed to toggle Live Captions window visibility:', error);
    throw error;
  }
});

ipcMain.handle('get-live-captions-window-visibility', async () => {
  if (!captionSync || typeof captionSync.getLiveCaptionsVisibility !== 'function') {
    return null;
  }

  try {
    const isVisible = await captionSync.getLiveCaptionsVisibility();
    if (typeof isVisible === 'boolean' && isVisible !== liveCaptionsWindowVisible) {
      liveCaptionsWindowVisible = isVisible;
      scheduleAppPreferencesPersist();
      broadcastAppPreferences();
    }
    return isVisible;
  } catch (error) {
    console.error('[ERROR] Failed to get Live Captions window visibility:', error);
    throw error;
  }
});

ipcMain.handle('get-active-tab', () => {
  if (activeTabId !== null) {
    const tab = tabs.get(activeTabId);
    if (tab) {
      return {
        id: activeTabId,
        url: tab.url,
        title: tab.title,
        canGoBack: tab.canGoBack,
        canGoForward: tab.canGoForward
      };
    }
  }
  return null;
});

ipcMain.handle('get-tabs', () => {
  const currentPanelSplitRatio = layoutMode === 'horizontal'
    ? horizontalTranscriptPanelRatio
    : verticalTranscriptPanelRatio;

  return {
    activeTabId,
    panelSplitRatio: currentPanelSplitRatio,
    transcriptPanelCollapsed: isTranscriptPanelCollapsed,
    modePanelCollapsed: isModePanelCollapsed,
    ...getAppPreferenceStateSnapshot(),
    ...getPromptModeStateSnapshot(),
    tabs: Array.from(tabs.values()).map((tab) => ({
      id: tab.id,
      url: tab.url,
      title: tab.title,
      canGoBack: tab.canGoBack,
      canGoForward: tab.canGoForward,
      isLoading: tab.isLoading
    }))
  };
});

// LiveCaptions IPC handlers
translationManager.on('updated', (payload) => {
  sendCaptionUpdate(payload);
});

if (captionSync) {
  // Handle caption updates from caption sync service
  captionSync.on('captionUpdate', (data) => {
    const liveCaptionText = typeof data?.fullText === 'string' ? data.fullText : '';
    const payload = translationManager.update(liveCaptionText);
    latestTranscriptText = payload.fullText;
    sendCaptionUpdate(payload);
  });

  captionSync.on('error', (error) => {
    console.error('[ERROR] Caption sync error:', error);
    latestTranscriptText = '';
    resetTranscriptCursors();
    translationManager.reset('');
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('caption-error', error.message || String(error));
    }
  });
}
