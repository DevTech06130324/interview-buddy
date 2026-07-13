const { app, BrowserWindow, WebContentsView, ipcMain, globalShortcut, screen, clipboard, nativeTheme, dialog } = require('electron');
const { safeStorage } = require('electron');
const { desktopCapturer } = require('electron');
const { randomUUID } = require('node:crypto');
const fs = require('fs');
const path = require('path');

const APP_PROCESS_NAME = 'Notepadd++';
const WINDOW_TITLE = 'Interview Assistant';
const APP_ICON_PATH = process.platform === 'win32'
  ? path.join(__dirname, 'assets', 'notepad-plus-plus.ico')
  : path.join(__dirname, 'assets', 'notepad-plus-plus.png');

app.setName(APP_PROCESS_NAME);
if (process.platform === 'win32') {
  app.setAppUserModelId(APP_PROCESS_NAME);
}
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
const { runSelectedAreaCaptureWorkflow } = require('./src/selectedAreaCaptureWorkflow');
const translationManager = require('./src/translationManager');
const {
  DeepgramTranscriptionService,
  normalizeDeepgramApiKey
} = require('./src/deepgramTranscriptionService');
const {
  DeepgramLifecycleCoordinator
} = require('./src/deepgramLifecycleCoordinator');
const {
  DeepgramRendererCommandBroker
} = require('./src/deepgramRendererCommandBroker');
const {
  encodeDeepgramApiKeyForStorage,
  loadAndMigrateDeepgramApiKeyPreferencesFile
} = require('./src/deepgramApiKeyStorage');
const {
  DEFAULT_ASSISTANT_URLS,
  ASSISTANT_COMPOSER_SELECTORS,
  ASSISTANT_SEND_BUTTON_SELECTORS,
  ASSISTANT_FILE_INPUT_SELECTORS,
  ASSISTANT_REVEAL_UPLOAD_BUTTON_SELECTORS,
  getAssistantTargetKind,
  isSupportedAssistantUrl: isSupportedAssistantTargetUrl
} = require('./src/assistantTargets');
const {
  ASSISTANT_NAVIGATION_ACTION,
  createAssistantNavigationPolicy
} = require('./src/assistantNavigationPolicy');
const {
  ASSISTANT_MUTATION_STATUS,
  AssistantMutationController
} = require('./src/assistantMutationController');
const {
  ASSISTANT_SUBMISSION_OUTCOME,
  needsAssistantSubmissionRetry,
  runAssistantSubmissionStrategies,
  shouldAdvanceAssistantTranscriptCursor
} = require('./src/assistantSubmissionOutcome');
const {
  waitForAssistantImageAttachmentEvidence
} = require('./src/assistantAttachmentEvidence');
const {
  attachTabView,
  createTabView,
  destroyTabView,
  detachTabView,
  setTabViewBounds
} = require('./src/tabViewManager');
const {
  TRANSCRIPT_SPEAKER_TAG,
  buildTranscriptPromptText,
  formatTranscriptEntryPromptLine,
  normalizeTranscriptPromptText,
  normalizeTranscriptSpeakerTag,
  shouldIncludeTranscriptSpeaker
} = require('./src/transcriptPrompt');
const {
  resolvePendingTranscriptCursor
} = require('./src/transcriptCursor');
const {
  normalizeTranscriptError
} = require('./src/transcriptError');
const {
  normalizeTranscriptSourceLifecycle
} = require('./src/transcriptSourceLifecycle');
const {
  getCaptionSyncErrorLifecycleState
} = require('./src/captionSyncErrorState');

// Constants
const BORDER_WIDTH = 3;
const PADDING_WIDTH = 10;
const APP_HEADBAR_HEIGHT = 38;
const TAB_BAR_HEIGHT = 40;
const URL_BAR_HEIGHT = 50;
const PANEL_DIVIDER_WIDTH = 10;
const MODE_PANEL_HEIGHT = 224;
const MODE_PANEL_COLLAPSED_HEIGHT = 54;
const MOVE_DISTANCE = 100;
const OPACITY_STEP = 0.1;
const MIN_OPACITY = 0.1;
const MAX_OPACITY = 1.0;
const DEFAULT_OPACITY = 1.0;
const DEFAULT_WINDOW_WIDTH = 430;
const DEFAULT_WINDOW_HEIGHT = 700;
const MIN_TRANSCRIPT_PANEL_WIDTH = 280;
const MIN_BROWSER_PANEL_WIDTH = 220;
const SCREEN_SELECTION_MIN_SIZE = 8;
const LEGACY_DEFAULT_PROMPT_MODE_SUFFIX = 'Interviewer said like this, what should i say right now. the answer must be in easy and friendly and funny way but looks professional and polite and not too long';
const DEFAULT_PROMPT_MODE_SUFFIX = 'What should i say right now? The answer must be easy, friendly, a little funny, professional, polite, and not too long.';
const PROMPT_MODE_STORE_FILE = 'prompt-modes.json';
const GLOBAL_HOTKEY_STORE_FILE = 'global-hotkeys.json';
const APP_PREFERENCES_STORE_FILE = 'app-preferences.json';
const TEMP_UPLOAD_DIR_NAME = 'assistant-temp-uploads';
const DEFAULT_PROMPT_MODE_NAME = 'Default';
const TRANSCRIPT_SAVE_DEFAULT_BASENAME = 'company name-meeting name';
const TRANSCRIPT_CURSOR_MISMATCH_ERROR = 'Transcript cursor mismatch. Retry after the transcript stabilizes, or clear the transcript to reset.';
const TRANSCRIPT_SOURCE_LIVE_CAPTIONS = 'live-captions';
const TRANSCRIPT_SOURCE_DEEPGRAM = 'deepgram';
const DEFAULT_TRANSCRIPT_SOURCE = TRANSCRIPT_SOURCE_LIVE_CAPTIONS;
const DEFAULT_TRANSLATION_ENABLED = false;
const DEEPGRAM_API_BASE_URL = 'https://api.deepgram.com/v1';
const DEEPGRAM_PROJECTS_ENDPOINT = `${DEEPGRAM_API_BASE_URL}/projects`;
const DEEPGRAM_BALANCES_ENDPOINT = 'balances';
const DEEPGRAM_USAGE_REFRESH_INTERVAL_MS = 60_000;
const DEFAULT_HORIZONTAL_TRANSCRIPT_PANEL_RATIO = 0.4;
const DEFAULT_TAB_URLS = DEFAULT_ASSISTANT_URLS;
const ALLOWED_NAVIGATION_PROTOCOLS = new Set(['http:', 'https:']);
const decideAssistantNavigation = createAssistantNavigationPolicy();
const ASSISTANT_COMPOSER_SELECTORS_SCRIPT = JSON.stringify(ASSISTANT_COMPOSER_SELECTORS);
const ASSISTANT_SEND_BUTTON_SELECTORS_SCRIPT = JSON.stringify(ASSISTANT_SEND_BUTTON_SELECTORS);
const ASSISTANT_FILE_INPUT_SELECTORS_SCRIPT = JSON.stringify(ASSISTANT_FILE_INPUT_SELECTORS);
const ASSISTANT_REVEAL_UPLOAD_BUTTON_SELECTORS_SCRIPT = JSON.stringify(ASSISTANT_REVEAL_UPLOAD_BUTTON_SELECTORS);
const COMPOSER_HELPERS_SCRIPT = `
        function isVisibleElement(element) {
          if (!element || typeof element.getBoundingClientRect !== 'function') {
            return false;
          }

          const style = window.getComputedStyle(element);
          const rect = element.getBoundingClientRect();
          const isHidden = style.display === 'none'
            || style.visibility === 'hidden'
            || style.opacity === '0'
            || element.getAttribute('aria-hidden') === 'true'
            || rect.width === 0
            || rect.height === 0;

          return !isHidden;
        }

        function isUsableComposer(element) {
          if (!element) return false;
          if ('disabled' in element && element.disabled) return false;
          if ('readOnly' in element && element.readOnly) return false;
          return isVisibleElement(element);
        }

        function elementMatchesComposer(element) {
          return Boolean(
            element
            && typeof element.matches === 'function'
            && composerSelectors.some((selector) => element.matches(selector))
          );
        }

        function findComposer() {
          for (const selector of composerSelectors) {
            for (const element of document.querySelectorAll(selector)) {
              if (isUsableComposer(element)) {
                return element;
              }
            }
          }

          const activeElement = document.activeElement;
          if (isUsableComposer(activeElement) && elementMatchesComposer(activeElement)) {
            return activeElement;
          }

          const activeComposer = activeElement?.closest?.(composerSelectors.join(', '));
          if (isUsableComposer(activeComposer)) {
            return activeComposer;
          }

          return null;
        }
`;
const COMPOSER_SCOPE_HELPERS_SCRIPT = `
        function getComposerScopes(composer) {
          return [
            composer,
            composer?.closest('form'),
            composer?.parentElement,
            composer?.closest('[data-testid], section, main, div'),
            document,
            document.body
          ].filter(Boolean);
        }
`;

class PromptModePersistenceController {
  constructor({
    serialize,
    getStorePath,
    fsModule = fs,
    debounceMs = 150,
    setTimeoutImpl = setTimeout,
    clearTimeoutImpl = clearTimeout,
    onStatus = () => {}
  } = {}) {
    if (typeof serialize !== 'function') {
      throw new TypeError('Prompt mode persistence requires serialize().');
    }
    if (typeof getStorePath !== 'function') {
      throw new TypeError('Prompt mode persistence requires getStorePath().');
    }

    this.serialize = serialize;
    this.getStorePath = getStorePath;
    this.fs = fsModule;
    this.debounceMs = debounceMs;
    this.setTimeout = setTimeoutImpl;
    this.clearTimeout = clearTimeoutImpl;
    this.onStatus = onStatus;
    this.timer = null;
    this.pending = null;
    this.inFlight = null;
    this.lastSynchronousFlush = null;
    this.revision = 0;
    this.status = {
      state: 'saved',
      dirty: false,
      message: '',
      revision: 0
    };
  }

  getStatus() {
    return { ...this.status };
  }

  setStatus(nextStatus) {
    this.status = {
      state: nextStatus.state,
      dirty: Boolean(nextStatus.dirty),
      message: typeof nextStatus.message === 'string' ? nextStatus.message : '',
      revision: Number.isSafeInteger(nextStatus.revision) ? nextStatus.revision : this.revision
    };
    this.onStatus(this.getStatus());
  }

  clearScheduledFlush() {
    if (this.timer !== null) {
      this.clearTimeout(this.timer);
      this.timer = null;
    }
  }

  writePayloadSync(pending) {
    const storePath = this.getStorePath();
    this.fs.mkdirSync(path.dirname(storePath), { recursive: true });
    this.fs.writeFileSync(storePath, pending.payload, 'utf8');
  }

  schedule() {
    this.revision += 1;
    this.pending = {
      revision: this.revision,
      payload: this.serialize()
    };
    this.clearScheduledFlush();
    this.setStatus({
      state: 'dirty',
      dirty: true,
      message: '',
      revision: this.revision
    });
    this.timer = this.setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, this.debounceMs);
    return this.getStatus();
  }

  writePending() {
    const pending = this.pending;
    if (!pending) {
      return {
        success: this.status.state !== 'error',
        status: this.getStatus()
      };
    }

    this.pending = null;
    this.setStatus({
      state: 'saving',
      dirty: true,
      message: '',
      revision: pending.revision
    });

    const operation = (async () => {
      try {
        const storePath = this.getStorePath();
        await this.fs.promises.mkdir(path.dirname(storePath), { recursive: true });
        await this.fs.promises.writeFile(storePath, pending.payload, 'utf8');

        const supersedingSyncFlush = this.lastSynchronousFlush;
        if (supersedingSyncFlush && supersedingSyncFlush.revision > pending.revision) {
          this.writePayloadSync(supersedingSyncFlush);
        }

        if (this.pending) {
          this.setStatus({
            state: 'dirty',
            dirty: true,
            message: '',
            revision: this.pending.revision
          });
        } else {
          this.setStatus({
            state: 'saved',
            dirty: false,
            message: '',
            revision: supersedingSyncFlush && supersedingSyncFlush.revision > pending.revision
              ? supersedingSyncFlush.revision
              : pending.revision
          });
        }
        return {
          success: true,
          status: this.getStatus()
        };
      } catch (error) {
        const retryPending = this.lastSynchronousFlush
          && this.lastSynchronousFlush.revision > pending.revision
          ? this.lastSynchronousFlush
          : pending;
        if (!this.pending || this.pending.revision < retryPending.revision) {
          this.pending = retryPending;
        }

        this.setStatus({
          state: 'error',
          dirty: true,
          message: error instanceof Error && error.message
            ? error.message
            : 'Failed to save prompt modes.',
          revision: retryPending.revision
        });
        return {
          success: false,
          status: this.getStatus()
        };
      }
    })();
    this.inFlight = operation;
    return operation.finally(() => {
      if (this.inFlight === operation) {
        this.inFlight = null;
      }
    });
  }

  async flush() {
    this.clearScheduledFlush();
    let result = null;

    while (this.inFlight || this.pending) {
      if (this.inFlight) {
        result = await this.inFlight;
      } else {
        result = await this.writePending();
      }

      if (!result.success) {
        return result;
      }
    }

    return result || {
      success: this.status.state !== 'error',
      status: this.getStatus()
    };
  }

  flushSync() {
    this.clearScheduledFlush();
    this.revision += 1;
    const pending = {
      revision: this.revision,
      payload: this.serialize()
    };
    this.pending = null;
    this.lastSynchronousFlush = pending;

    try {
      this.writePayloadSync(pending);
      this.setStatus({
        state: 'saved',
        dirty: false,
        message: '',
        revision: pending.revision
      });
      return {
        success: true,
        status: this.getStatus()
      };
    } catch (error) {
      this.pending = pending;
      this.setStatus({
        state: 'error',
        dirty: true,
        message: error instanceof Error && error.message
          ? error.message
          : 'Failed to save prompt modes.',
        revision: pending.revision
      });
      return {
        success: false,
        status: this.getStatus()
      };
    }
  }
}
const SEND_BUTTON_HELPERS_SCRIPT = `
        function isButtonReady(button) {
          if (!button) return false;

          const isDisabled = button.disabled
            || button.getAttribute('aria-disabled') === 'true'
            || button.matches('[disabled]');

          return !isDisabled && isVisibleElement(button);
        }

        function getSendButtonSearchScopes(composer) {
          return [
            composer?.closest('form'),
            composer?.parentElement,
            composer?.closest('[data-testid], section, main, div'),
            document
          ].filter(Boolean);
        }

        function findSendButton(composer) {
          const candidates = [];
          const seen = new Set();

          for (const root of getSendButtonSearchScopes(composer)) {
            if (!root || typeof root.querySelectorAll !== 'function') continue;

            for (const selector of buttonSelectors) {
              for (const button of root.querySelectorAll(selector)) {
                if (!button || seen.has(button)) continue;
                seen.add(button);
                candidates.push(button);
              }
            }
          }

          for (const button of candidates) {
            if (isButtonReady(button)) {
              return button;
            }
          }

          return null;
        }
`;

function getWindowIconOptions() {
  return fs.existsSync(APP_ICON_PATH) ? { icon: APP_ICON_PATH } : {};
}

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
  }
];

// State
let mainWindow;
let hotkeySettingsWindow = null;
let modeMenuWindow = null;
let modeMenuAnchor = null;
const tabs = new Map();
const assistantMutationController = new AssistantMutationController();
const assistantPopupWindows = new Set();
let activeTabId = null;
let tabIdCounter = 0;
let currentOpacity = DEFAULT_OPACITY;
let isWindowVisible = true;
let isMuted = false;
let appWindowBounds = {
  width: DEFAULT_WINDOW_WIDTH,
  height: DEFAULT_WINDOW_HEIGHT
};
let horizontalTranscriptPanelRatio = DEFAULT_HORIZONTAL_TRANSCRIPT_PANEL_RATIO;
let isModePanelCollapsed = true;
let translationsVisible = false;
let translationEnabled = DEFAULT_TRANSLATION_ENABLED;
let liveCaptionsWindowVisible = true;
let transcriptSource = DEFAULT_TRANSCRIPT_SOURCE;
let deepgramApiKey = '';
let deepgramApiKeyStorage = null;
let deepgramTranscriptionService = null;
let deepgramLifecycleCoordinator = null;
let deepgramRendererCommandBroker = null;
let deepgramTranscriptionActive = false;
let deepgramUsageLastFetchedAtMs = 0;
let deepgramUsageRefreshPromise = null;
let deepgramUsageRefreshApiKey = '';
let deepgramAccountUsageSnapshot = {
  status: 'idle',
  remainingText: 'Remaining unavailable'
};
let captureOverlayState = null;
const shortcutCooldowns = new Map();
const registeredGlobalHotkeys = new Map();
const registeredModeHotkeys = new Map();
let latestTranscriptText = '';
let promptModes = createDefaultPromptModes();
let globalHotkeys = createDefaultGlobalHotkeys();
let selectedPromptModeId = promptModes[0].id;
let captionSyncStartTimer = null;
let liveCaptionsSessionId = typeof captionSync?.getSessionId === 'function'
  ? captionSync.getSessionId()
  : randomUUID();
let deepgramTranscriptSessionId = randomUUID();
let promptModePersistenceController = null;
let promptModePersistenceStatus = {
  state: 'saved',
  dirty: false,
  message: '',
  revision: 0
};
const promptModeDraftRevisions = new Map();
let appPreferencesPersistTimer = null;
let defaultTabWarmupTimer = null;
let lastSubmittedTranscriptText = '';
let lastClipboardTranscriptText = '';
let latestTranscriptEntries = [];
let lastSubmittedTranscriptEntries = [];
let lastClipboardTranscriptEntries = [];
let appQuitRequested = false;
let liveCaptionsExitCleanupComplete = false;
let liveCaptionsExitCleanupPromise = null;
const temporaryUploadCleanupTimers = new Set();

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

function getTemporaryUploadDir() {
  return path.join(app.getPath('temp'), TEMP_UPLOAD_DIR_NAME);
}

async function cleanupTemporaryUploadDir() {
  clearTemporaryUploadCleanupTimers();

  try {
    await fs.promises.rm(getTemporaryUploadDir(), { recursive: true, force: true });
  } catch (error) {
    console.error('[WARNING] Failed to clean temporary upload directory:', error);
  }
}

function isSenderFromWindow(event, targetWindow) {
  return Boolean(
    event
    && targetWindow
    && !targetWindow.isDestroyed()
    && event.sender === targetWindow.webContents
  );
}

function isMainWindowSender(event) {
  return isSenderFromWindow(event, mainWindow);
}

function isHotkeySettingsWindowSender(event) {
  return isSenderFromWindow(event, hotkeySettingsWindow);
}

function isModeMenuWindowSender(event) {
  return isSenderFromWindow(event, modeMenuWindow);
}

function isCaptureOverlaySender(event) {
  return Boolean(
    captureOverlayState
    && captureOverlayState.window
    && isSenderFromWindow(event, captureOverlayState.window)
  );
}

function isMainOrHotkeySettingsSender(event) {
  return isMainWindowSender(event) || isHotkeySettingsWindowSender(event);
}

function isMainOrModeMenuSender(event) {
  return isMainWindowSender(event) || isModeMenuWindowSender(event);
}

function rejectUnauthorizedIpc(channel, fallbackValue = false) {
  console.warn(`[WARNING] Ignored unauthorized IPC call: ${channel}`);
  return fallbackValue;
}

function normalizeAllowedNavigationUrl(url) {
  const requestedUrl = typeof url === 'string' && url.trim()
    ? url.trim()
    : 'about:blank';

  if (requestedUrl === 'about:blank') {
    return requestedUrl;
  }

  try {
    const parsedUrl = new URL(requestedUrl);
    return ALLOWED_NAVIGATION_PROTOCOLS.has(parsedUrl.protocol)
      ? parsedUrl.toString()
      : null;
  } catch (error) {
    return null;
  }
}

function isAllowedNavigationUrl(url) {
  return Boolean(normalizeAllowedNavigationUrl(url));
}

function serializePromptModeStateSnapshot() {
  return JSON.stringify(getPromptModeStateData(), null, 2);
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

function getPromptModePersistenceStatus() {
  return { ...promptModePersistenceStatus };
}

function broadcastPromptModePersistenceStatus() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('prompt-mode-persistence-status', getPromptModePersistenceStatus());
  }
}

function updatePromptModePersistenceStatus(status) {
  promptModePersistenceStatus = {
    state: typeof status?.state === 'string' ? status.state : 'saved',
    dirty: Boolean(status?.dirty),
    message: typeof status?.message === 'string' ? status.message : '',
    revision: Number.isSafeInteger(status?.revision) ? status.revision : 0
  };

  if (promptModePersistenceStatus.state === 'error') {
    console.error('[ERROR] Failed to save prompt mode state:', promptModePersistenceStatus.message);
  }

  broadcastPromptModePersistenceStatus();
}

function getPromptModePersistenceController() {
  if (!promptModePersistenceController) {
    promptModePersistenceController = new PromptModePersistenceController({
      serialize: serializePromptModeStateSnapshot,
      getStorePath: getPromptModeStorePath,
      onStatus: updatePromptModePersistenceStatus
    });
  }

  return promptModePersistenceController;
}

function getPromptModeStateData() {
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

function getPromptModeStateSnapshot() {
  return {
    ...getPromptModeStateData(),
    promptModePersistence: getPromptModePersistenceStatus()
  };
}

function broadcastPromptModeState() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('prompt-mode-state', getPromptModeStateSnapshot());
  }

  broadcastModeMenuState();
}

function normalizeBoolean(value, fallback) {
  return typeof value === 'boolean' ? value : fallback;
}

function normalizeTranscriptSource(value) {
  return value === TRANSCRIPT_SOURCE_DEEPGRAM
    ? TRANSCRIPT_SOURCE_DEEPGRAM
    : TRANSCRIPT_SOURCE_LIVE_CAPTIONS;
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

function setDeepgramApiKeyInMemory(apiKey) {
  deepgramApiKey = normalizeDeepgramApiKey(apiKey);
  deepgramApiKeyStorage = encodeDeepgramApiKeyForStorage(deepgramApiKey, safeStorage);
}

function clearDeepgramApiKeyInMemory() {
  deepgramApiKey = '';
  deepgramApiKeyStorage = null;
}

function getDeepgramApiKeyLast4() {
  return deepgramApiKey ? deepgramApiKey.slice(-4) : '';
}

function getDeepgramConnectionApiKey() {
  return deepgramApiKey;
}

function formatDeepgramBalanceAmount(amount) {
  const numericAmount = Number(amount);
  if (!Number.isFinite(numericAmount)) {
    return 'Remaining unavailable';
  }

  return `$${Math.max(0, numericAmount).toFixed(2)} left`;
}

function getDeepgramProjectId(projectsPayload) {
  const projects = Array.isArray(projectsPayload?.projects)
    ? projectsPayload.projects
    : (Array.isArray(projectsPayload) ? projectsPayload : []);
  const firstProject = projects.find((project) => project && typeof project === 'object');
  return String(firstProject?.project_id || firstProject?.id || '').trim();
}

function getDeepgramBalanceAmount(balancesPayload) {
  const balances = Array.isArray(balancesPayload?.balances)
    ? balancesPayload.balances
    : (Array.isArray(balancesPayload) ? balancesPayload : []);

  const amounts = balances
    .map((balance) => Number(
      balance?.amount
      ?? balance?.balance
      ?? balance?.remaining
      ?? balance?.available
    ))
    .filter(Number.isFinite);

  if (amounts.length === 0) {
    return null;
  }

  return amounts.reduce((total, amount) => total + amount, 0);
}

function getDeepgramBalancesEndpoint(projectId) {
  return `${DEEPGRAM_API_BASE_URL}/projects/${encodeURIComponent(projectId)}/${DEEPGRAM_BALANCES_ENDPOINT}`;
}

async function fetchDeepgramJson(url, apiKey) {
  if (typeof fetch !== 'function') {
    throw new Error('Fetch is not available in this runtime.');
  }

  const response = await fetch(url, {
    headers: {
      Authorization: `Token ${apiKey}`,
      Accept: 'application/json'
    }
  });

  if (!response.ok) {
    throw new Error(`Deepgram usage request failed with HTTP ${response.status}`);
  }

  return response.json();
}

function getDeepgramUsageSnapshot() {
  if (!deepgramApiKey) {
    return {
      active: deepgramTranscriptionActive,
      remainingText: 'Add API key'
    };
  }

  return {
    active: deepgramTranscriptionActive,
    remainingText: deepgramAccountUsageSnapshot.remainingText
  };
}

async function refreshDeepgramAccountUsage() {
  if (!deepgramApiKey) {
    deepgramAccountUsageSnapshot = {
      status: 'missing-api-key',
      remainingText: 'Add API key'
    };
    return getDeepgramUsageSnapshot();
  }

  const now = Date.now();
  if (
    deepgramAccountUsageSnapshot.status !== 'idle'
    && now - deepgramUsageLastFetchedAtMs < DEEPGRAM_USAGE_REFRESH_INTERVAL_MS
  ) {
    return getDeepgramUsageSnapshot();
  }

  const requestApiKey = deepgramApiKey;
  if (deepgramUsageRefreshPromise && deepgramUsageRefreshApiKey === requestApiKey) {
    return deepgramUsageRefreshPromise;
  }

  deepgramUsageRefreshApiKey = requestApiKey;
  const refreshPromise = (async () => {
    try {
      const projectsPayload = await fetchDeepgramJson(DEEPGRAM_PROJECTS_ENDPOINT, requestApiKey);
      const projectId = getDeepgramProjectId(projectsPayload);
      if (!projectId) {
        throw new Error('No Deepgram project is available for this key.');
      }

      const balancesPayload = await fetchDeepgramJson(getDeepgramBalancesEndpoint(projectId), requestApiKey);
      const balanceAmount = getDeepgramBalanceAmount(balancesPayload);

      if (deepgramUsageRefreshPromise === refreshPromise && requestApiKey === deepgramApiKey) {
        deepgramAccountUsageSnapshot = {
          status: Number.isFinite(balanceAmount) ? 'available' : 'unavailable',
          remainingText: Number.isFinite(balanceAmount)
            ? formatDeepgramBalanceAmount(balanceAmount)
            : 'Remaining unavailable'
        };
      }
    } catch (error) {
      if (deepgramUsageRefreshPromise === refreshPromise && requestApiKey === deepgramApiKey) {
        deepgramAccountUsageSnapshot = {
          status: 'unavailable',
          remainingText: 'Remaining unavailable'
        };
      }
    } finally {
      if (deepgramUsageRefreshPromise === refreshPromise) {
        deepgramUsageLastFetchedAtMs = Date.now();
        deepgramUsageRefreshPromise = null;
        deepgramUsageRefreshApiKey = '';
      }
    }

    return getDeepgramUsageSnapshot();
  })();

  deepgramUsageRefreshPromise = refreshPromise;
  return deepgramUsageRefreshPromise;
}

function getRendererAppPreferenceStateSnapshot() {
  return {
    horizontalTranscriptPanelRatio,
    windowBounds: getCurrentWindowBoundsSnapshot(),
    opacity: currentOpacity,
    isMuted,
    modePanelCollapsed: isModePanelCollapsed,
    translationsVisible,
    translationEnabled,
    liveCaptionsWindowVisible,
    transcriptSource,
    transcriptSourceState: getTranscriptSourceLifecycleSnapshot(transcriptSource),
    hasDeepgramApiKey: Boolean(deepgramApiKey),
    deepgramApiKeyLast4: getDeepgramApiKeyLast4(),
    deepgramUsage: getDeepgramUsageSnapshot()
  };
}

function getAppPreferenceStateSnapshot() {
  return getRendererAppPreferenceStateSnapshot();
}

function refreshDeepgramApiKeyStorage() {
  if (deepgramApiKey && !deepgramApiKeyStorage) {
    deepgramApiKeyStorage = encodeDeepgramApiKeyForStorage(deepgramApiKey, safeStorage);
  }
}

function getPersistedAppPreferenceStateSnapshot() {
  refreshDeepgramApiKeyStorage();
  return {
    ...getRendererAppPreferenceStateSnapshot(),
    deepgramApiKeyStorage
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
      JSON.stringify(getPersistedAppPreferenceStateSnapshot(), null, 2)
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
  let shouldRewriteDeepgramStorage = false;
  try {
    const deepgramKeyLoadResult = loadAndMigrateDeepgramApiKeyPreferencesFile(
      getAppPreferencesStorePath(),
      safeStorage
    );
    const parsed = deepgramKeyLoadResult.preferences;

    horizontalTranscriptPanelRatio = normalizeSplitRatio(
      parsed?.horizontalTranscriptPanelRatio,
      DEFAULT_HORIZONTAL_TRANSCRIPT_PANEL_RATIO
    );
    appWindowBounds = normalizeWindowBounds(parsed?.windowBounds) || appWindowBounds;
    currentOpacity = normalizeOpacity(parsed?.opacity);
    isMuted = normalizeBoolean(parsed?.isMuted, false);
    isModePanelCollapsed = normalizeBoolean(parsed?.modePanelCollapsed, true);
    translationsVisible = normalizeBoolean(parsed?.translationsVisible, false);
    translationEnabled = normalizeBoolean(parsed?.translationEnabled, DEFAULT_TRANSLATION_ENABLED);
    liveCaptionsWindowVisible = normalizeBoolean(parsed?.liveCaptionsWindowVisible, true);
    transcriptSource = normalizeTranscriptSource(parsed?.transcriptSource);
    deepgramApiKeyStorage = deepgramKeyLoadResult.storage;
    deepgramApiKey = normalizeDeepgramApiKey(deepgramKeyLoadResult.apiKey);
    shouldRewriteDeepgramStorage = deepgramKeyLoadResult.needsRewrite;
    if (transcriptSource === TRANSCRIPT_SOURCE_DEEPGRAM && !deepgramApiKey) {
      transcriptSource = TRANSCRIPT_SOURCE_LIVE_CAPTIONS;
    }
  } catch (error) {
    horizontalTranscriptPanelRatio = DEFAULT_HORIZONTAL_TRANSCRIPT_PANEL_RATIO;
    appWindowBounds = {
      width: DEFAULT_WINDOW_WIDTH,
      height: DEFAULT_WINDOW_HEIGHT
    };
    currentOpacity = DEFAULT_OPACITY;
    isMuted = false;
    isModePanelCollapsed = true;
    translationsVisible = false;
    translationEnabled = DEFAULT_TRANSLATION_ENABLED;
    liveCaptionsWindowVisible = true;
    transcriptSource = DEFAULT_TRANSCRIPT_SOURCE;
    deepgramApiKey = '';
    deepgramApiKeyStorage = null;
  }

  translationManager.setTranslationEnabled(translationEnabled);
  if (shouldRewriteDeepgramStorage) {
    persistAppPreferencesSync();
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

  broadcastModeMenuState();
}

function applyNativeTheme() {
  nativeTheme.themeSource = 'dark';
}

function getDarkWindowBackground() {
  return '#181818';
}

function applyOpacityToWindow(targetWindow) {
  if (targetWindow && !targetWindow.isDestroyed()) {
    targetWindow.setOpacity(currentOpacity);
  }
}

function applyOpacityToAppWindows() {
  applyOpacityToWindow(mainWindow);
  applyOpacityToWindow(hotkeySettingsWindow);
  applyOpacityToWindow(modeMenuWindow);
}

function setTranslationVisible(isVisible) {
  translationsVisible = Boolean(isVisible);
  scheduleAppPreferencesPersist();
  broadcastAppPreferences();
  return getAppPreferenceStateSnapshot();
}

function setTranslationEnabled(isEnabled) {
  translationEnabled = Boolean(isEnabled);
  translationManager.setTranslationEnabled(translationEnabled);
  scheduleAppPreferencesPersist();
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
      scheduleAppPreferencesPersist();
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
        applyOpacityToAppWindows();
        scheduleAppPreferencesPersist();
      }
      return;
    case 'opacityDown':
      if (currentOpacity > MIN_OPACITY && mainWindow) {
        currentOpacity = Math.max(MIN_OPACITY, currentOpacity - OPACITY_STEP);
        applyOpacityToAppWindows();
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
        closeModeMenuWindow();
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
    default:
      console.error(`[ERROR] Unknown global hotkey action: ${id}`);
  }
}

function unregisterGlobalHotkey(id) {
  const registeredHotkey = registeredGlobalHotkeys.get(id);
  if (!registeredHotkey) {
    return;
  }

  try {
    globalShortcut.unregister(registeredHotkey);
  } catch (error) {
    console.error('[WARNING] Failed to unregister global hotkey:', error);
  }
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

  let registered = false;
  try {
    registered = globalShortcut.register(nextAccelerator, () => {
      runGlobalHotkeyAction(id);
    });
  } catch (error) {
    console.error(`[ERROR] Failed to register global hotkey "${nextAccelerator}" for "${definition.label}":`, error);
    registered = false;
  }

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
      try {
        globalShortcut.unregister(previousRegisteredAccelerator);
      } catch (error) {
        console.error('[WARNING] Failed to unregister previous global hotkey:', error);
      }
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

  try {
    globalShortcut.unregister(registeredHotkey);
  } catch (error) {
    console.error('[WARNING] Failed to unregister prompt mode hotkey:', error);
  }
  registeredModeHotkeys.delete(modeId);
}

function registerModeHotkey(modeId, hotkey) {
  const accelerator = typeof hotkey === 'string' ? hotkey.trim() : '';
  if (!accelerator) {
    unregisterModeHotkey(modeId);
    return true;
  }

  let registered = false;
  try {
    registered = globalShortcut.register(accelerator, () => {
      if (isHotkeySettingsWindowFocused()) {
        return;
      }

      void selectPromptMode(modeId).catch((error) => {
        console.error('[ERROR] Failed to select prompt mode from its hotkey:', error);
      });
    });
  } catch (error) {
    console.error('[ERROR] Failed to register prompt mode hotkey:', error);
    registered = false;
  }

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
  return getPromptModePersistenceController().schedule();
}

async function flushPromptModeStatePersist() {
  return getPromptModePersistenceController().flush();
}

function flushPromptModeStatePersistSync() {
  return getPromptModePersistenceController().flushSync();
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
  promptModeDraftRevisions.delete(modeId);

  if (selectedPromptModeId === modeId) {
    const fallbackMode = promptModes[modeIndex] || promptModes[modeIndex - 1] || promptModes[0];
    selectedPromptModeId = fallbackMode?.id || promptModes[0].id;
  }

  persistPromptModeState();
  broadcastPromptModeState();
  return getPromptModeStateSnapshot();
}

function normalizePromptModeDraftSessionId(value) {
  if (typeof value !== 'string') {
    return null;
  }

  const sessionId = value.trim();
  return sessionId && sessionId.length <= 128 ? sessionId : null;
}

function normalizePromptModeDraftRevision(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function updatePromptModeDraft(modeId, suffix, draftSessionId, draftRevision) {
  ensurePromptModeState();

  const mode = promptModes.find((entry) => entry.id === modeId);
  if (!mode) {
    throw new Error(`Prompt mode "${modeId}" was not found.`);
  }

  const sessionId = normalizePromptModeDraftSessionId(draftSessionId);
  const revision = normalizePromptModeDraftRevision(draftRevision);
  const previousRevision = sessionId && revision !== null
    ? promptModeDraftRevisions.get(modeId)
    : null;

  if (
    previousRevision
    && previousRevision.sessionId === sessionId
    && revision <= previousRevision.revision
  ) {
    return {
      accepted: false,
      revision,
      promptModePersistence: getPromptModePersistenceStatus()
    };
  }

  mode.suffix = typeof suffix === 'string' ? suffix : '';
  if (sessionId && revision !== null) {
    promptModeDraftRevisions.set(modeId, {
      sessionId,
      revision
    });
  }

  return {
    accepted: true,
    revision,
    promptModePersistence: persistPromptModeState()
  };
}

async function selectPromptMode(modeId) {
  ensurePromptModeState();

  if (typeof modeId === 'string' && promptModes.some((mode) => mode.id === modeId)) {
    selectedPromptModeId = modeId;
    persistPromptModeState();
    broadcastPromptModeState();
    await flushPromptModeStatePersist();
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

function clearRuntimeTimersForMainWindowClose() {
  if (captionSyncStartTimer) {
    clearTimeout(captionSyncStartTimer);
    captionSyncStartTimer = null;
  }

  if (defaultTabWarmupTimer) {
    clearTimeout(defaultTabWarmupTimer);
    defaultTabWarmupTimer = null;
  }

  if (appPreferencesPersistTimer) {
    clearTimeout(appPreferencesPersistTimer);
    appPreferencesPersistTimer = null;
  }
}

function destroyAllTabs() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    try {
      const activeTab = tabs.get(activeTabId);
      if (activeTab) {
        detachTabView(mainWindow, activeTab.view);
      }
    } catch (error) {
      console.error('[WARNING] Failed to detach active WebContentsView:', error);
    }
  }

  for (const tab of tabs.values()) {
    try {
      destroyTabView(mainWindow, tab?.view);
    } catch (error) {
      console.error('[WARNING] Failed to destroy tab webContents:', error);
    }
  }

  tabs.clear();
  activeTabId = null;
}

function closeCaptureOverlayWindow() {
  if (!captureOverlayState) {
    return;
  }

  resolveScreenSelection(null);
}

function cleanupMainWindowResources() {
  deepgramRendererCommandBroker?.cancelAll();
  closeModeMenuWindow();
  closeCaptureOverlayWindow();
  clearRuntimeTimersForMainWindowClose();
  destroyAllTabs();
}

function bindMainWindowLifecycle(targetWindow) {
  targetWindow.webContents.on('render-process-gone', () => {
    deepgramRendererCommandBroker?.cancelAll();
  });
  targetWindow.webContents.once('destroyed', () => {
    deepgramRendererCommandBroker?.cancelAll();
  });
  targetWindow.once('ready-to-show', () => {
    if (targetWindow.isDestroyed() || mainWindow !== targetWindow) {
      return;
    }

    createDefaultTabs();
    startActiveTranscriptSource();
  });

  targetWindow.on('resize', () => {
    closeModeMenuWindow();
    resizeTabs();
    scheduleAppPreferencesPersist();
  });

  targetWindow.on('move', () => {
    closeModeMenuWindow();
    scheduleAppPreferencesPersist();
  });

  targetWindow.on('close', (event) => {
    if (!liveCaptionsExitCleanupComplete) {
      event.preventDefault();
      requestAppQuit();
      return;
    }

    flushAppPreferencesPersist();
    cleanupMainWindowResources();
  });

  targetWindow.once('closed', () => {
    if (mainWindow === targetWindow) {
      mainWindow = null;
    }
  });
}

function isMainWindowDisplayMediaRequest(request) {
  const frameUrl = typeof request?.frame?.url === 'string' ? request.frame.url : '';
  return Boolean(
    mainWindow
    && !mainWindow.isDestroyed()
    && request?.frame
    && request.frame === mainWindow.webContents.mainFrame
    && frameUrl.startsWith('file://')
  );
}

function configureMainWindowDisplayMediaCapture(targetWindow) {
  const targetSession = targetWindow?.webContents?.session;
  if (!targetSession || typeof targetSession.setDisplayMediaRequestHandler !== 'function') {
    return;
  }

  targetSession.setDisplayMediaRequestHandler(async (request, callback) => {
    if (!isMainWindowDisplayMediaRequest(request)) {
      callback({});
      return;
    }

    try {
      const sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: {
          width: 0,
          height: 0
        }
      });
      const screenSource = sources[0];

      if (!screenSource) {
        callback({});
        return;
      }

      const streams = {
        video: request.videoRequested ? screenSource : undefined,
        audio: request.audioRequested && process.platform === 'win32' ? 'loopback' : undefined
      };
      callback(streams);
    } catch (error) {
      console.error('[ERROR] Failed to resolve display media source for Deepgram capture:', error);
      callback({});
    }
  });
}

function createWindow() {
  const restoredBounds = getRestoredWindowBounds();

  mainWindow = new BrowserWindow({
    ...restoredBounds,
    ...getWindowIconOptions(),
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
  configureMainWindowDisplayMediaCapture(mainWindow);

  mainWindow.loadFile('index.html');

  setupGlobalShortcuts();
  bindMainWindowLifecycle(mainWindow);
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
    hotkeySettingsWindow.setBackgroundColor(getDarkWindowBackground());
    hotkeySettingsWindow.setOpacity(currentOpacity);
    hotkeySettingsWindow.show();
    hotkeySettingsWindow.focus();
    return true;
  }

  const bounds = getCenteredHotkeySettingsBounds(width, height);
  hotkeySettingsWindow = new BrowserWindow({
    ...bounds,
    ...getWindowIconOptions(),
    title: WINDOW_TITLE,
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
    backgroundColor: getDarkWindowBackground(),
    opacity: currentOpacity,
    modal: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  hotkeySettingsWindow.setContentProtection(true);
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

function normalizeModeMenuAnchor(anchor) {
  if (!anchor || typeof anchor !== 'object') {
    return null;
  }

  const x = Number(anchor.x);
  const y = Number(anchor.y);
  const width = Number(anchor.width);
  const height = Number(anchor.height);

  if (![x, y, width, height].every(Number.isFinite)) {
    return null;
  }

  return {
    x: Math.round(x),
    y: Math.round(y),
    width: Math.max(120, Math.round(width)),
    height: Math.max(24, Math.round(height))
  };
}

function getModeMenuStateSnapshot() {
  return getPromptModeStateSnapshot();
}

function getModeMenuContentHeight() {
  const modeCount = Math.max(1, Array.isArray(promptModes) ? promptModes.length : 1);
  return Math.min(320, Math.max(104, 32 + (modeCount * 42) + 48));
}

function getModeMenuBounds(anchor = modeMenuAnchor) {
  const normalizedAnchor = normalizeModeMenuAnchor(anchor) || {
    x: 0,
    y: 0,
    width: 280,
    height: 40
  };
  const mainBounds = mainWindow && !mainWindow.isDestroyed()
    ? mainWindow.getBounds()
    : screen.getPrimaryDisplay().workArea;
  const preferredWidth = Math.max(260, normalizedAnchor.width);
  const initialX = mainBounds.x + normalizedAnchor.x;
  const initialY = mainBounds.y + normalizedAnchor.y;
  const display = screen.getDisplayMatching({
    x: initialX,
    y: initialY,
    width: preferredWidth,
    height: normalizedAnchor.height
  });
  const workArea = display.workArea;
  const width = Math.min(preferredWidth, Math.max(220, workArea.width - 12));
  const height = Math.min(getModeMenuContentHeight(), Math.max(96, workArea.height - 12));
  const aboveY = initialY - height - 8;
  const belowY = initialY + normalizedAnchor.height + 8;
  const preferredY = aboveY >= workArea.y + 6 ? aboveY : belowY;

  return {
    x: Math.round(Math.min(
      workArea.x + workArea.width - width - 6,
      Math.max(workArea.x + 6, initialX)
    )),
    y: Math.round(Math.min(
      workArea.y + workArea.height - height - 6,
      Math.max(workArea.y + 6, preferredY)
    )),
    width: Math.round(width),
    height: Math.round(height)
  };
}

function positionModeMenuWindow(anchor = modeMenuAnchor) {
  if (!modeMenuWindow || modeMenuWindow.isDestroyed()) {
    return;
  }

  modeMenuWindow.setBounds(getModeMenuBounds(anchor));
}

function broadcastModeMenuState() {
  if (!modeMenuWindow || modeMenuWindow.isDestroyed()) {
    return;
  }

  positionModeMenuWindow();
  modeMenuWindow.webContents.send('mode-menu-state', getModeMenuStateSnapshot());
}

function closeModeMenuWindow() {
  if (!modeMenuWindow || modeMenuWindow.isDestroyed()) {
    return false;
  }

  modeMenuWindow.close();
  return true;
}

async function openModeMenuWindow(anchor) {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return false;
  }

  const normalizedAnchor = normalizeModeMenuAnchor(anchor);
  if (normalizedAnchor) {
    modeMenuAnchor = normalizedAnchor;
  }

  if (modeMenuWindow && !modeMenuWindow.isDestroyed()) {
    positionModeMenuWindow();
    modeMenuWindow.setOpacity(currentOpacity);
    modeMenuWindow.show();
    modeMenuWindow.focus();
    broadcastModeMenuState();
    return true;
  }

  const menuWindow = new BrowserWindow({
    ...getModeMenuBounds(modeMenuAnchor),
    ...getWindowIconOptions(),
    title: WINDOW_TITLE,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    show: false,
    hasShadow: false,
    backgroundColor: '#00000000',
    opacity: currentOpacity,
    modal: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });
  modeMenuWindow = menuWindow;

  menuWindow.setContentProtection(true);
  menuWindow.setAlwaysOnTop(true, 'screen-saver');
  menuWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  menuWindow.setMenuBarVisibility(false);
  if (typeof menuWindow.removeMenu === 'function') {
    menuWindow.removeMenu();
  }

  menuWindow.on('blur', () => {
    setTimeout(() => {
      if (modeMenuWindow && !modeMenuWindow.isDestroyed() && !modeMenuWindow.isFocused()) {
        closeModeMenuWindow();
      }
    }, 120);
  });

  return new Promise((resolve) => {
    let settled = false;
    const readyTimeout = setTimeout(() => {
      console.error('[ERROR] Timed out while opening mode menu window');
      if (!menuWindow.isDestroyed()) {
        menuWindow.close();
      }
      settle(false);
    }, 3000);

    const settle = (value) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(readyTimeout);
      resolve(value);
    };

    menuWindow.once('ready-to-show', () => {
      if (!modeMenuWindow || modeMenuWindow !== menuWindow || menuWindow.isDestroyed()) {
        settle(false);
        return;
      }

      positionModeMenuWindow();
      menuWindow.show();
      menuWindow.focus();
      broadcastModeMenuState();
      settle(true);
    });

    menuWindow.once('closed', () => {
      if (modeMenuWindow === menuWindow) {
        modeMenuWindow = null;
        modeMenuAnchor = null;
      }

      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('mode-menu-closed');
      }

      settle(false);
    });

    menuWindow.loadFile('mode-menu.html').catch((error) => {
      console.error('[ERROR] Failed to load mode menu window:', error);
      if (!menuWindow.isDestroyed()) {
        menuWindow.close();
      }
      settle(false);
    });
  });
}

function scheduleCaptionSyncStart(delayMs = 250) {
  if (transcriptSource !== TRANSCRIPT_SOURCE_LIVE_CAPTIONS || !captionSync || process.platform !== 'win32') {
    return;
  }

  broadcastTranscriptSourceLifecycleState(TRANSCRIPT_SOURCE_LIVE_CAPTIONS, {
    phase: 'starting',
    active: false,
    reason: 'starting'
  });

  if (captionSyncStartTimer) {
    clearTimeout(captionSyncStartTimer);
    captionSyncStartTimer = null;
  }

  captionSyncStartTimer = setTimeout(() => {
    captionSyncStartTimer = null;
    captionSync.start()
      .then((started) => {
        if (transcriptSource !== TRANSCRIPT_SOURCE_LIVE_CAPTIONS) {
          return null;
        }

        getLiveCaptionsTranscriptSessionId();
        const captionState = captionSync.getState?.() || {};
        broadcastTranscriptSourceLifecycleState(TRANSCRIPT_SOURCE_LIVE_CAPTIONS, {
          ...captionState,
          phase: started ? (captionState.phase || 'active') : 'error',
          active: Boolean(started),
          reason: started ? 'started' : 'start-failed'
        });
        return started ? applyLiveCaptionsVisibilityPreference() : null;
      })
      .catch((error) => {
        console.error('[ERROR] Failed to start caption sync:', error);
        sendCaptionError(error, { source: TRANSCRIPT_SOURCE_LIVE_CAPTIONS });
        broadcastTranscriptSourceLifecycleState(TRANSCRIPT_SOURCE_LIVE_CAPTIONS, {
          phase: 'error',
          active: false,
          error: error?.message || String(error),
          reason: 'start-failed'
        });
      });
  }, delayMs);
}

function getDarkWebCss() {
  return `
    :root { color-scheme: dark !important; }
    body {
      background-color: #0f0f0f !important;
      color: #f4f4f4 !important;
    }
  `;
}

function applyDarkWebStylesToTab(tabId) {
  const tab = tabs.get(tabId);
  if (!tab || !tab.view || !tab.view.webContents || tab.view.webContents.isDestroyed()) {
    return;
  }

  const css = getDarkWebCss();
  const script = `
    (() => {
      const id = 'interview-buddy-dark-style';
      let style = document.getElementById(id);
      if (!style) {
        style = document.createElement('style');
        style.id = id;
        document.documentElement.appendChild(style);
      }
      style.textContent = ${JSON.stringify(css)};
      document.documentElement.style.colorScheme = 'dark';
    })();
  `;

  tab.view.webContents.executeJavaScript(script, true).catch((error) => {
    console.error('[WARNING] Failed to apply dark web styles:', error.message || error);
  });
}

function getLayoutDimensions() {
  const bounds = mainWindow.getBounds();
  const totalOffset = (BORDER_WIDTH + PADDING_WIDTH) * 2;
  const totalContentWidth = Math.max(0, bounds.width - totalOffset);
  const totalContentHeight = Math.max(0, bounds.height - totalOffset);
  const modePanelHeight = isModePanelCollapsed ? MODE_PANEL_COLLAPSED_HEIGHT : MODE_PANEL_HEIGHT;
  const browserContainerHeight = Math.max(0, totalContentHeight - APP_HEADBAR_HEIGHT - modePanelHeight);
  const contentX = BORDER_WIDTH + PADDING_WIDTH;
  const contentY = BORDER_WIDTH + PADDING_WIDTH + APP_HEADBAR_HEIGHT;

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

function getNavigationUrlFromEvent(detailsOrUrl) {
  if (typeof detailsOrUrl === 'string') {
    return detailsOrUrl;
  }

  return typeof detailsOrUrl?.url === 'string' ? detailsOrUrl.url : '';
}

function getTabStatePayload(tab) {
  return {
    id: tab.id,
    title: tab.title,
    url: tab.url,
    canGoBack: tab.canGoBack,
    canGoForward: tab.canGoForward,
    isLoading: tab.isLoading,
    loadError: tab.loadError || ''
  };
}

function sendTabState(channel, tab) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, getTabStatePayload(tab));
  }
}

function updateTabNavigationState(tabId, {
  url,
  title,
  loadError,
  isLoading
} = {}) {
  const tab = tabs.get(tabId);
  if (!tab) {
    return null;
  }

  if (typeof url === 'string' && url) {
    tab.url = url;
  }
  if (typeof title === 'string') {
    tab.title = title || 'New Tab';
  }
  if (typeof loadError === 'string') {
    tab.loadError = loadError;
  }
  if (typeof isLoading === 'boolean') {
    tab.isLoading = isLoading;
  }

  const webContents = tab.view?.webContents;
  if (webContents && !webContents.isDestroyed()) {
    tab.canGoBack = webContents.navigationHistory.canGoBack();
    tab.canGoForward = webContents.navigationHistory.canGoForward();
  }

  return tab;
}

function handleTabLoadFailure(tabId, {
  errorCode = 0,
  errorDescription = 'The page could not be loaded.',
  url = ''
} = {}) {
  const tab = updateTabNavigationState(tabId, {
    url: normalizeAllowedNavigationUrl(url) || undefined,
    isLoading: false,
    loadError: `${errorCode ? `[${errorCode}] ` : ''}${errorDescription}`
  });
  if (!tab) {
    return;
  }

  sendTabState('tab-updated', tab);
}

function navigateTabTo(tabId, url, { reason = 'navigation' } = {}) {
  const tab = tabs.get(tabId);
  const nextUrl = normalizeAllowedNavigationUrl(url);
  const webContents = tab?.view?.webContents;
  if (!tab || !nextUrl || !webContents || webContents.isDestroyed()) {
    return false;
  }

  updateTabNavigationState(tabId, {
    url: nextUrl,
    isLoading: true,
    loadError: ''
  });
  sendTabState('tab-updated', tab);

  try {
    const loadPromise = webContents.loadURL(nextUrl);
    if (loadPromise && typeof loadPromise.catch === 'function') {
      void loadPromise.catch((error) => {
        handleTabLoadFailure(tabId, {
          errorCode: error?.errno || error?.code || 0,
          errorDescription: error?.message || `Failed to ${reason}.`,
          url: nextUrl
        });
      });
    }
    return true;
  } catch (error) {
    handleTabLoadFailure(tabId, {
      errorCode: error?.errno || error?.code || 0,
      errorDescription: error?.message || `Failed to ${reason}.`,
      url: nextUrl
    });
    return false;
  }
}

function getAssistantPopupWindowOptions() {
  return {
    width: 1000,
    height: 760,
    minWidth: 400,
    minHeight: 300,
    show: true,
    autoHideMenuBar: true,
    parent: mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      preload: undefined
    }
  };
}

function isAllowedAssistantPopupUrl(url) {
  return decideAssistantNavigation({ url }) !== ASSISTANT_NAVIGATION_ACTION.DENY;
}

function setupAssistantPopupWindow(popupWindow) {
  if (!popupWindow || popupWindow.isDestroyed()) {
    return;
  }

  assistantPopupWindows.add(popupWindow);
  popupWindow.once('closed', () => {
    assistantPopupWindows.delete(popupWindow);
  });

  const popupContents = popupWindow.webContents;
  popupContents.setWindowOpenHandler((details) => {
    const action = decideAssistantNavigation({ ...details, source: 'window-open' });
    if (action !== ASSISTANT_NAVIGATION_ACTION.POPUP) {
      return { action: 'deny' };
    }

    return {
      action: 'allow',
      overrideBrowserWindowOptions: getAssistantPopupWindowOptions()
    };
  });
  popupContents.on('did-create-window', (childWindow) => {
    setupAssistantPopupWindow(childWindow);
  });

  const guardNavigation = (event, detailsOrUrl) => {
    const navigationUrl = getNavigationUrlFromEvent(detailsOrUrl);
    if (!isAllowedAssistantPopupUrl(navigationUrl)) {
      event.preventDefault();
      console.warn(`[WARNING] Blocked unsupported assistant popup navigation: ${navigationUrl || '<empty>'}`);
    }
  };
  popupContents.on('will-navigate', guardNavigation);
  popupContents.on('will-redirect', guardNavigation);
}

function configureTabWindowOpenHandler(tabId, webContents) {
  webContents.setWindowOpenHandler((details) => {
    const action = decideAssistantNavigation({ ...details, source: 'window-open' });
    if (action === ASSISTANT_NAVIGATION_ACTION.SAME_TAB) {
      navigateTabTo(tabId, details.url, { reason: 'same-tab window navigation' });
      return { action: 'deny' };
    }
    if (action !== ASSISTANT_NAVIGATION_ACTION.POPUP) {
      return { action: 'deny' };
    }

    return {
      action: 'allow',
      overrideBrowserWindowOptions: getAssistantPopupWindowOptions()
    };
  });
  webContents.on('did-create-window', (popupWindow) => {
    setupAssistantPopupWindow(popupWindow);
  });
}

function loadPendingTab(tabId) {
  const tab = tabs.get(tabId);
  if (!tab || !tab.pendingUrl || !tab.view || !tab.view.webContents || tab.view.webContents.isDestroyed()) {
    return false;
  }

  const nextUrl = normalizeAllowedNavigationUrl(tab.pendingUrl);
  tab.pendingUrl = null;
  if (!nextUrl) {
    return false;
  }

  return navigateTabTo(tabId, nextUrl, { reason: 'pending tab navigation' });
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
  const requestedUrl = normalizeAllowedNavigationUrl(url) || 'about:blank';
  const shouldDeferLoad = Boolean(options.deferLoad && requestedUrl !== 'about:blank');
  const shouldActivate = activeTabId === null || options.activate !== false;
  const tabId = tabIdCounter++;
  const layout = getLayoutDimensions();

  const tabView = createTabView(WebContentsView, {
    nodeIntegration: false,
    contextIsolation: true,
    sandbox: true,
    webSecurity: true
  });

  if (shouldActivate) {
    attachTabView(mainWindow, tabView);
    setTabViewBounds(tabView, {
      x: layout.browserViewX,
      y: layout.browserViewY,
      width: layout.browserViewWidth,
      height: layout.browserViewHeight
    });
  } else {
    setTabViewBounds(tabView, { x: 0, y: 0, width: 0, height: 0 });
  }

  const tabData = {
    id: tabId,
    view: tabView,
    url: requestedUrl,
    title: getInitialTabTitle(requestedUrl, shouldDeferLoad),
    canGoBack: false,
    canGoForward: false,
    isLoading: false,
    loadError: '',
    pendingUrl: shouldDeferLoad ? requestedUrl : null
  };

  tabs.set(tabId, tabData);

  if (shouldActivate && activeTabId !== null) {
    const prevTab = tabs.get(activeTabId);
    if (prevTab) {
      detachTabView(mainWindow, prevTab.view);
    }
  }

  if (shouldActivate) {
    activeTabId = tabId;
  }

  setupTabListeners(tabId, tabView);
  tabView.webContents.setAudioMuted(isMuted);
  if (!shouldDeferLoad) {
    navigateTabTo(tabId, requestedUrl, { reason: 'initial tab navigation' });
  }
  applyDarkWebStylesToTab(tabId);

  mainWindow.webContents.send('tab-created', {
    id: tabId,
    title: tabData.title,
    url: requestedUrl,
    active: shouldActivate
  });

  return tabId;
}

function setupTabListeners(tabId, tabView) {
  const webContents = tabView.webContents;

  configureTabWindowOpenHandler(tabId, webContents);

  webContents.on('will-navigate', (event, navigationDetails) => {
    const navigationUrl = getNavigationUrlFromEvent(navigationDetails);
    if (!isAllowedNavigationUrl(navigationUrl)) {
      event.preventDefault();
      console.warn(`[WARNING] Blocked unsupported navigation URL: ${navigationUrl || '<empty>'}`);
    }
  });

  webContents.on('did-start-loading', () => {
    const tab = updateTabNavigationState(tabId, { isLoading: true, loadError: '' });
    if (tab) {
      mainWindow.webContents.send('tab-loading', { id: tabId, loading: true });
    }
  });

  webContents.on('did-stop-loading', () => {
    const tab = updateTabNavigationState(tabId, { isLoading: false });
    if (tab) {
      mainWindow.webContents.send('tab-loading', { id: tabId, loading: false });
    }
  });

  webContents.on('did-finish-load', () => {
    const tab = updateTabNavigationState(tabId, {
      url: webContents.getURL(),
      title: webContents.getTitle(),
      isLoading: false,
      loadError: ''
    });
    if (tab) {
      applyDarkWebStylesToTab(tabId);
      sendTabState('tab-updated', tab);
    }
  });

  webContents.on('did-fail-load', (
    event,
    errorCode,
    errorDescription,
    validatedUrl,
    isMainFrame
  ) => {
    if (isMainFrame === false || errorCode === -3) {
      return;
    }

    handleTabLoadFailure(tabId, {
      errorCode,
      errorDescription,
      url: validatedUrl
    });
  });

  webContents.on('page-title-updated', (event, title) => {
    const tab = updateTabNavigationState(tabId, { title });
    if (tab) {
      mainWindow.webContents.send('tab-title-updated', { id: tabId, title: title });
    }
  });

  webContents.on('did-navigate', (event, url) => {
    const tab = updateTabNavigationState(tabId, { url, loadError: '' });
    if (tab) {
      sendTabState('tab-navigated', tab);
    }
  });

  webContents.on('did-navigate-in-page', (event, url, isMainFrame) => {
    if (isMainFrame === false) {
      return;
    }

    const tab = updateTabNavigationState(tabId, { url, loadError: '' });
    if (tab) {
      sendTabState('tab-navigated', tab);
    }
  });

  webContents.on('render-process-gone', (event, details) => {
    assistantMutationController.release(tabId);
    const reason = typeof details?.reason === 'string' && details.reason
      ? details.reason
      : 'unknown';
    handleTabLoadFailure(tabId, {
      errorDescription: `Assistant tab renderer stopped (${reason}).`,
      url: webContents.getURL()
    });
  });

  webContents.once('destroyed', () => {
    assistantMutationController.release(tabId);
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
    applyDarkWebStylesToTab(tabId);
  });
}

function switchTab(tabId) {
  if (!tabs.has(tabId) || activeTabId === tabId) return;

  const prevTab = tabs.get(activeTabId);
  if (prevTab) {
    detachTabView(mainWindow, prevTab.view);
  }

  activeTabId = tabId;
  const tab = tabs.get(tabId);
  if (tab) {
    const layout = getLayoutDimensions();

    attachTabView(mainWindow, tab.view);
    setTabViewBounds(tab.view, {
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
  }
}

function closeTab(tabId) {
  if (!tabs.has(tabId)) return;

  const tab = tabs.get(tabId);
  const wasActive = activeTabId === tabId;

  assistantMutationController.release(tabId);
  destroyTabView(mainWindow, tab.view);
  tabs.delete(tabId);

  if (wasActive) {
    if (tabs.size > 0) {
      const remainingTabs = Array.from(tabs.keys());
      const replacementTabId = remainingTabs[remainingTabs.length - 1];
      activeTabId = null;
      switchTab(replacementTabId);
    } else {
      activeTabId = null;
      createDefaultTabs();
    }
  }

  mainWindow.webContents.send('tab-closed', { id: tabId });
}

function resizeTabs() {
  if (activeTabId === null) return;

  const layout = getLayoutDimensions();
  const activeTab = tabs.get(activeTabId);
  if (activeTab) {
    setTabViewBounds(activeTab.view, {
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

  let resolvedSelection = null;
  const normalizedSelection = normalizeScreenSelectionRect(selectionRect);
  if (
    normalizedSelection
    && normalizedSelection.width >= SCREEN_SELECTION_MIN_SIZE
    && normalizedSelection.height >= SCREEN_SELECTION_MIN_SIZE
  ) {
    resolvedSelection = {
      x: state.display.bounds.x + normalizedSelection.x,
      y: state.display.bounds.y + normalizedSelection.y,
      width: normalizedSelection.width,
      height: normalizedSelection.height
    };
  }

  const resolveAfterOverlayClosed = () => state.resolve(resolvedSelection);
  if (!state.window || state.window.isDestroyed()) {
    resolveAfterOverlayClosed();
    return;
  }

  if (state.onClosed) {
    state.window.removeListener('closed', state.onClosed);
  }
  state.window.once('closed', resolveAfterOverlayClosed);
  try {
    state.window.close();
  } catch (error) {
    console.error('[WARNING] Failed to close screen selection overlay:', error);
    resolveAfterOverlayClosed();
  }
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
      ...getWindowIconOptions(),
      title: WINDOW_TITLE,
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
        nodeIntegration: false,
        contextIsolation: true,
        preload: path.join(__dirname, 'capture-overlay-preload.js'),
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
    const result = await runSelectedAreaCaptureWorkflow({
      displayId,
      getTargetDisplay: (requestedDisplayId) => screenCapture.getTargetDisplay(requestedDisplayId),
      openSelectionOverlay: (targetDisplay) => openScreenSelectionOverlay(targetDisplay),
      prepareDisplayCapture: (requestedDisplayId) => screenCapture.prepareDisplayCapture(requestedDisplayId),
      captureArea: (selectionBounds, requestedDisplayId, preparedCapture) => screenCapture.captureArea(
        selectionBounds,
        requestedDisplayId,
        preparedCapture
      )
    });
    return result.success;
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
  return normalizeTranscriptPromptText(text);
}

function normalizeTranscriptEntryForPrompt(entry, index = 0) {
  if (!entry || typeof entry.sourceText !== 'string') {
    return null;
  }

  const sourceText = normalizeTranscriptTextForPrompt(entry.sourceText);
  if (!sourceText) {
    return null;
  }

  const id = typeof entry.id === 'string' && entry.id ? entry.id : `caption-${index}`;
  const status = ['pending', 'translated', 'error', 'disabled'].includes(entry.status)
    ? entry.status
    : 'pending';

  return {
    id,
    sourceText,
    translatedText: typeof entry.translatedText === 'string' ? entry.translatedText : '',
    status,
    isFinal: Boolean(entry.isFinal),
    speakerTag: normalizeTranscriptSpeakerTag(entry.speakerTag || TRANSCRIPT_SPEAKER_TAG)
  };
}

function normalizeTranscriptEntriesForPrompt(entries) {
  if (!Array.isArray(entries)) {
    return [];
  }

  return entries
    .map((entry, index) => normalizeTranscriptEntryForPrompt(entry, index))
    .filter(Boolean);
}

function getTranscriptTextFromEntries(entries) {
  return normalizeTranscriptEntriesForPrompt(entries)
    .map((entry) => entry.sourceText)
    .join('\n')
    .trim();
}

function getSubmittedTranscriptLineSet(submittedText = lastSubmittedTranscriptText) {
  return new Set(
    normalizeTranscriptTextForPrompt(submittedText)
      .split('\n')
      .map((line) => normalizeTranscriptTextForPrompt(line))
      .filter(Boolean)
  );
}

function isTranscriptEntrySubmitted(entry, {
  submittedText = lastSubmittedTranscriptText,
  submittedEntries = lastSubmittedTranscriptEntries
} = {}) {
  const sourceText = normalizeTranscriptTextForPrompt(entry?.sourceText);
  if (!sourceText) {
    return false;
  }

  const entryId = typeof entry?.id === 'string' ? entry.id.trim() : '';
  if (entryId) {
    const matchingSubmittedEntry = normalizeTranscriptEntriesForPrompt(submittedEntries)
      .find((submittedEntry) => submittedEntry.id === entryId);
    const submittedSourceText = normalizeTranscriptTextForPrompt(matchingSubmittedEntry?.sourceText);

    if (submittedSourceText) {
      return submittedSourceText === sourceText || submittedSourceText.endsWith(sourceText);
    }
  }

  return getSubmittedTranscriptLineSet(submittedText).has(sourceText);
}

function annotateTranscriptEntriesForRenderer(entries = latestTranscriptEntries) {
  return normalizeTranscriptEntriesForPrompt(entries)
    .map((entry) => ({
      ...entry,
      isSubmitted: isTranscriptEntrySubmitted(entry)
    }));
}

function formatTranscriptSaveDate(date = new Date()) {
  const candidateDate = date instanceof Date ? date : new Date(date);
  const safeDate = Number.isNaN(candidateDate.getTime()) ? new Date() : candidateDate;
  const year = String(safeDate.getFullYear());
  const month = String(safeDate.getMonth() + 1).padStart(2, '0');
  const day = String(safeDate.getDate()).padStart(2, '0');

  return `${year}-${month}-${day}`;
}

function getTranscriptSaveDefaultFilename(date = new Date()) {
  return `${TRANSCRIPT_SAVE_DEFAULT_BASENAME}-${formatTranscriptSaveDate(date)}.txt`;
}

function getSavedTranscriptText() {
  const normalizedTranscriptEntries = normalizeTranscriptEntriesForPrompt(latestTranscriptEntries);
  if (normalizedTranscriptEntries.length > 0) {
    return normalizedTranscriptEntries
      .map((entry, index) => formatTranscriptEntryPromptLine(entry, {
        includeSpeaker: shouldIncludeTranscriptSpeaker(entry, index, normalizedTranscriptEntries[index - 1])
      }))
      .join('\n')
      .trim();
  }

  return normalizeTranscriptTextForPrompt(latestTranscriptText);
}

async function saveTranscriptToFile() {
  const transcriptFileText = getSavedTranscriptText();
  if (!transcriptFileText) {
    return {
      success: false,
      canceled: false,
      reason: 'empty'
    };
  }

  const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
    title: 'Save transcript',
    defaultPath: path.join(
      app.getPath('documents'),
      getTranscriptSaveDefaultFilename()
    ),
    filters: [
      { name: 'Text files', extensions: ['txt'] },
      { name: 'All files', extensions: ['*'] }
    ]
  });

  if (canceled || !filePath) {
    return {
      success: false,
      canceled: true
    };
  }

  await fs.promises.writeFile(filePath, transcriptFileText, 'utf8');
  return {
    success: true,
    canceled: false,
    filePath
  };
}

function markTranscriptSubmitted(
  transcriptText = latestTranscriptText,
  transcriptEntries = latestTranscriptEntries
) {
  lastSubmittedTranscriptText = normalizeTranscriptTextForPrompt(transcriptText);
  lastSubmittedTranscriptEntries = normalizeTranscriptEntriesForPrompt(transcriptEntries);
  refreshTranscriptSubmittedState();
}

function markTranscriptCopiedToClipboard(
  transcriptText = latestTranscriptText,
  transcriptEntries = latestTranscriptEntries
) {
  lastClipboardTranscriptText = normalizeTranscriptTextForPrompt(transcriptText);
  lastClipboardTranscriptEntries = normalizeTranscriptEntriesForPrompt(transcriptEntries);
}

function resetSubmittedTranscriptCursor() {
  lastSubmittedTranscriptText = '';
  lastSubmittedTranscriptEntries = [];
}

function resetClipboardTranscriptCursor() {
  lastClipboardTranscriptText = '';
  lastClipboardTranscriptEntries = [];
}

function resetTranscriptCursors() {
  resetSubmittedTranscriptCursor();
  resetClipboardTranscriptCursor();
}

function getTranscriptPromptText(
  transcriptText = latestTranscriptText,
  transcriptEntries = latestTranscriptEntries
) {
  return buildTranscriptPromptText({
    transcriptText,
    transcriptEntries,
    promptText: String(getSelectedPromptMode()?.suffix || '').trim()
  });
}

function sendCaptionUpdate(payload = translationManager.getPayload()) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('caption-update', {
      ...payload,
      entries: annotateTranscriptEntriesForRenderer(payload?.entries)
    });
  }
}

function refreshTranscriptSubmittedState() {
  sendCaptionUpdate({
    fullText: latestTranscriptText,
    entries: latestTranscriptEntries
  });
}

function getLiveCaptionsTranscriptSessionId() {
  const sessionId = captionSync?.getSessionId?.();
  if (typeof sessionId === 'string' && sessionId.trim()) {
    liveCaptionsSessionId = sessionId.trim();
  }

  return liveCaptionsSessionId;
}

function rotateLiveCaptionsTranscriptSession(options = {}) {
  const sessionId = captionSync?.beginNewSession?.(options);
  if (typeof sessionId === 'string' && sessionId.trim()) {
    liveCaptionsSessionId = sessionId.trim();
  } else {
    liveCaptionsSessionId = randomUUID();
  }

  return liveCaptionsSessionId;
}

function getDeepgramTranscriptSessionId() {
  const sessionId = deepgramTranscriptionService?.sessionId;
  if (typeof sessionId === 'string' && sessionId.trim()) {
    deepgramTranscriptSessionId = sessionId.trim();
  }

  return deepgramTranscriptSessionId;
}

function getDeepgramRetryAttempt() {
  const retryAttempt = deepgramTranscriptionService?.getRetryAttempt?.();
  return Number.isSafeInteger(retryAttempt) ? Math.max(0, retryAttempt) : 0;
}

function getTranscriptSourceLifecycleSnapshot(source = transcriptSource, lifecycleState = {}) {
  const isDeepgram = source === TRANSCRIPT_SOURCE_DEEPGRAM;
  const fallbackSessionId = isDeepgram
    ? getDeepgramTranscriptSessionId()
    : getLiveCaptionsTranscriptSessionId();
  const sourceState = isDeepgram
    ? lifecycleState
    : {
        ...captionSync?.getState?.(),
        ...lifecycleState
      };

  return normalizeTranscriptSourceLifecycle({
    ...sourceState,
    source,
    sessionId: sourceState.sessionId || fallbackSessionId,
    retryAttempt: sourceState.retryAttempt ?? (isDeepgram ? getDeepgramRetryAttempt() : 0)
  }, {
    source,
    sessionId: fallbackSessionId
  });
}

function broadcastTranscriptSourceLifecycleState(source = transcriptSource, lifecycleState = {}) {
  const snapshot = getTranscriptSourceLifecycleSnapshot(source, lifecycleState);
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('transcript-source-state', snapshot);
  }
  return snapshot;
}

function sendCaptionError(error, options = {}) {
  const normalizedError = normalizeTranscriptError(error, {
    source: options.source || transcriptSource,
    code: options.code || error?.code || 'TRANSCRIPT_ERROR',
    recoverable: typeof options.recoverable === 'boolean'
      ? options.recoverable
      : (typeof error?.recoverable === 'boolean' ? error.recoverable : true)
  });

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('caption-error', normalizedError);
  }

  return normalizedError;
}

function applyTranscriptPayload(payload = translationManager.getPayload()) {
  latestTranscriptEntries = normalizeTranscriptEntriesForPrompt(payload?.entries);
  latestTranscriptText = typeof payload?.fullText === 'string'
    ? normalizeTranscriptTextForPrompt(payload.fullText)
    : getTranscriptTextFromEntries(latestTranscriptEntries);

  sendCaptionUpdate({
    ...payload,
    fullText: latestTranscriptText,
    entries: latestTranscriptEntries
  });
}

function resetTranscriptStateForSource(sourcePayload = '') {
  latestTranscriptText = '';
  latestTranscriptEntries = [];
  resetTranscriptCursors();
  applyTranscriptPayload(translationManager.reset(sourcePayload));
}

function setDeepgramTranscriptionState(isActive) {
  deepgramTranscriptionActive = Boolean(isActive);
}

function getDeepgramCaptureStateSnapshot(reason = '') {
  const lifecycleState = deepgramLifecycleCoordinator?.getState?.() || {
    active: deepgramTranscriptionActive,
    phase: deepgramTranscriptionActive ? 'active' : 'inactive',
    reason: '',
    error: ''
  };
  return {
    ...getDeepgramUsageSnapshot(),
    ...lifecycleState,
    sessionId: getDeepgramTranscriptSessionId(),
    retryAttempt: getDeepgramRetryAttempt(),
    reason: typeof reason === 'string' && reason ? reason : lifecycleState.reason
  };
}

function broadcastDeepgramCaptureState(isActive, reason = '', lifecycleState = {}) {
  setDeepgramTranscriptionState(isActive);
  const snapshot = {
    ...getDeepgramCaptureStateSnapshot(reason),
    ...lifecycleState,
    active: Boolean(isActive),
    reason: typeof reason === 'string' && reason
      ? reason
      : (typeof lifecycleState.reason === 'string' ? lifecycleState.reason : '')
  };

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('deepgram-capture-state', snapshot);
  }

  broadcastTranscriptSourceLifecycleState(TRANSCRIPT_SOURCE_DEEPGRAM, snapshot);

  return snapshot;
}

function requestDeepgramRendererCommand(action, { operationId } = {}) {
  if (!deepgramRendererCommandBroker) {
    deepgramRendererCommandBroker = new DeepgramRendererCommandBroker({
      sendCommand: (command) => {
        if (!mainWindow || mainWindow.isDestroyed()) {
          return false;
        }
        mainWindow.webContents.send('deepgram-capture-command', command);
        return true;
      }
    });
  }
  return deepgramRendererCommandBroker.request(action, { operationId });
}

function acknowledgeDeepgramRendererCommand(payload = {}) {
  return deepgramRendererCommandBroker?.acknowledge(payload) || false;
}

function normalizeDeepgramAudioChunk(chunk) {
  if (Buffer.isBuffer(chunk)) {
    return chunk;
  }

  if (chunk instanceof ArrayBuffer) {
    return Buffer.from(chunk);
  }

  if (ArrayBuffer.isView(chunk)) {
    return Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength);
  }

  if (Array.isArray(chunk)) {
    return Buffer.from(chunk);
  }

  return Buffer.alloc(0);
}

function handleDeepgramCaptionUpdate(payload) {
  if (transcriptSource !== TRANSCRIPT_SOURCE_DEEPGRAM) {
    return;
  }

  const incomingEntries = normalizeTranscriptEntriesForPrompt(payload?.entries);
  applyTranscriptPayload(translationManager.updateEntries(incomingEntries));
}

function getDeepgramTranscriptionService() {
  if (deepgramTranscriptionService) {
    return deepgramTranscriptionService;
  }

  deepgramTranscriptionService = new DeepgramTranscriptionService();
  deepgramTranscriptSessionId = getDeepgramTranscriptSessionId();
  deepgramTranscriptionService.on('captionUpdate', handleDeepgramCaptionUpdate);
  deepgramTranscriptionService.on('error', (error) => {
    console.error('[ERROR] Deepgram transcription error:', error);
    if (transcriptSource === TRANSCRIPT_SOURCE_DEEPGRAM) {
      sendCaptionError({
        ...error,
        source: TRANSCRIPT_SOURCE_DEEPGRAM,
        message: `Deepgram transcription error: ${error?.message || String(error)}`
      });
    }
  });
  deepgramTranscriptionService.on('fatalError', (error, { revision } = {}) => {
    if (
      revision !== undefined
      && deepgramLifecycleCoordinator
      && deepgramLifecycleCoordinator.getState().revision !== revision
    ) {
      void deepgramLifecycleCoordinator.failClosed(error, { revision });
      return;
    }
    console.error('[ERROR] Deepgram capture failed closed:', error);
    if (transcriptSource === TRANSCRIPT_SOURCE_DEEPGRAM) {
      sendCaptionError({
        ...error,
        source: TRANSCRIPT_SOURCE_DEEPGRAM,
        message: `Deepgram transcription stopped: ${error?.message || String(error)}`
      });
    }
    if (deepgramLifecycleCoordinator) {
      void deepgramLifecycleCoordinator.failClosed(error, { revision });
    } else {
      broadcastDeepgramCaptureState(false, 'backend-failed', {
        phase: 'inactive',
        error: error?.message || String(error)
      });
    }
  });

  return deepgramTranscriptionService;
}

function getDeepgramLifecycleCoordinator() {
  if (deepgramLifecycleCoordinator) {
    return deepgramLifecycleCoordinator;
  }

  deepgramLifecycleCoordinator = new DeepgramLifecycleCoordinator({
    service: getDeepgramTranscriptionService(),
    requestRendererStart: (context) => requestDeepgramRendererCommand('start', context),
    requestRendererStop: (context) => requestDeepgramRendererCommand('stop', context),
    onState: (state) => {
      broadcastDeepgramCaptureState(state.active, state.reason, state);
    }
  });
  return deepgramLifecycleCoordinator;
}

function stopLiveCaptionTranscriptSource() {
  if (captionSyncStartTimer) {
    clearTimeout(captionSyncStartTimer);
    captionSyncStartTimer = null;
  }

  if (captionSync && typeof captionSync.stop === 'function') {
    broadcastTranscriptSourceLifecycleState(TRANSCRIPT_SOURCE_LIVE_CAPTIONS, {
      phase: 'stopping',
      active: false,
      reason: 'stopping'
    });
    try {
      Promise.resolve(captionSync.stop())
        .then(() => {
          broadcastTranscriptSourceLifecycleState(TRANSCRIPT_SOURCE_LIVE_CAPTIONS, {
            phase: 'inactive',
            active: false,
            reason: 'stopped'
          });
        })
        .catch((error) => {
          sendCaptionError(error, { source: TRANSCRIPT_SOURCE_LIVE_CAPTIONS });
          broadcastTranscriptSourceLifecycleState(TRANSCRIPT_SOURCE_LIVE_CAPTIONS, {
            phase: 'error',
            active: false,
            error: error?.message || String(error),
            reason: 'stop-failed'
          });
        });
    } catch (error) {
      console.error('[WARNING] Failed to stop caption sync:', error);
      sendCaptionError(error, { source: TRANSCRIPT_SOURCE_LIVE_CAPTIONS });
    }
  }
}

async function stopDeepgramTranscriptSource(reason = 'stopped') {
  if (!deepgramLifecycleCoordinator && !deepgramTranscriptionService) {
    return broadcastDeepgramCaptureState(false, reason, { phase: 'inactive' });
  }

  return await getDeepgramLifecycleCoordinator().stop({ reason });
}

async function startDeepgramTranscriptSource() {
  if (transcriptSource !== TRANSCRIPT_SOURCE_DEEPGRAM) {
    return broadcastDeepgramCaptureState(false, 'wrong-source');
  }

  const connectionApiKey = getDeepgramConnectionApiKey();
  if (!connectionApiKey) {
    return broadcastDeepgramCaptureState(false, 'missing-api-key');
  }

  if (deepgramLifecycleCoordinator?.getState?.().active || deepgramTranscriptionActive) {
    return getDeepgramCaptureStateSnapshot('already-started');
  }

  try {
    const snapshot = await getDeepgramLifecycleCoordinator().start({ apiKey: connectionApiKey });
    void refreshDeepgramAccountUsage().then(() => {
      broadcastDeepgramCaptureState(deepgramTranscriptionActive, 'usage-updated');
    });
    return snapshot;
  } catch (error) {
    console.error('[ERROR] Failed to start Deepgram transcription:', error);
    sendCaptionError({
      ...error,
      source: TRANSCRIPT_SOURCE_DEEPGRAM,
      message: `Deepgram transcription failed to start: ${error?.message || String(error)}`
    });
    return broadcastDeepgramCaptureState(false, 'start-failed');
  }
}

function startActiveTranscriptSource() {
  if (transcriptSource === TRANSCRIPT_SOURCE_DEEPGRAM) {
    stopLiveCaptionTranscriptSource();
    broadcastDeepgramCaptureState(deepgramTranscriptionActive, deepgramTranscriptionActive ? 'running' : 'ready');
    return;
  }

  void stopDeepgramTranscriptSource('source-switched');
  scheduleCaptionSyncStart();
}

async function applyTranscriptSourceChange(nextSource, { resetTranscript = true } = {}) {
  const normalizedSource = normalizeTranscriptSource(nextSource);

  if (transcriptSource === normalizedSource) {
    if (normalizedSource === TRANSCRIPT_SOURCE_LIVE_CAPTIONS) {
      scheduleCaptionSyncStart();
    } else {
      broadcastDeepgramCaptureState(deepgramTranscriptionActive, deepgramTranscriptionActive ? 'running' : 'ready');
    }
    return getAppPreferenceStateSnapshot();
  }

  if (transcriptSource === TRANSCRIPT_SOURCE_DEEPGRAM) {
    await stopDeepgramTranscriptSource('source-switched');
  } else {
    rotateLiveCaptionsTranscriptSession({ requireFreshBoundary: true });
    stopLiveCaptionTranscriptSource();
  }

  if (
    resetTranscript
    && (
      transcriptSource === TRANSCRIPT_SOURCE_DEEPGRAM
      || normalizedSource === TRANSCRIPT_SOURCE_DEEPGRAM
    )
  ) {
    await getDeepgramLifecycleCoordinator().clear();
  }

  transcriptSource = normalizedSource;

  if (transcriptSource === TRANSCRIPT_SOURCE_LIVE_CAPTIONS) {
    rotateLiveCaptionsTranscriptSession({ requireFreshBoundary: true });
    broadcastTranscriptSourceLifecycleState(TRANSCRIPT_SOURCE_LIVE_CAPTIONS, {
      phase: 'inactive',
      active: false,
      reason: 'source-switched'
    });
  }

  if (resetTranscript) {
    resetTranscriptStateForSource();
  }

  startActiveTranscriptSource();
  scheduleAppPreferencesPersist();
  broadcastAppPreferences();
  return getAppPreferenceStateSnapshot();
}

function setTranscriptSourcePreference(source) {
  return applyTranscriptSourceChange(source);
}

async function setDeepgramApiKeyPreference(apiKey) {
  setDeepgramApiKeyInMemory(apiKey);
  deepgramUsageLastFetchedAtMs = 0;
  deepgramUsageRefreshApiKey = '';
  deepgramAccountUsageSnapshot = {
    status: deepgramApiKey ? 'idle' : 'missing-api-key',
    remainingText: deepgramApiKey ? 'Remaining unavailable' : 'Add API key'
  };

  if (transcriptSource === TRANSCRIPT_SOURCE_DEEPGRAM && deepgramApiKey) {
    await getDeepgramLifecycleCoordinator().setApiKey({ apiKey: deepgramApiKey });
    void refreshDeepgramAccountUsage().then(() => {
      broadcastDeepgramCaptureState(deepgramTranscriptionActive, 'usage-updated');
    });
  }

  scheduleAppPreferencesPersist();
  broadcastAppPreferences();
  return getAppPreferenceStateSnapshot();
}

async function clearDeepgramApiKeyPreference() {
  clearDeepgramApiKeyInMemory();
  if (transcriptSource === TRANSCRIPT_SOURCE_DEEPGRAM) {
    await applyTranscriptSourceChange(TRANSCRIPT_SOURCE_LIVE_CAPTIONS);
  } else {
    await stopDeepgramTranscriptSource('api-key-cleared');
    scheduleAppPreferencesPersist();
    broadcastAppPreferences();
  }

  return getAppPreferenceStateSnapshot();
}

function isSupportedAssistantUrl(url) {
  return isSupportedAssistantTargetUrl(url);
}

function ensureSupportedAssistantTab(webContents, actionName) {
  const currentUrl = webContents.getURL();
  if (isSupportedAssistantUrl(currentUrl)) {
    return true;
  }

  console.error(`[ERROR] ${actionName} requires the active tab to be ChatGPT, DeepSeek, or Claude. Current URL: ${currentUrl || 'about:blank'}`);
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
        const composerSelectors = ${ASSISTANT_COMPOSER_SELECTORS_SCRIPT};
        ${COMPOSER_HELPERS_SCRIPT}

        const element = findComposer();
        if (!element) {
          return false;
        }

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
        const composerSelectors = ${ASSISTANT_COMPOSER_SELECTORS_SCRIPT};
        ${COMPOSER_HELPERS_SCRIPT}

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

        const composer = findComposer();
        if (composer) {
          return readComposerText(composer);
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
        const composerSelectors = ${ASSISTANT_COMPOSER_SELECTORS_SCRIPT};
        ${COMPOSER_HELPERS_SCRIPT}

        const element = findComposer();
        if (!element) {
          return false;
        }

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

        return false;
      })();
    `, true);
  } catch (error) {
    console.error('[ERROR] Failed to paste text into assistant composer:', error);
    return false;
  }
}

async function getTemporaryUploadFilePath(extension = '.png') {
  const uploadDir = getTemporaryUploadDir();
  await fs.promises.mkdir(uploadDir, { recursive: true });
  return path.join(
    uploadDir,
    `capture-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${extension}`
  );
}

function scheduleTemporaryFileCleanup(filePath, delayMs = 120000) {
  if (!filePath) {
    return;
  }

  const cleanupTimer = setTimeout(() => {
    temporaryUploadCleanupTimers.delete(cleanupTimer);
    fs.unlink(filePath, () => {});
  }, delayMs);
  temporaryUploadCleanupTimers.add(cleanupTimer);
}

function clearTemporaryUploadCleanupTimers() {
  for (const cleanupTimer of temporaryUploadCleanupTimers) {
    clearTimeout(cleanupTimer);
  }

  temporaryUploadCleanupTimers.clear();
}

async function dispatchMouseClickWithoutWindowFocus(webContents, clickTarget) {
  const x = Math.round(Number(clickTarget?.x));
  const y = Math.round(Number(clickTarget?.y));

  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return false;
  }

  const debuggerSession = webContents?.debugger;
  if (!debuggerSession) {
    return false;
  }

  let attachedHere = false;

  try {
    if (!debuggerSession.isAttached()) {
      debuggerSession.attach('1.3');
      attachedHere = true;
    }

    await debuggerSession.sendCommand('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x,
      y
    });
    await debuggerSession.sendCommand('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x,
      y,
      button: 'left',
      clickCount: 1
    });
    await sleep(20);
    await debuggerSession.sendCommand('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x,
      y,
      button: 'left',
      clickCount: 1
    });

    return true;
  } catch (error) {
    console.error('[ERROR] Failed to dispatch assistant mouse click without focusing the app:', error);
    return false;
  } finally {
    if (attachedHere && debuggerSession.isAttached()) {
      try {
        debuggerSession.detach();
      } catch (error) {
        // Ignore detach failures.
      }
    }
  }
}

async function focusAssistantComposerForUpload(webContents) {
  try {
    const clickTarget = await webContents.executeJavaScript(`
      (() => {
        const composerSelectors = ${ASSISTANT_COMPOSER_SELECTORS_SCRIPT};
        ${COMPOSER_HELPERS_SCRIPT}

        function getComposerClickPoint(composer) {
          if (!isUsableComposer(composer)) {
            return null;
          }

          composer.scrollIntoView({ block: 'nearest', inline: 'nearest' });

          const rect = composer.getBoundingClientRect();
          const x = Math.min(Math.max(rect.left + Math.min(rect.width / 2, 24), 0), window.innerWidth - 1);
          const y = Math.min(Math.max(rect.top + rect.height / 2, 0), window.innerHeight - 1);

          if (!Number.isFinite(x) || !Number.isFinite(y)) {
            return null;
          }

          return { x, y };
        }

        return getComposerClickPoint(findComposer());
      })();
    `, true);

    const clicked = await dispatchMouseClickWithoutWindowFocus(webContents, clickTarget);
    if (!clicked) {
      return false;
    }

    await sleep(100);
    return true;
  } catch (error) {
    console.error('[ERROR] Failed to focus assistant composer before image upload:', error);
    return false;
  }
}

async function markImageUploadInput(webContents, markerId) {
  try {
    return await webContents.executeJavaScript(`
      (async () => {
        const markerId = ${JSON.stringify(markerId)};
        const composerSelectors = ${ASSISTANT_COMPOSER_SELECTORS_SCRIPT};
        const fileInputSelectors = ${ASSISTANT_FILE_INPUT_SELECTORS_SCRIPT};
        const revealButtonSelectors = ${ASSISTANT_REVEAL_UPLOAD_BUTTON_SELECTORS_SCRIPT};

        const sleep = (delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs));
        ${COMPOSER_HELPERS_SCRIPT}

        function getSearchScopes(composer) {
          const scopes = [
            composer,
            composer?.closest('form'),
            composer?.closest('[data-testid="chat-input"]'),
            composer?.parentElement,
            composer?.closest('[data-testid], section, main, div'),
            document,
            document.body
          ].filter(Boolean);

          const uniqueScopes = [];
          const seenScopes = new Set();
          for (const scope of scopes) {
            if (seenScopes.has(scope)) continue;
            seenScopes.add(scope);
            uniqueScopes.push(scope);
          }

          return uniqueScopes;
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
        const composerSelectors = ${ASSISTANT_COMPOSER_SELECTORS_SCRIPT};
        ${COMPOSER_HELPERS_SCRIPT}
        ${COMPOSER_SCOPE_HELPERS_SCRIPT}

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

        const composer = findComposer();
        if (!composer) {
          return null;
        }

        const uniqueScopes = [];
        const seenScopes = new Set();
        for (const scope of getComposerScopes(composer)) {
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

async function waitForAssistantImageAttachment(webContents, previousState, markerId = '', attempts = 20, delayMs = 150) {
  return waitForAssistantImageAttachmentEvidence({
    previousState,
    getCurrentState: () => getAssistantImageAttachmentState(webContents, markerId),
    sleep,
    attempts,
    delayMs
  });
}

async function pasteImageIntoComposer(webContents, image) {
  const uploadMarkerId = `upload-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const imagePng = image.toPNG();
  const temporaryUploadPath = await getTemporaryUploadFilePath('.png');
  const previousAttachmentState = await getAssistantImageAttachmentState(webContents, uploadMarkerId);

  try {
    await fs.promises.writeFile(temporaryUploadPath, imagePng);
    scheduleTemporaryFileCleanup(temporaryUploadPath);

    const composerFocused = await focusAssistantComposerForUpload(webContents);
    if (!composerFocused) {
      return false;
    }

    const markedInput = await markImageUploadInput(webContents, uploadMarkerId);
    if (markedInput) {
      const uploaded = await setMarkedUploadInputFiles(webContents, uploadMarkerId, [temporaryUploadPath]);
      if (uploaded) {
        await dispatchMarkedUploadInputEvents(webContents, uploadMarkerId, true);
        const attachmentObserved = await waitForAssistantImageAttachment(
          webContents,
          previousAttachmentState,
          uploadMarkerId,
          4,
          100
        );
        await clearMarkedUploadInput(webContents, uploadMarkerId);
        return attachmentObserved;
      } else {
        await clearMarkedUploadInput(webContents, uploadMarkerId);
      }
    }

    const imageBase64 = imagePng.toString('base64');
    const syntheticHandled = await webContents.executeJavaScript(`
      (() => {
        const imageBase64 = ${JSON.stringify(imageBase64)};
        const composerSelectors = ${ASSISTANT_COMPOSER_SELECTORS_SCRIPT};
        ${COMPOSER_HELPERS_SCRIPT}
        ${COMPOSER_SCOPE_HELPERS_SCRIPT}

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

        function getComposerTargets(composer) {
          const targets = [];
          const seen = new Set();

          for (const target of getComposerScopes(composer)) {
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

        const composer = findComposer();
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

    return await waitForAssistantImageAttachment(webContents, previousAttachmentState, '', 4, 100);
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

async function submitComposerViaForm(webContents) {
  try {
    return await webContents.executeJavaScript(`
      (() => {
        const composerSelectors = ${ASSISTANT_COMPOSER_SELECTORS_SCRIPT};
        const buttonSelectors = ${ASSISTANT_SEND_BUTTON_SELECTORS_SCRIPT};
        ${COMPOSER_HELPERS_SCRIPT}
        ${SEND_BUTTON_HELPERS_SCRIPT}

        function getComposerForm(composer, button) {
          const composerForm = composer?.closest?.('form') || null;
          const buttonForm = button?.form || button?.closest?.('form') || null;

          if (composerForm) {
            return composerForm;
          }

          if (buttonForm && (!composer || buttonForm.contains(composer))) {
            return buttonForm;
          }

          return null;
        }

        function createSubmitEvent(button, form) {
          const submitter = button && button.form === form ? button : null;

          if (typeof SubmitEvent === 'function') {
            return new SubmitEvent('submit', {
              bubbles: true,
              cancelable: true,
              submitter
            });
          }

          return new Event('submit', {
            bubbles: true,
            cancelable: true
          });
        }

        const composer = findComposer();
        if (!composer) {
          return false;
        }

        const button = findSendButton(composer);
        const form = getComposerForm(composer, button);
        if (!form) {
          return false;
        }

        if (typeof form.requestSubmit === 'function') {
          try {
            if (button && button.form === form) {
              form.requestSubmit(button);
            } else {
              form.requestSubmit();
            }
            return true;
          } catch (error) {
            // Fall through to a submit event for custom composer forms.
          }
        }

        form.dispatchEvent(createSubmitEvent(button, form));
        return true;
      })();
    `, true);
  } catch (error) {
    console.error('[ERROR] Failed to submit assistant composer form:', error);
    return false;
  }
}

async function clickComposerSendButton(webContents) {
  try {
    const clickTarget = await webContents.executeJavaScript(`
      (() => {
        const composerSelectors = ${ASSISTANT_COMPOSER_SELECTORS_SCRIPT};
        const buttonSelectors = ${ASSISTANT_SEND_BUTTON_SELECTORS_SCRIPT};
        ${COMPOSER_HELPERS_SCRIPT}
        ${SEND_BUTTON_HELPERS_SCRIPT}

        function getButtonClickPoint(button) {
          if (!isButtonReady(button)) {
            return null;
          }

          button.scrollIntoView({ block: 'nearest', inline: 'nearest' });

          const rect = button.getBoundingClientRect();
          const x = Math.min(Math.max(rect.left + rect.width / 2, 0), window.innerWidth - 1);
          const y = Math.min(Math.max(rect.top + rect.height / 2, 0), window.innerHeight - 1);

          if (!Number.isFinite(x) || !Number.isFinite(y)) {
            return null;
          }

          return { x, y };
        }

        const composer = findComposer();
        const button = findSendButton(composer);
        return getButtonClickPoint(button);
      })();
    `, true);

    return await dispatchMouseClickWithoutWindowFocus(webContents, clickTarget);
  } catch (error) {
    console.error('[ERROR] Failed to click assistant send button:', error);
    return false;
  }
}

async function waitForSendButtonReady(webContents, attempts = 12, delayMs = 100) {
  try {
    const checkScript = `
      (() => {
        const composerSelectors = ${ASSISTANT_COMPOSER_SELECTORS_SCRIPT};
        const buttonSelectors = ${ASSISTANT_SEND_BUTTON_SELECTORS_SCRIPT};
        ${COMPOSER_HELPERS_SCRIPT}
        ${SEND_BUTTON_HELPERS_SCRIPT}

        const composer = findComposer();
        if (!composer) {
          return false;
        }

        return Boolean(findSendButton(composer));
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
        const composerSelectors = ${ASSISTANT_COMPOSER_SELECTORS_SCRIPT};
        const buttonSelectors = ${ASSISTANT_SEND_BUTTON_SELECTORS_SCRIPT};
        ${COMPOSER_HELPERS_SCRIPT}
        ${SEND_BUTTON_HELPERS_SCRIPT}

        function dispatchPointerEvent(target, type, eventInit) {
          if (typeof PointerEvent !== 'function') {
            return;
          }

          target.dispatchEvent(new PointerEvent(type, eventInit));
        }

        function clickReadySendButton(button) {
          if (!isButtonReady(button)) {
            return false;
          }

          button.scrollIntoView({ block: 'nearest', inline: 'nearest' });

          const downEventInit = {
            bubbles: true,
            cancelable: true,
            composed: true,
            button: 0,
            buttons: 1,
            view: window
          };
          const upEventInit = {
            bubbles: true,
            cancelable: true,
            composed: true,
            button: 0,
            buttons: 0,
            view: window
          };

          dispatchPointerEvent(button, 'pointerdown', downEventInit);
          button.dispatchEvent(new MouseEvent('mousedown', downEventInit));
          dispatchPointerEvent(button, 'pointerup', upEventInit);
          button.dispatchEvent(new MouseEvent('mouseup', upEventInit));
          button.click();
          return true;
        }

        const element = findComposer();
        if (!element) {
          return false;
        }

        const button = findSendButton(element);
        if (clickReadySendButton(button)) {
          return true;
        }

        const form = element.closest('form');
        if (form) {
          if (typeof form.requestSubmit === 'function') {
            try {
              form.requestSubmit(button || undefined);
              return true;
            } catch (error) {
              // Fall through to submit event and keyboard dispatch.
            }
          }

          form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
          return true;
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
      })();
    `, true);
  } catch (error) {
    console.error('[ERROR] Failed to submit assistant composer via DOM events:', error);
    return false;
  }
}

function createAssistantSubmissionStrategy(
  webContents,
  expectedText,
  dispatch,
  attempts,
  delayMs
) {
  return async () => {
    const dispatched = await dispatch(webContents);
    if (!dispatched) {
      return ASSISTANT_SUBMISSION_OUTCOME.NOT_DISPATCHED;
    }

    const confirmed = await waitForComposerTextChange(webContents, expectedText, attempts, delayMs);
    return confirmed
      ? ASSISTANT_SUBMISSION_OUTCOME.CONFIRMED_SENT
      : ASSISTANT_SUBMISSION_OUTCOME.UNKNOWN_AFTER_DISPATCH;
  };
}

async function submitCurrentComposer(webContents, expectedText) {
  await waitForSendButtonReady(webContents, 12, 100);

  const targetKind = getAssistantTargetKind(webContents.getURL());

  if (targetKind === 'chatgpt') {
    return runAssistantSubmissionStrategies([
      createAssistantSubmissionStrategy(
        webContents,
        expectedText,
        submitComposerViaForm,
        8,
        100
      ),
      createAssistantSubmissionStrategy(
        webContents,
        expectedText,
        clickComposerSendButton,
        12,
        100
      ),
      createAssistantSubmissionStrategy(
        webContents,
        expectedText,
        submitComposerViaDom,
        30,
        200
      )
    ]);
  }

  if (targetKind !== 'chatgpt') {
    return runAssistantSubmissionStrategies([
      createAssistantSubmissionStrategy(
        webContents,
        expectedText,
        clickComposerSendButton,
        12,
        100
      ),
      createAssistantSubmissionStrategy(
        webContents,
        expectedText,
        submitComposerViaForm,
        4,
        100
      ),
      createAssistantSubmissionStrategy(
        webContents,
        expectedText,
        submitComposerViaDom,
        30,
        200
      )
    ]);
  }

  return ASSISTANT_SUBMISSION_OUTCOME.NOT_DISPATCHED;
}

async function submitTranscriptToAssistant() {
  const tabId = activeTabId;
  const webContents = getActiveTabWebContents();
  if (tabId === null || !webContents) {
    return;
  }

  if (!ensureSupportedAssistantTab(webContents, 'Ctrl+Enter')) {
    return;
  }

  const mutationResult = await assistantMutationController.run(tabId, async () => {
    const transcriptSnapshot = normalizeTranscriptTextForPrompt(latestTranscriptText);
    const transcriptEntriesSnapshot = normalizeTranscriptEntriesForPrompt(latestTranscriptEntries);
    const cursorResult = resolvePendingTranscriptCursor({
      transcriptText: transcriptSnapshot,
      transcriptEntries: transcriptEntriesSnapshot,
      cursorText: lastSubmittedTranscriptText,
      cursorEntries: lastSubmittedTranscriptEntries,
      allowDisjointCurrentTranscript: transcriptSource === TRANSCRIPT_SOURCE_LIVE_CAPTIONS
    });

    if (cursorResult.status === 'mismatch') {
      sendCaptionError(TRANSCRIPT_CURSOR_MISMATCH_ERROR);
      return ASSISTANT_SUBMISSION_OUTCOME.NOT_DISPATCHED;
    }

    const composerText = getTranscriptPromptText(
      cursorResult.pendingText,
      cursorResult.pendingEntries
    );
    if (!composerText.trim()) {
      console.error('[ERROR] No new transcript or prompt text is available for Ctrl+Enter');
      return ASSISTANT_SUBMISSION_OUTCOME.NOT_DISPATCHED;
    }

    const focusState = await capturePageFocusState(webContents);

    try {
      const cleared = await clearCurrentComposer(webContents);
      if (!cleared || !(await waitForComposerEmpty(webContents))) {
        console.error('[ERROR] Ctrl+Enter could not clear the current assistant composer without focusing it');
        return ASSISTANT_SUBMISSION_OUTCOME.NOT_DISPATCHED;
      }

      const pastedText = await pasteTextIntoComposer(webContents, composerText);
      if (!pastedText) {
        console.error('[ERROR] Transcript prompt could not be injected into the current assistant composer');
        return ASSISTANT_SUBMISSION_OUTCOME.NOT_DISPATCHED;
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
        return ASSISTANT_SUBMISSION_OUTCOME.NOT_DISPATCHED;
      }

      await sleep(50);
      const outcome = await submitCurrentComposer(webContents, composerText);
      if (shouldAdvanceAssistantTranscriptCursor(outcome)) {
        markTranscriptSubmitted(transcriptSnapshot, transcriptEntriesSnapshot);
      } else if (needsAssistantSubmissionRetry(outcome)) {
        sendCaptionError(
          'Assistant submission is uncertain. The transcript was not marked sent; verify the assistant and retry only if needed.'
        );
      } else {
        const sendButtonReady = await waitForSendButtonReady(webContents, 6, 75);
        console.error('[ERROR] Ctrl+Enter could not submit the current assistant composer without focusing it');
        if (!sendButtonReady) {
          console.error('[ERROR] Assistant send button did not become ready after Ctrl+Enter injection');
        }
      }

      return outcome;
    } finally {
      await settlePageFocusState(webContents, focusState);
    }
  });

  if (mutationResult.status === ASSISTANT_MUTATION_STATUS.BUSY) {
    sendCaptionError('Assistant is busy sending or uploading in this tab. Please wait for it to finish.');
  } else if (mutationResult.status === ASSISTANT_MUTATION_STATUS.FAILED) {
    console.error('[ERROR] Ctrl+Enter assistant mutation failed:', mutationResult.error);
    sendCaptionError('Assistant submission failed before it could be confirmed. Please retry.');
  }
}

async function copyTranscriptPromptToClipboard() {
  const transcriptSnapshot = normalizeTranscriptTextForPrompt(latestTranscriptText);
  const transcriptEntriesSnapshot = normalizeTranscriptEntriesForPrompt(latestTranscriptEntries);
  const cursorResult = resolvePendingTranscriptCursor({
    transcriptText: transcriptSnapshot,
    transcriptEntries: transcriptEntriesSnapshot,
    cursorText: lastClipboardTranscriptText,
    cursorEntries: lastClipboardTranscriptEntries,
    allowDisjointCurrentTranscript: transcriptSource === TRANSCRIPT_SOURCE_LIVE_CAPTIONS
  });

  if (cursorResult.status === 'mismatch') {
    sendCaptionError(TRANSCRIPT_CURSOR_MISMATCH_ERROR);
    return;
  }

  const clipboardText = getTranscriptPromptText(
    cursorResult.pendingText,
    cursorResult.pendingEntries
  );
  if (!clipboardText.trim()) {
    console.error('[ERROR] No new transcript or prompt text is available for Alt+Enter');
    return;
  }

  clipboard.writeText(clipboardText);
  markTranscriptCopiedToClipboard(transcriptSnapshot, transcriptEntriesSnapshot);
}

async function pasteFullScreenIntoAssistant() {
  const tabId = activeTabId;
  const webContents = getActiveTabWebContents();
  if (tabId === null || !webContents) {
    return;
  }

  if (!ensureSupportedAssistantTab(webContents, 'Ctrl+Shift+Enter')) {
    return;
  }

  const mutationResult = await assistantMutationController.run(tabId, async () => {
    const focusState = await capturePageFocusState(webContents);

    try {
      const preparedCapture = await screenCapture.prepareDisplayCapture(getCurrentDisplayId());
      const pasted = await pasteImageIntoComposer(webContents, preparedCapture.image);
      if (!pasted) {
        console.error('[ERROR] Ctrl+Shift+Enter could not verify an assistant image attachment without focusing the assistant');
        sendCaptionError('Screenshot attachment could not be verified. Nothing was sent to the assistant.');
        return false;
      }

      await sleep(150);
      return true;
    } finally {
      await settlePageFocusState(webContents, focusState);
    }
  });

  if (mutationResult.status === ASSISTANT_MUTATION_STATUS.BUSY) {
    sendCaptionError('Assistant is busy sending or uploading in this tab. Please wait for it to finish.');
  } else if (mutationResult.status === ASSISTANT_MUTATION_STATUS.FAILED) {
    console.error('[ERROR] Ctrl+Shift+Enter assistant mutation failed:', mutationResult.error);
    sendCaptionError('Screenshot attachment failed before it could be verified. Please retry.');
  }
}

function toggleMuteAllTabs() {
  isMuted = !isMuted;
  tabs.forEach((tab) => {
    if (tab.view && tab.view.webContents) {
      tab.view.webContents.setAudioMuted(isMuted);
    }
  });
  scheduleAppPreferencesPersist();
}

function setupGlobalShortcuts() {
  registerAllGlobalHotkeys();
  registerAllModeHotkeys();
}

async function closeLiveCaptionsForAppExit() {
  if (liveCaptionsExitCleanupComplete) {
    return;
  }

  if (liveCaptionsExitCleanupPromise) {
    await liveCaptionsExitCleanupPromise;
    return;
  }

  if (captionSyncStartTimer) {
    clearTimeout(captionSyncStartTimer);
    captionSyncStartTimer = null;
  }

  liveCaptionsExitCleanupPromise = (async () => {
    try {
      if (deepgramLifecycleCoordinator || deepgramTranscriptionService) {
        await getDeepgramLifecycleCoordinator().shutdown();
      }
      if (captionSync && typeof captionSync.stopAndCloseLiveCaptions === 'function') {
        await captionSync.stopAndCloseLiveCaptions();
      } else if (captionSync && typeof captionSync.stop === 'function') {
        captionSync.stop();
      }
    } catch (error) {
      console.error('[WARNING] Failed to close Live Captions during app shutdown:', error);
    } finally {
      liveCaptionsExitCleanupComplete = true;
    }
  })();

  await liveCaptionsExitCleanupPromise;
}

function closeAuxiliaryWindowsForAppExit() {
  closeModeMenuWindow();

  if (hotkeySettingsWindow && !hotkeySettingsWindow.isDestroyed()) {
    hotkeySettingsWindow.close();
  }
}

function requestAppQuit() {
  if (appQuitRequested) {
    return;
  }

  appQuitRequested = true;
  closeAuxiliaryWindowsForAppExit();

  closeLiveCaptionsForAppExit()
    .catch((error) => {
      console.error('[WARNING] Live Captions shutdown failed:', error);
    })
    .then(() => cleanupTemporaryUploadDir())
    .catch((error) => {
      console.error('[WARNING] Temporary upload cleanup failed:', error);
    })
    .finally(() => {
      app.quit();
    });
}

ipcMain.on('screen-capture-overlay-select', (event, selectionRect) => {
  if (!isCaptureOverlaySender(event)) {
    return;
  }

  resolveScreenSelection(selectionRect);
});

ipcMain.on('screen-capture-overlay-cancel', (event) => {
  if (!isCaptureOverlaySender(event)) {
    return;
  }

  resolveScreenSelection(null);
});

ipcMain.on('deepgram-audio-chunk', (event, payload = {}) => {
  if (!isMainWindowSender(event) || transcriptSource !== TRANSCRIPT_SOURCE_DEEPGRAM) {
    return;
  }

  const chunk = normalizeDeepgramAudioChunk(payload?.chunk);
  if (chunk.length === 0) {
    return;
  }

  getDeepgramTranscriptionService().sendAudioChunk(payload?.role, chunk);
});

ipcMain.handle('deepgram-capture-command-ack', (event, payload = {}) => {
  if (!isMainWindowSender(event)) {
    return rejectUnauthorizedIpc('deepgram-capture-command-ack', false);
  }

  return acknowledgeDeepgramRendererCommand(payload);
});

app.whenReady().then(async () => {
  loadPromptModeState();
  loadGlobalHotkeyState();
  loadAppPreferences();
  applyNativeTheme();
  await cleanupTemporaryUploadDir();
  createWindow();
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
  try {
    globalShortcut.unregisterAll();
  } catch (error) {
    console.error('[WARNING] Failed to unregister global shortcuts:', error);
  }
  void cleanupTemporaryUploadDir();
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
  }
});

ipcMain.handle('create-tab', (event, url) => {
  if (!isMainWindowSender(event)) {
    return rejectUnauthorizedIpc('create-tab', null);
  }

  return createNewTab(url || 'about:blank');
});

ipcMain.handle('close-tab', (event, tabId) => {
  if (!isMainWindowSender(event)) {
    return rejectUnauthorizedIpc('close-tab');
  }

  closeTab(tabId);
  return true;
});

ipcMain.handle('close-app', (event) => {
  if (!isMainWindowSender(event)) {
    return rejectUnauthorizedIpc('close-app');
  }

  requestAppQuit();
  return true;
});

ipcMain.handle('open-hotkey-settings', (event) => {
  if (!isMainWindowSender(event)) {
    return rejectUnauthorizedIpc('open-hotkey-settings');
  }

  return openHotkeySettingsWindow();
});

ipcMain.handle('open-mode-menu', (event, payload) => {
  if (!isMainWindowSender(event)) {
    return rejectUnauthorizedIpc('open-mode-menu');
  }

  return openModeMenuWindow(payload?.anchor);
});

ipcMain.handle('close-mode-menu', (event) => {
  if (!isMainOrModeMenuSender(event)) {
    return rejectUnauthorizedIpc('close-mode-menu');
  }

  return closeModeMenuWindow();
});

ipcMain.handle('get-mode-menu-state', (event) => {
  if (!isMainOrModeMenuSender(event)) {
    return rejectUnauthorizedIpc('get-mode-menu-state', null);
  }

  return getModeMenuStateSnapshot();
});

ipcMain.handle('mode-menu-action', (event, action) => {
  if (!modeMenuWindow || modeMenuWindow.isDestroyed() || event.sender !== modeMenuWindow.webContents) {
    return false;
  }

  if (!mainWindow || mainWindow.isDestroyed()) {
    return false;
  }

  if (!action || typeof action !== 'object' || typeof action.type !== 'string') {
    return false;
  }

  mainWindow.webContents.send('mode-menu-action', action);
  return true;
});

ipcMain.handle('switch-tab', (event, tabId) => {
  if (!isMainWindowSender(event)) {
    return rejectUnauthorizedIpc('switch-tab');
  }

  switchTab(tabId);
  return true;
});

ipcMain.handle('navigate', (event, url) => {
  if (!isMainWindowSender(event)) {
    return rejectUnauthorizedIpc('navigate');
  }

  const nextUrl = normalizeAllowedNavigationUrl(url);
  if (!nextUrl) {
    console.warn(`[WARNING] Blocked unsupported navigation URL from renderer: ${String(url || '')}`);
    return false;
  }

  if (activeTabId !== null) {
    return navigateTabTo(activeTabId, nextUrl, { reason: 'address-bar navigation' });
  }
  return false;
});

ipcMain.handle('go-back', (event) => {
  if (!isMainWindowSender(event)) {
    return rejectUnauthorizedIpc('go-back');
  }

  if (activeTabId !== null) {
    const tab = tabs.get(activeTabId);
    if (tab && tab.view.webContents.navigationHistory.canGoBack()) {
      tab.view.webContents.navigationHistory.goBack();
      return true;
    }
  }
  return false;
});

ipcMain.handle('go-forward', (event) => {
  if (!isMainWindowSender(event)) {
    return rejectUnauthorizedIpc('go-forward');
  }

  if (activeTabId !== null) {
    const tab = tabs.get(activeTabId);
    if (tab && tab.view.webContents.navigationHistory.canGoForward()) {
      tab.view.webContents.navigationHistory.goForward();
      return true;
    }
  }
  return false;
});

ipcMain.handle('reload', (event) => {
  if (!isMainWindowSender(event)) {
    return rejectUnauthorizedIpc('reload');
  }

  if (activeTabId !== null) {
    const tab = tabs.get(activeTabId);
    if (tab) {
      tab.view.webContents.reload();
      return true;
    }
  }
  return false;
});

ipcMain.handle('set-panel-split-ratio', (event, ratio) => {
  if (!isMainWindowSender(event)) {
    return rejectUnauthorizedIpc('set-panel-split-ratio', horizontalTranscriptPanelRatio);
  }

  if (Number.isFinite(ratio)) {
    horizontalTranscriptPanelRatio = normalizeSplitRatio(ratio, DEFAULT_HORIZONTAL_TRANSCRIPT_PANEL_RATIO);
    scheduleAppPreferencesPersist();
    broadcastAppPreferences();
    resizeTabs();
  }

  return horizontalTranscriptPanelRatio;
});

ipcMain.handle('set-mode-panel-collapsed', (event, collapsed) => {
  if (!isMainWindowSender(event)) {
    return rejectUnauthorizedIpc('set-mode-panel-collapsed', isModePanelCollapsed);
  }

  isModePanelCollapsed = Boolean(collapsed);
  scheduleAppPreferencesPersist();
  resizeTabs();
  return isModePanelCollapsed;
});

ipcMain.handle('get-app-preferences', (event) => {
  if (!isMainOrHotkeySettingsSender(event)) {
    return rejectUnauthorizedIpc('get-app-preferences', null);
  }

  return getAppPreferenceStateSnapshot();
});

ipcMain.handle('set-translation-visible', (event, isVisible) => {
  if (!isMainWindowSender(event)) {
    return rejectUnauthorizedIpc('set-translation-visible', getAppPreferenceStateSnapshot());
  }

  return setTranslationVisible(isVisible);
});

ipcMain.handle('set-translation-enabled', (event, isEnabled) => {
  if (!isMainOrHotkeySettingsSender(event)) {
    return rejectUnauthorizedIpc('set-translation-enabled', getAppPreferenceStateSnapshot());
  }

  return setTranslationEnabled(isEnabled);
});

ipcMain.handle('set-transcript-source', (event, source) => {
  if (!isMainOrHotkeySettingsSender(event)) {
    return rejectUnauthorizedIpc('set-transcript-source', getAppPreferenceStateSnapshot());
  }

  return setTranscriptSourcePreference(source);
});

ipcMain.handle('set-deepgram-api-key', (event, apiKey) => {
  if (!isHotkeySettingsWindowSender(event)) {
    return rejectUnauthorizedIpc('set-deepgram-api-key', getAppPreferenceStateSnapshot());
  }

  return setDeepgramApiKeyPreference(apiKey);
});

ipcMain.handle('clear-deepgram-api-key', (event) => {
  if (!isHotkeySettingsWindowSender(event)) {
    return rejectUnauthorizedIpc('clear-deepgram-api-key', getAppPreferenceStateSnapshot());
  }

  return clearDeepgramApiKeyPreference();
});

ipcMain.handle('start-deepgram-transcription', (event) => {
  if (!isMainWindowSender(event)) {
    return rejectUnauthorizedIpc('start-deepgram-transcription', getDeepgramCaptureStateSnapshot('unauthorized'));
  }

  return startDeepgramTranscriptSource();
});

ipcMain.handle('stop-deepgram-transcription', (event) => {
  if (!isMainWindowSender(event)) {
    return rejectUnauthorizedIpc('stop-deepgram-transcription', getDeepgramCaptureStateSnapshot('unauthorized'));
  }

  return stopDeepgramTranscriptSource('stopped');
});

ipcMain.handle('refresh-deepgram-usage', async (event) => {
  if (!isMainWindowSender(event)) {
    return rejectUnauthorizedIpc('refresh-deepgram-usage', getDeepgramUsageSnapshot());
  }

  return refreshDeepgramAccountUsage();
});

ipcMain.handle('add-prompt-mode', (event) => {
  if (!isMainWindowSender(event)) {
    return rejectUnauthorizedIpc('add-prompt-mode', null);
  }

  return addPromptMode();
});

ipcMain.handle('select-prompt-mode', async (event, modeId) => {
  if (!isMainWindowSender(event)) {
    return rejectUnauthorizedIpc('select-prompt-mode', null);
  }

  return selectPromptMode(modeId);
});

ipcMain.handle('delete-prompt-mode', (event, modeId) => {
  if (!isMainWindowSender(event)) {
    return rejectUnauthorizedIpc('delete-prompt-mode', null);
  }

  return deletePromptMode(modeId);
});

ipcMain.handle('rename-prompt-mode', (event, payload) => {
  if (!isMainWindowSender(event)) {
    return rejectUnauthorizedIpc('rename-prompt-mode', null);
  }

  return renamePromptMode(payload?.modeId, payload?.name);
});

ipcMain.handle('save-prompt-mode', (event, payload) => {
  if (!isMainWindowSender(event)) {
    return rejectUnauthorizedIpc('save-prompt-mode', null);
  }

  return savePromptMode(payload?.modeId, payload?.suffix);
});

ipcMain.handle('update-prompt-mode-draft', (event, payload) => {
  if (!isMainWindowSender(event)) {
    return rejectUnauthorizedIpc('update-prompt-mode-draft', {
      accepted: false,
      promptModePersistence: getPromptModePersistenceStatus()
    });
  }

  return updatePromptModeDraft(
    payload?.modeId,
    payload?.suffix,
    payload?.sessionId,
    payload?.revision
  );
});

ipcMain.handle('flush-prompt-mode-drafts', async (event) => {
  if (!isMainWindowSender(event)) {
    return rejectUnauthorizedIpc('flush-prompt-mode-drafts', {
      success: false,
      promptModePersistence: getPromptModePersistenceStatus()
    });
  }

  const result = await flushPromptModeStatePersist();
  return {
    success: result.success,
    promptModePersistence: result.status
  };
});

ipcMain.handle('set-prompt-mode-hotkey', (event, payload) => {
  if (!isMainWindowSender(event)) {
    return rejectUnauthorizedIpc('set-prompt-mode-hotkey', {
      success: false,
      promptModeState: getPromptModeStateSnapshot()
    });
  }

  return setPromptModeHotkey(payload?.modeId, payload?.hotkey);
});

ipcMain.handle('get-global-hotkeys', (event) => {
  if (!isHotkeySettingsWindowSender(event)) {
    return rejectUnauthorizedIpc('get-global-hotkeys', null);
  }

  return getGlobalHotkeyStateSnapshot();
});

ipcMain.handle('set-global-hotkey', (event, payload) => {
  if (!isHotkeySettingsWindowSender(event)) {
    return rejectUnauthorizedIpc('set-global-hotkey', {
      success: false,
      globalHotkeyState: getGlobalHotkeyStateSnapshot()
    });
  }

  return setGlobalHotkey(payload?.id, payload?.accelerator);
});

ipcMain.handle('save-transcript', async (event) => {
  if (!isMainWindowSender(event)) {
    return rejectUnauthorizedIpc('save-transcript', {
      success: false,
      canceled: false,
      reason: 'unauthorized'
    });
  }

  try {
    return await saveTranscriptToFile();
  } catch (error) {
    console.error('[ERROR] Failed to save transcript:', error);
    return {
      success: false,
      canceled: false,
      reason: 'error',
      error: error?.message || String(error)
    };
  }
});

ipcMain.handle('clear-transcript', async (event) => {
  if (!isMainWindowSender(event)) {
    return rejectUnauthorizedIpc('clear-transcript', {
      success: false,
      liveCaptionsVisible: null
    });
  }

  resetTranscriptStateForSource();

  if (transcriptSource === TRANSCRIPT_SOURCE_DEEPGRAM) {
    await getDeepgramLifecycleCoordinator().clear();

    return {
      success: true,
      liveCaptionsVisible: null,
      transcriptSource
    };
  }

  if (captionSync && typeof captionSync.clearTranscript === 'function') {
    try {
      const result = await captionSync.clearTranscript();
      getLiveCaptionsTranscriptSessionId();
      broadcastTranscriptSourceLifecycleState(TRANSCRIPT_SOURCE_LIVE_CAPTIONS, {
        ...(captionSync.getState?.() || {}),
        phase: result?.success ? 'active' : 'error',
        active: Boolean(result?.success),
        reason: result?.success ? 'cleared' : 'clear-failed'
      });
      if (result && typeof result === 'object') {
        if (typeof result.liveCaptionsVisible === 'boolean') {
          liveCaptionsWindowVisible = result.liveCaptionsVisible;
          scheduleAppPreferencesPersist();
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
      sendCaptionError(error, { source: TRANSCRIPT_SOURCE_LIVE_CAPTIONS });
      broadcastTranscriptSourceLifecycleState(TRANSCRIPT_SOURCE_LIVE_CAPTIONS, {
        phase: 'error',
        active: false,
        error: error?.message || String(error),
        reason: 'clear-failed'
      });
    }
  }

  return {
    success: false,
    liveCaptionsVisible: null
  };
});

ipcMain.handle('toggle-live-captions-window', async (event) => {
  if (!isMainWindowSender(event)) {
    return rejectUnauthorizedIpc('toggle-live-captions-window', null);
  }

  if (transcriptSource !== TRANSCRIPT_SOURCE_LIVE_CAPTIONS) {
    return null;
  }

  if (!captionSync || typeof captionSync.toggleLiveCaptionsVisibility !== 'function') {
    return null;
  }

  try {
    const isVisible = await captionSync.toggleLiveCaptionsVisibility();
    if (typeof isVisible === 'boolean') {
      liveCaptionsWindowVisible = isVisible;
      scheduleAppPreferencesPersist();
      broadcastAppPreferences();
    }
    return isVisible;
  } catch (error) {
    console.error('[ERROR] Failed to toggle Live Captions window visibility:', error);
    throw error;
  }
});

ipcMain.handle('get-live-captions-window-visibility', async (event) => {
  if (!isMainWindowSender(event)) {
    return rejectUnauthorizedIpc('get-live-captions-window-visibility', null);
  }

  if (transcriptSource !== TRANSCRIPT_SOURCE_LIVE_CAPTIONS) {
    return null;
  }

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

ipcMain.handle('get-tabs', (event) => {
  if (!isMainWindowSender(event)) {
    return rejectUnauthorizedIpc('get-tabs', null);
  }

  return {
    activeTabId,
    panelSplitRatio: horizontalTranscriptPanelRatio,
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
  applyTranscriptPayload(payload);
});

if (captionSync) {
  captionSync.on('state', (state) => {
    if (transcriptSource !== TRANSCRIPT_SOURCE_LIVE_CAPTIONS) {
      return;
    }

    getLiveCaptionsTranscriptSessionId();
    broadcastTranscriptSourceLifecycleState(TRANSCRIPT_SOURCE_LIVE_CAPTIONS, state);
  });

  // Handle caption updates from caption sync service
  captionSync.on('captionUpdate', (data) => {
    if (transcriptSource !== TRANSCRIPT_SOURCE_LIVE_CAPTIONS) {
      return;
    }

    const incomingEntries = normalizeTranscriptEntriesForPrompt(data?.entries);
    const liveCaptionText = typeof data?.fullText === 'string'
      ? data.fullText
      : getTranscriptTextFromEntries(incomingEntries);
    applyTranscriptPayload(translationManager.update(liveCaptionText));
  });

  captionSync.on('error', (error) => {
    const isRecoverable = error?.recoverable === true;
    const logMethod = isRecoverable ? 'warn' : 'error';
    console[logMethod](`[${isRecoverable ? 'WARNING' : 'ERROR'}] Caption sync ${isRecoverable ? 'warning' : 'error'}:`, error);
    if (transcriptSource !== TRANSCRIPT_SOURCE_LIVE_CAPTIONS) {
      return;
    }

    sendCaptionError(error, { source: TRANSCRIPT_SOURCE_LIVE_CAPTIONS });
    broadcastTranscriptSourceLifecycleState(TRANSCRIPT_SOURCE_LIVE_CAPTIONS, {
      ...getCaptionSyncErrorLifecycleState(error, captionSync.getState?.() || {})
    });
  });
}

module.exports.PromptModePersistenceController = PromptModePersistenceController;
