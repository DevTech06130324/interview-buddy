const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const os = require('node:os');
const path = require('node:path');

const MAIN_MODULE_PATH = path.join(__dirname, '..', 'main.js');

function loadPromptPersistenceController() {
  const originalLoad = Module._load;
  const originalCacheEntry = require.cache[MAIN_MODULE_PATH];
  const pendingReady = new Promise(() => {});
  const electron = {
    app: {
      setName() {},
      setAppUserModelId() {},
      getPath() {
        return os.tmpdir();
      },
      whenReady() {
        return pendingReady;
      },
      on() {},
      quit() {}
    },
    BrowserWindow: class BrowserWindow {},
    BrowserView: class BrowserView {},
    ipcMain: {
      handle() {},
      on() {}
    },
    globalShortcut: {
      register() {
        return true;
      },
      unregister() {},
      unregisterAll() {}
    },
    screen: {
      getPrimaryDisplay() {
        return { workArea: { x: 0, y: 0, width: 100, height: 100 } };
      }
    },
    clipboard: {},
    nativeTheme: {},
    dialog: {},
    safeStorage: {
      isEncryptionAvailable() {
        return false;
      }
    },
    desktopCapturer: {}
  };

  Module._load = function load(request, parent, isMain) {
    if (request === 'electron') {
      return electron;
    }

    return originalLoad.call(this, request, parent, isMain);
  };

  delete require.cache[MAIN_MODULE_PATH];
  try {
    return require(MAIN_MODULE_PATH).PromptModePersistenceController;
  } finally {
    Module._load = originalLoad;
    if (originalCacheEntry) {
      require.cache[MAIN_MODULE_PATH] = originalCacheEntry;
    } else {
      delete require.cache[MAIN_MODULE_PATH];
    }
  }
}

const PromptModePersistenceController = loadPromptPersistenceController();

function createPersistenceHarness({ writeFile } = {}) {
  let suffix = '';
  const asyncWrites = [];
  const syncWrites = [];
  const statuses = [];
  const controller = new PromptModePersistenceController({
    serialize: () => JSON.stringify({
      promptModes: [{ id: 'default', suffix }]
    }),
    getStorePath: () => path.join(os.tmpdir(), 'prompt-modes.json'),
    debounceMs: 10_000,
    fsModule: {
      promises: {
        mkdir: async () => {},
        writeFile: async (storePath, payload, encoding) => {
          asyncWrites.push({ storePath, payload, encoding });
          if (writeFile) {
            await writeFile(storePath, payload, encoding);
          }
        }
      },
      mkdirSync() {},
      writeFileSync: (storePath, payload, encoding) => {
        syncWrites.push({ storePath, payload, encoding });
      }
    },
    onStatus: (status) => statuses.push(status)
  });

  return {
    controller,
    asyncWrites,
    syncWrites,
    statuses,
    setSuffix(value) {
      suffix = value;
    }
  };
}

function deferred() {
  let resolve;
  const promise = new Promise((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

test('a mode switch flushes the latest rapid draft revision before leaving the mode', async () => {
  const harness = createPersistenceHarness();

  harness.setSuffix('First draft');
  harness.controller.schedule();
  harness.setSuffix('Final draft');
  harness.controller.schedule();

  const result = await harness.controller.flush();

  assert.equal(result.success, true);
  assert.equal(harness.asyncWrites.length, 1);
  assert.match(harness.asyncWrites[0].payload, /Final draft/);
  assert.equal(harness.controller.getStatus().dirty, false);
});

test('application shutdown synchronously flushes the newest draft revision', () => {
  const harness = createPersistenceHarness();

  harness.setSuffix('Draft before close');
  harness.controller.schedule();
  harness.setSuffix('Latest draft before close');
  harness.controller.schedule();

  const result = harness.controller.flushSync();

  assert.equal(result.success, true);
  assert.equal(harness.syncWrites.length, 1);
  assert.match(harness.syncWrites[0].payload, /Latest draft before close/);
  assert.equal(harness.controller.getStatus().dirty, false);
});

test('a failed write preserves the dirty prompt draft and exposes an error status', async () => {
  const harness = createPersistenceHarness({
    writeFile: async () => {
      throw new Error('disk is read-only');
    }
  });

  harness.setSuffix('Do not lose this draft');
  harness.controller.schedule();

  const result = await harness.controller.flush();

  assert.equal(result.success, false);
  assert.equal(harness.controller.getStatus().dirty, true);
  assert.equal(harness.controller.getStatus().state, 'error');
  assert.match(harness.controller.getStatus().message, /disk is read-only/);
  assert.match(harness.statuses.at(-1).message, /disk is read-only/);
});

test('shutdown reasserts its newest snapshot after an older async write completes', async () => {
  let suffix = 'Old draft';
  let persistedPayload = '';
  const writeStarted = deferred();
  const allowOldWriteToFinish = deferred();
  const controller = new PromptModePersistenceController({
    serialize: () => JSON.stringify({
      promptModes: [{ id: 'default', suffix }]
    }),
    getStorePath: () => path.join(os.tmpdir(), 'prompt-modes.json'),
    debounceMs: 10_000,
    fsModule: {
      promises: {
        mkdir: async () => {},
        writeFile: async (storePath, payload) => {
          writeStarted.resolve();
          await allowOldWriteToFinish.promise;
          persistedPayload = payload;
        }
      },
      mkdirSync() {},
      writeFileSync: (storePath, payload) => {
        persistedPayload = payload;
      }
    }
  });

  controller.schedule();
  const inFlightFlush = controller.flush();
  await writeStarted.promise;

  suffix = 'Latest draft before shutdown';
  controller.schedule();
  controller.flushSync();
  assert.match(persistedPayload, /Latest draft before shutdown/);

  allowOldWriteToFinish.resolve();
  await inFlightFlush;

  assert.match(persistedPayload, /Latest draft before shutdown/);
});
