const test = require('node:test');
const assert = require('node:assert/strict');

const {
  DEEPGRAM_ROLE_ME,
  DEEPGRAM_ROLE_THEM,
  DeepgramTranscriptionService
} = require('../src/deepgramTranscriptionService');
const {
  DeepgramLifecycleCoordinator
} = require('../src/deepgramLifecycleCoordinator');

class IntegrationWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSED = 3;
  static instances = [];
  static autoCloseOnCloseStream = true;

  constructor(url, options) {
    this.url = url;
    this.options = options;
    this.readyState = IntegrationWebSocket.CONNECTING;
    this.sent = [];
    this.listeners = new Map();
    IntegrationWebSocket.instances.push(this);
  }

  on(eventName, listener) {
    const listeners = this.listeners.get(eventName) || [];
    listeners.push(listener);
    this.listeners.set(eventName, listeners);
  }

  emit(eventName, payload) {
    for (const listener of this.listeners.get(eventName) || []) {
      listener(payload);
    }
  }

  open() {
    this.readyState = IntegrationWebSocket.OPEN;
    this.emit('open');
  }

  send(chunk) {
    this.sent.push(chunk);
    if (
      chunk === JSON.stringify({ type: 'CloseStream' })
      && IntegrationWebSocket.autoCloseOnCloseStream
    ) {
      this.close();
    }
  }

  close() {
    if (this.readyState === IntegrationWebSocket.CLOSED) {
      return;
    }
    this.readyState = IntegrationWebSocket.CLOSED;
    this.emit('close');
  }
}

function createHarness({
  requestRendererStart = async () => true,
  autoCloseOnCloseStream = true,
  closeGraceMs = 5,
  retryDelaysMs = [5, 10, 20]
} = {}) {
  IntegrationWebSocket.instances = [];
  IntegrationWebSocket.autoCloseOnCloseStream = autoCloseOnCloseStream;
  const service = new DeepgramTranscriptionService({
    WebSocketImpl: IntegrationWebSocket,
    openTimeoutMs: 100,
    retryDelaysMs,
    closeGraceMs
  });
  const fatalErrors = [];
  const emittedFatalEvents = [];
  const captionErrors = [];
  const states = [];
  let coordinator;
  service.on('fatalError', (error, context = {}) => {
    emittedFatalEvents.push({ error, context });
    const currentRevision = coordinator?.getState?.().revision;
    if (context.revision !== undefined && context.revision !== currentRevision) {
      void coordinator.failClosed(error, { revision: context.revision });
      return;
    }
    fatalErrors.push(error.message);
    captionErrors.push(`Deepgram transcription stopped: ${error.message}`);
    void coordinator.failClosed(error, { revision: context.revision });
  });
  coordinator = new DeepgramLifecycleCoordinator({
    service,
    requestRendererStart,
    requestRendererStop: async () => true,
    onState: (state) => states.push(state)
  });
  return {
    service,
    coordinator,
    fatalErrors,
    emittedFatalEvents,
    captionErrors,
    states
  };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function startHarness(coordinator, apiKey = 'dg_initial') {
  const startPromise = coordinator.start({ apiKey });
  for (const socket of IntegrationWebSocket.instances) {
    socket.open();
  }
  await startPromise;
}

function getConnectingRoleSockets() {
  return IntegrationWebSocket.instances.filter((socket) => (
    socket.readyState === IntegrationWebSocket.CONNECTING
    && [DEEPGRAM_ROLE_THEM, DEEPGRAM_ROLE_ME].includes(socket.options.role)
  ));
}

async function waitFor(predicate, message = 'condition was not reached') {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.fail(message);
}

test('coordinator stop cancels an in-flight real-service start without fatal or caption errors', async () => {
  const { service, coordinator, fatalErrors, captionErrors } = createHarness();
  const startPromise = coordinator.start({ apiKey: 'dg_connect_stop' });
  assert.equal(getConnectingRoleSockets().length, 2);

  const stopPromise = coordinator.stop({ reason: 'manual-stop' });
  await Promise.all([startPromise, stopPromise]);

  assert.deepEqual(fatalErrors, []);
  assert.deepEqual(captionErrors, []);
  assert.equal(service.sockets.size, 0);
  assert.equal(coordinator.getState().active, false);
  assert.equal(coordinator.getState().reason, 'manual-stop');
});

test('coordinator stop cancels an in-flight real-service clear without fatal or caption errors', async () => {
  const { coordinator, fatalErrors, captionErrors, states } = createHarness();
  await startHarness(coordinator);

  const clearPromise = coordinator.clear();
  assert.equal(getConnectingRoleSockets().length, 2);
  const stopPromise = coordinator.stop({ reason: 'source-switched' });
  await Promise.all([clearPromise, stopPromise]);
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(fatalErrors, []);
  assert.deepEqual(captionErrors, []);
  assert.equal(states.some((state) => state.reason === 'backend-failed'), false);
  assert.equal(coordinator.getState().reason, 'source-switched');
});

test('Clear during real-service Stop erases retained final entries before restart', async () => {
  const { service, coordinator, fatalErrors, captionErrors } = createHarness({
    autoCloseOnCloseStream: false,
    closeGraceMs: 20
  });
  await startHarness(coordinator, 'dg_stop_clear_restart');
  const oldSessionId = service.sessionId;
  service.sockets.get(DEEPGRAM_ROLE_THEM).emit('message', JSON.stringify({
    channel: { alternatives: [{ transcript: 'Retained from old session.' }] },
    is_final: true
  }));
  assert.equal(service.getPayload().entries.length, 1);

  const stopPromise = coordinator.stop({ reason: 'manual-stop' });
  await waitFor(() => service.phase === 'stopping', 'real service Stop was not pending');
  const clearPromise = coordinator.clear();

  assert.equal(coordinator.desired.sessionRevision, 1);
  assert.equal(coordinator.applied.sessionRevision, 0);
  await Promise.all([stopPromise, clearPromise]);

  assert.equal(coordinator.applied.sessionRevision, 1);
  assert.notEqual(service.sessionId, oldSessionId);
  assert.deepEqual(service.getPayload().entries, []);

  const restartPromise = coordinator.start({ apiKey: 'dg_stop_clear_restart' });
  await waitFor(
    () => getConnectingRoleSockets().length === 2,
    'restart sockets were not created after Stop and Clear'
  );
  for (const socket of getConnectingRoleSockets()) {
    socket.open();
  }
  await restartPromise;

  assert.deepEqual(service.getPayload().entries, []);
  assert.deepEqual(fatalErrors, []);
  assert.deepEqual(captionErrors, []);
  assert.equal(coordinator.getState().active, true);
});

test('coordinator stop cancels an in-flight real-service key rotation without fatal or caption errors', async () => {
  const { coordinator, fatalErrors, captionErrors, states } = createHarness();
  await startHarness(coordinator);

  const rotationPromise = coordinator.setApiKey({ apiKey: 'dg_rotating' });
  assert.equal(getConnectingRoleSockets().length, 2);
  const stopPromise = coordinator.stop({ reason: 'app-exit' });
  await Promise.all([rotationPromise, stopPromise]);
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(fatalErrors, []);
  assert.deepEqual(captionErrors, []);
  assert.equal(states.some((state) => state.reason === 'backend-failed'), false);
  assert.equal(coordinator.getState().reason, 'app-exit');
});

test('API-key edit during connecting supersedes the real backend with the new key before renderer capture', async () => {
  let rendererStartCount = 0;
  const { service, coordinator } = createHarness({
    requestRendererStart: async () => {
      rendererStartCount += 1;
      return true;
    }
  });
  const originalSessionId = service.sessionId;
  const originalStart = coordinator.start({ apiKey: 'dg_old_connecting' });
  assert.equal(coordinator.getState().phase, 'connecting');

  const keyUpdate = coordinator.setApiKey({ apiKey: 'dg_new_connecting' });
  await waitFor(
    () => getConnectingRoleSockets().every((socket) => (
      socket.options.headers.Authorization === 'Token dg_new_connecting'
    )) && getConnectingRoleSockets().length === 2,
    'latest connecting sockets were not created'
  );
  const connectingSockets = getConnectingRoleSockets();
  for (const socket of connectingSockets) {
    socket.open();
  }
  await Promise.all([originalStart, keyUpdate]);

  const finalSockets = [...service.sockets.values()];
  assert.equal(finalSockets.length, 2);
  assert.deepEqual(
    finalSockets.map((socket) => socket.options.headers.Authorization),
    ['Token dg_new_connecting', 'Token dg_new_connecting']
  );
  assert.equal(service.sessionId, originalSessionId);
  assert.equal(rendererStartCount, 1);
  assert.equal(coordinator.getState().active, true);
});

test('API-key edit while awaiting renderer rotates both roles once and gates active on new readiness plus renderer ack', async () => {
  const rendererReady = deferred();
  let rendererStartCount = 0;
  let rendererStopCount = 0;
  const harness = createHarness({
    requestRendererStart: async () => {
      rendererStartCount += 1;
      return rendererReady.promise;
    }
  });
  harness.coordinator.requestRendererStop = async () => {
    rendererStopCount += 1;
    return true;
  };
  const { service, coordinator } = harness;
  const originalSessionId = service.sessionId;
  const startPromise = coordinator.start({ apiKey: 'dg_old_renderer' });
  for (const socket of getConnectingRoleSockets()) {
    socket.open();
  }
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(coordinator.getState().phase, 'awaiting-renderer');

  const oldThemSocket = [...service.sockets.values()]
    .find((socket) => socket.options.role === DEEPGRAM_ROLE_THEM);
  oldThemSocket.emit('message', JSON.stringify({
    channel: { alternatives: [{ transcript: 'Preserved before rotation.' }] },
    is_final: true
  }));
  const preservedEntryId = service.getPayload().entries[0].id;

  const keyUpdate = coordinator.setApiKey({ apiKey: 'dg_new_renderer' });
  const activeBeforeRendererAck = coordinator.getState().active;
  rendererReady.resolve(true);
  await waitFor(
    () => getConnectingRoleSockets().length === 2,
    'renderer-gated rotation sockets were not created'
  );
  for (const socket of getConnectingRoleSockets()) {
    socket.open();
  }
  await Promise.all([startPromise, keyUpdate]);

  assert.equal(activeBeforeRendererAck, false);
  assert.equal(service.getPayload().entries[0].id, preservedEntryId);
  assert.deepEqual(
    [...service.sockets.values()].map((socket) => socket.options.headers.Authorization),
    ['Token dg_new_renderer', 'Token dg_new_renderer']
  );
  assert.equal(service.sessionId, originalSessionId);
  assert.equal(rendererStartCount, 1);
  assert.equal(rendererStopCount, 0);
  assert.equal(coordinator.getState().active, true);
});

test('two API-key edits during connecting converge on the latest key without a phase-specific restart', async () => {
  let rendererStartCount = 0;
  const { service, coordinator } = createHarness({
    autoCloseOnCloseStream: false,
    closeGraceMs: 10,
    requestRendererStart: async () => {
      rendererStartCount += 1;
      return true;
    }
  });
  const startPromise = coordinator.start({ apiKey: 'dg_initial_connecting' });
  const firstKeyUpdate = coordinator.setApiKey({ apiKey: 'dg_first_edit' });
  const secondKeyUpdate = coordinator.setApiKey({ apiKey: 'dg_second_edit' });
  await waitFor(
    () => getConnectingRoleSockets().filter((socket) => (
      socket.options.headers.Authorization === 'Token dg_second_edit'
    )).length === 2,
    'latest sockets were not created after two key edits'
  );
  for (const socket of getConnectingRoleSockets()) {
    socket.open();
  }
  await Promise.all([startPromise, firstKeyUpdate, secondKeyUpdate]);

  assert.deepEqual(
    [...service.sockets.values()].map((socket) => socket.options.headers.Authorization),
    ['Token dg_second_edit', 'Token dg_second_edit']
  );
  assert.equal(rendererStartCount, 1);
  assert.equal(coordinator.getState().active, true);
});

test('a newer key supersedes an already-connecting replacement before its late failure can discard the update', async () => {
  let rendererStartCount = 0;
  const { service, coordinator, fatalErrors } = createHarness({
    retryDelaysMs: [],
    requestRendererStart: async () => {
      rendererStartCount += 1;
      return true;
    }
  });
  const startPromise = coordinator.start({ apiKey: 'dg_initial_supersede' });
  const firstKeyUpdate = coordinator.setApiKey({ apiKey: 'dg_invalid_intermediate' });
  await waitFor(
    () => getConnectingRoleSockets().filter((socket) => (
      socket.options.headers.Authorization === 'Token dg_invalid_intermediate'
    )).length === 2,
    'invalid intermediate sockets were not created'
  );
  const intermediateSockets = getConnectingRoleSockets().filter((socket) => (
    socket.options.headers.Authorization === 'Token dg_invalid_intermediate'
  ));
  assert.equal(intermediateSockets.length, 2);

  const secondKeyUpdate = coordinator.setApiKey({ apiKey: 'dg_valid_latest' });
  for (const socket of intermediateSockets) {
    socket.emit('error', new Error('late invalid-key failure'));
  }
  await waitFor(
    () => getConnectingRoleSockets().filter((socket) => (
      socket.options.headers.Authorization === 'Token dg_valid_latest'
    )).length === 2,
    'valid latest sockets were not created'
  );
  for (const socket of getConnectingRoleSockets()) {
    socket.open();
  }
  await Promise.all([startPromise, firstKeyUpdate, secondKeyUpdate]);

  assert.deepEqual(fatalErrors, []);
  assert.deepEqual(
    [...service.sockets.values()].map((socket) => socket.options.headers.Authorization),
    ['Token dg_valid_latest', 'Token dg_valid_latest']
  );
  assert.equal(rendererStartCount, 1);
  assert.equal(coordinator.getState().active, true);
});

test('a second key edit at the replacement renderer gate rotates in place without duplicate capture', async () => {
  const rendererReady = deferred();
  let rendererStartCount = 0;
  let rendererStopCount = 0;
  const harness = createHarness({
    requestRendererStart: async () => {
      rendererStartCount += 1;
      return rendererReady.promise;
    }
  });
  harness.coordinator.requestRendererStop = async () => {
    rendererStopCount += 1;
    return true;
  };
  const { service, coordinator } = harness;
  const startPromise = coordinator.start({ apiKey: 'dg_initial_gate' });
  const firstKeyUpdate = coordinator.setApiKey({ apiKey: 'dg_first_gate' });
  await waitFor(
    () => getConnectingRoleSockets().length === 2,
    'first renderer-gate sockets were not created'
  );
  for (const socket of getConnectingRoleSockets()) {
    socket.open();
  }
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(coordinator.getState().phase, 'awaiting-renderer');

  const secondKeyUpdate = coordinator.setApiKey({ apiKey: 'dg_second_gate' });
  rendererReady.resolve(true);
  await waitFor(
    () => getConnectingRoleSockets().filter((socket) => (
      socket.options.headers.Authorization === 'Token dg_second_gate'
    )).length === 2,
    'second renderer-gate sockets were not created'
  );
  for (const socket of getConnectingRoleSockets()) {
    socket.open();
  }
  await new Promise((resolve) => setImmediate(resolve));
  for (const socket of getConnectingRoleSockets()) {
    socket.open();
  }
  await Promise.all([startPromise, firstKeyUpdate, secondKeyUpdate]);

  assert.deepEqual(
    [...service.sockets.values()].map((socket) => socket.options.headers.Authorization),
    ['Token dg_second_gate', 'Token dg_second_gate']
  );
  assert.equal(rendererStartCount, 1);
  assert.equal(rendererStopCount, 0);
  assert.equal(coordinator.getState().active, true);
});

test('a real-service fatal event from an older revision cannot stop a valid latest-key capture', async () => {
  const {
    service,
    coordinator,
    fatalErrors,
    emittedFatalEvents,
    captionErrors
  } = createHarness({
    autoCloseOnCloseStream: false,
    closeGraceMs: 15,
    retryDelaysMs: [50, 100, 200]
  });
  await startHarness(coordinator, 'dg_before_stale_fatal');
  const staleRevision = coordinator.getState().revision;
  const themSocket = service.sockets.get(DEEPGRAM_ROLE_THEM);
  themSocket.close();
  for (let index = 0; index < 17; index += 1) {
    service.sendAudioChunk(DEEPGRAM_ROLE_THEM, Buffer.from([index]));
  }

  const keyUpdate = coordinator.setApiKey({ apiKey: 'dg_after_stale_fatal' });
  await waitFor(
    () => getConnectingRoleSockets().filter((socket) => (
      socket.options.headers.Authorization === 'Token dg_after_stale_fatal'
    )).length === 2,
    'latest sockets were not created while stale fatal cleanup drained'
  );
  for (const socket of getConnectingRoleSockets()) {
    socket.open();
  }
  await keyUpdate;
  await new Promise((resolve) => setTimeout(resolve, 20));

  assert.equal(emittedFatalEvents.length, 1);
  assert.equal(emittedFatalEvents[0].context.revision, staleRevision);
  assert.deepEqual(fatalErrors, []);
  assert.deepEqual(captionErrors, []);
  assert.deepEqual(
    [...service.sockets.values()].map((socket) => socket.options.headers.Authorization),
    ['Token dg_after_stale_fatal', 'Token dg_after_stale_fatal']
  );
  assert.equal(coordinator.getState().active, true);
});

test('a current real-service fatal after a same-key edit still fails the lifecycle closed', async () => {
  const {
    service,
    coordinator,
    emittedFatalEvents,
    fatalErrors,
    captionErrors
  } = createHarness();
  await startHarness(coordinator, 'dg_same_key');
  const originalRevision = coordinator.getState().revision;

  await coordinator.setApiKey({ apiKey: 'dg_same_key' });
  assert.equal(coordinator.getState().revision, originalRevision);
  service.sockets.get(DEEPGRAM_ROLE_THEM).emit('message', '{same-key-invalid-json');
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(emittedFatalEvents.length, 1);
  assert.equal(fatalErrors.length, 1);
  assert.match(fatalErrors[0], /invalid deepgram json/i);
  assert.equal(captionErrors.length, 1);
  assert.equal(service.active, false);
  assert.equal(coordinator.getState().active, false);
  assert.equal(coordinator.getState().reason, 'backend-failed');
});

test('a valid latest key superseding an invalid rotation plus Clear never reconnects the obsolete key', async () => {
  let rendererStartCount = 0;
  let rendererStopCount = 0;
  const harness = createHarness({
    retryDelaysMs: [],
    requestRendererStart: async () => {
      rendererStartCount += 1;
      return true;
    }
  });
  harness.coordinator.requestRendererStop = async () => {
    rendererStopCount += 1;
    return true;
  };
  const { service, coordinator, fatalErrors } = harness;
  const originalSessionId = service.sessionId;
  await startHarness(coordinator, 'dg_initial_clear_key');

  const invalidUpdate = coordinator.setApiKey({ apiKey: 'dg_invalid_clear_key' });
  await waitFor(
    () => getConnectingRoleSockets().filter((socket) => (
      socket.options.headers.Authorization === 'Token dg_invalid_clear_key'
    )).length === 2,
    'invalid rotation sockets were not created'
  );
  const clearPromise = coordinator.clear();
  await waitFor(
    () => getConnectingRoleSockets().filter((socket) => (
      socket.options.headers.Authorization === 'Token dg_invalid_clear_key'
    )).length === 2,
    'clear did not begin reconnecting the in-flight key'
  );
  const clearedSessionId = service.sessionId;
  assert.notEqual(clearedSessionId, originalSessionId);

  const latestUpdate = coordinator.setApiKey({ apiKey: 'dg_valid_after_clear' });
  await waitFor(
    () => getConnectingRoleSockets().filter((socket) => (
      socket.options.headers.Authorization === 'Token dg_valid_after_clear'
    )).length === 2,
    'valid latest sockets were not created after clear supersession'
  );
  for (const socket of getConnectingRoleSockets()) {
    socket.open();
  }
  await Promise.all([invalidUpdate, clearPromise, latestUpdate]);

  assert.deepEqual(fatalErrors, []);
  assert.equal(service.sessionId, clearedSessionId);
  assert.deepEqual(
    [...service.sockets.values()].map((socket) => socket.options.headers.Authorization),
    ['Token dg_valid_after_clear', 'Token dg_valid_after_clear']
  );
  assert.equal(rendererStartCount, 1);
  assert.equal(rendererStopCount, 0);
  assert.equal(coordinator.getState().active, true);
});

test('same-session Clear retry preserves one buffered chunk for the final-key role socket', async () => {
  const { service, coordinator, fatalErrors } = createHarness();
  await startHarness(coordinator, 'dg_clear_buffer_old');
  const originalSessionId = service.sessionId;

  const clearPromise = coordinator.clear();
  await waitFor(
    () => getConnectingRoleSockets().filter((socket) => (
      socket.options.headers.Authorization === 'Token dg_clear_buffer_old'
    )).length === 2,
    'initial Clear replacement sockets were not created'
  );
  const clearedSessionId = service.sessionId;
  assert.notEqual(clearedSessionId, originalSessionId);
  const bufferedChunk = Buffer.from([41, 42, 43]);
  assert.equal(service.sendAudioChunk(DEEPGRAM_ROLE_THEM, bufferedChunk), true);

  const keyUpdate = coordinator.setApiKey({ apiKey: 'dg_clear_buffer_final' });
  await waitFor(
    () => getConnectingRoleSockets().filter((socket) => (
      socket.options.headers.Authorization === 'Token dg_clear_buffer_final'
    )).length === 2,
    'final-key Clear retry sockets were not created'
  );
  for (const socket of getConnectingRoleSockets()) {
    socket.open();
  }
  await Promise.all([clearPromise, keyUpdate]);

  const finalThemSocket = service.sockets.get(DEEPGRAM_ROLE_THEM);
  const finalKeyThemChunks = IntegrationWebSocket.instances
    .filter((socket) => (
      socket.options.role === DEEPGRAM_ROLE_THEM
      && socket.options.headers.Authorization === 'Token dg_clear_buffer_final'
    ))
    .flatMap((socket) => socket.sent.filter((item) => Buffer.isBuffer(item)));
  assert.equal(service.sessionId, clearedSessionId);
  assert.deepEqual(finalThemSocket.sent.filter((item) => Buffer.isBuffer(item)), [bufferedChunk]);
  assert.deepEqual(finalKeyThemChunks, [bufferedChunk]);
  assert.deepEqual(fatalErrors, []);
  assert.equal(coordinator.getState().active, true);
});
