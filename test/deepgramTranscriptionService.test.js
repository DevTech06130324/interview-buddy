const test = require('node:test');
const assert = require('node:assert/strict');

const {
  TRANSCRIPT_SPEAKER_TAG
} = require('../src/transcriptPrompt');

class FakeWebSocket {
  static instances = [];

  constructor(url, options = {}) {
    this.url = url;
    this.options = options;
    this.readyState = FakeWebSocket.CONNECTING;
    this.sent = [];
    this.closed = false;
    this.clientCloseCount = 0;
    this.autoCloseOnClient = true;
    this.autoServerCloseOnCloseStream = true;
    this.sendCount = 0;
    this.throwOnSendCount = 0;
    this.listeners = new Map();
    FakeWebSocket.instances.push(this);
  }

  on(eventName, listener) {
    if (!this.listeners.has(eventName)) {
      this.listeners.set(eventName, []);
    }
    this.listeners.get(eventName).push(listener);
  }

  emit(eventName, payload) {
    for (const listener of this.listeners.get(eventName) || []) {
      listener(payload);
    }
  }

  open() {
    this.readyState = FakeWebSocket.OPEN;
    this.emit('open');
  }

  send(chunk) {
    this.sendCount += 1;
    if (this.throwOnSendCount === this.sendCount) {
      throw new Error('socket send failed');
    }
    this.sent.push(chunk);
    if (chunk === JSON.stringify({ type: 'CloseStream' }) && this.autoServerCloseOnCloseStream) {
      this.serverClose();
    }
  }

  close() {
    this.clientCloseCount += 1;
    this.closed = true;
    this.readyState = FakeWebSocket.CLOSED;
    if (this.autoCloseOnClient) {
      this.emit('close');
    }
  }

  serverClose() {
    this.closed = true;
    this.readyState = FakeWebSocket.CLOSED;
    this.emit('close');
  }

  unexpectedClose() {
    this.serverClose();
  }
}

FakeWebSocket.CONNECTING = 0;
FakeWebSocket.OPEN = 1;
FakeWebSocket.CLOSED = 3;

function openLatestRoleSockets() {
  for (const socket of FakeWebSocket.instances.filter((candidate) => candidate.readyState === FakeWebSocket.CONNECTING)) {
    socket.open();
  }
}

async function startReady(service, apiKey) {
  const startPromise = service.start({ apiKey });
  openLatestRoleSockets();
  await startPromise;
}

test('Deepgram service opens one authorized stream per speaker role', async () => {
  const {
    DeepgramTranscriptionService,
    DEEPGRAM_AUDIO_MIME_TYPE,
    DEEPGRAM_ROLE_THEM,
    DEEPGRAM_ROLE_ME
  } = require('../src/deepgramTranscriptionService');

  FakeWebSocket.instances = [];
  const service = new DeepgramTranscriptionService({
    WebSocketImpl: FakeWebSocket
  });

  await startReady(service, 'dg_test_key_123456');

  assert.equal(DEEPGRAM_AUDIO_MIME_TYPE, 'audio/webm;codecs=opus');
  assert.equal(FakeWebSocket.instances.length, 2);
  assert.ok(FakeWebSocket.instances.every((socket) => socket.url.startsWith('wss://api.deepgram.com/v1/listen?')));
  assert.deepEqual(
    FakeWebSocket.instances.map((socket) => socket.options.headers.Authorization),
    ['Token dg_test_key_123456', 'Token dg_test_key_123456']
  );
  assert.deepEqual(
    FakeWebSocket.instances.map((socket) => socket.options.headers['Content-Type']),
    [DEEPGRAM_AUDIO_MIME_TYPE, DEEPGRAM_AUDIO_MIME_TYPE]
  );
  assert.deepEqual(
    FakeWebSocket.instances.map((socket) => socket.options.role).sort(),
    [DEEPGRAM_ROLE_ME, DEEPGRAM_ROLE_THEM].sort()
  );
});

test('Deepgram service emits ordered Them and Me transcript entries', async () => {
  const {
    DeepgramTranscriptionService,
    DEEPGRAM_ROLE_ME,
    DEEPGRAM_ROLE_THEM
  } = require('../src/deepgramTranscriptionService');

  FakeWebSocket.instances = [];
  const service = new DeepgramTranscriptionService({
    WebSocketImpl: FakeWebSocket
  });
  const payloads = [];
  service.on('captionUpdate', (payload) => payloads.push(payload));
  await startReady(service, 'dg_test_key_abcdef');

  const themSocket = FakeWebSocket.instances.find((socket) => socket.options.role === DEEPGRAM_ROLE_THEM);
  const meSocket = FakeWebSocket.instances.find((socket) => socket.options.role === DEEPGRAM_ROLE_ME);

  themSocket.emit('message', JSON.stringify({
    channel: { alternatives: [{ transcript: 'Hello from interviewer.' }] },
    is_final: true
  }));
  meSocket.emit('message', JSON.stringify({
    channel: { alternatives: [{ transcript: 'My answer.' }] },
    is_final: true
  }));

  const latestPayload = payloads.at(-1);
  assert.equal(latestPayload.entries.length, 2);
  assert.deepEqual(latestPayload.entries.map((entry) => entry.speakerTag), [TRANSCRIPT_SPEAKER_TAG, 'Me']);
  assert.deepEqual(latestPayload.entries.map((entry) => entry.sourceText), [
    'Hello from interviewer.',
    'My answer.'
  ]);
  assert.ok(latestPayload.entries.every((entry) => entry.receivedAtMs === undefined));
  assert.ok(latestPayload.entries.every((entry) => entry.order === undefined));
  assert.ok(latestPayload.payloadVersion >= 2);
});

test('Deepgram service keeps partial IDs stable only within one active utterance', async () => {
  const {
    DeepgramTranscriptionService,
    DEEPGRAM_ROLE_THEM
  } = require('../src/deepgramTranscriptionService');

  FakeWebSocket.instances = [];
  const service = new DeepgramTranscriptionService({
    WebSocketImpl: FakeWebSocket
  });
  const payloads = [];
  service.on('captionUpdate', (payload) => payloads.push(payload));
  await startReady(service, 'dg_test_key_partials');

  const themSocket = FakeWebSocket.instances.find((socket) => socket.options.role === DEEPGRAM_ROLE_THEM);

  themSocket.emit('message', JSON.stringify({
    channel: { alternatives: [{ transcript: 'First partial' }] },
    is_final: false
  }));
  const firstPartialId = payloads.at(-1).entries.find((entry) => !entry.isFinal).id;

  themSocket.emit('message', JSON.stringify({
    channel: { alternatives: [{ transcript: 'First partial continues' }] },
    is_final: false
  }));
  const updatedPartialId = payloads.at(-1).entries.find((entry) => !entry.isFinal).id;

  themSocket.emit('message', JSON.stringify({
    channel: { alternatives: [{ transcript: 'First final.' }] },
    is_final: true
  }));
  themSocket.emit('message', JSON.stringify({
    channel: { alternatives: [{ transcript: 'Next partial' }] },
    is_final: false
  }));
  const nextPartialId = payloads.at(-1).entries.find((entry) => !entry.isFinal).id;

  assert.equal(updatedPartialId, firstPartialId);
  assert.notEqual(nextPartialId, firstPartialId);
  assert.match(nextPartialId, /^deepgram-[0-9a-f-]{36}-them-partial-\d+$/);
});

test('Deepgram service preserves transcript and monotonic role counters across stop and resume', async () => {
  const {
    DeepgramTranscriptionService,
    DEEPGRAM_ROLE_THEM
  } = require('../src/deepgramTranscriptionService');

  FakeWebSocket.instances = [];
  const service = new DeepgramTranscriptionService({
    WebSocketImpl: FakeWebSocket
  });
  await startReady(service, 'dg_test_key_resume');

  const firstSocket = FakeWebSocket.instances.find((socket) => socket.options.role === DEEPGRAM_ROLE_THEM);
  firstSocket.emit('message', JSON.stringify({
    channel: { alternatives: [{ transcript: 'Before stop.' }] },
    is_final: true
  }));
  const firstEntry = service.getPayload().entries[0];

  await service.stop();
  await startReady(service, 'dg_test_key_resume');

  const resumedSocket = FakeWebSocket.instances
    .filter((socket) => socket.options.role === DEEPGRAM_ROLE_THEM)
    .at(-1);
  resumedSocket.emit('message', JSON.stringify({
    channel: { alternatives: [{ transcript: 'After resume.' }] },
    is_final: true
  }));

  const resumedEntries = service.getPayload().entries;
  assert.deepEqual(resumedEntries.map((entry) => entry.sourceText), [
    'Before stop.',
    'After resume.'
  ]);
  const firstMatch = firstEntry.id.match(/^deepgram-([0-9a-f-]{36})-them-(\d+)$/);
  const resumedMatch = resumedEntries[1].id.match(/^deepgram-([0-9a-f-]{36})-them-(\d+)$/);
  assert.ok(firstMatch);
  assert.ok(resumedMatch);
  assert.equal(resumedMatch[1], firstMatch[1]);
  assert.equal(Number(resumedMatch[2]), Number(firstMatch[2]) + 1);
});

test('Deepgram clear creates an isolated session with reset role counters and fresh sockets', async () => {
  const {
    DeepgramTranscriptionService,
    DEEPGRAM_ROLE_THEM
  } = require('../src/deepgramTranscriptionService');

  FakeWebSocket.instances = [];
  const service = new DeepgramTranscriptionService({
    WebSocketImpl: FakeWebSocket
  });
  await startReady(service, 'dg_test_key_clear');

  const oldSocket = FakeWebSocket.instances.find((socket) => socket.options.role === DEEPGRAM_ROLE_THEM);
  oldSocket.emit('message', JSON.stringify({
    channel: { alternatives: [{ transcript: 'Old session entry.' }] },
    is_final: true
  }));
  const oldEntryId = service.getPayload().entries[0].id;
  assert.equal(service.sendAudioChunk(DEEPGRAM_ROLE_THEM, Buffer.from([7, 7, 7])), true);

  const clearPromise = service.clear();
  openLatestRoleSockets();
  await clearPromise;

  assert.equal(service.getPayload().entries.length, 0);
  assert.equal(FakeWebSocket.instances.length, 4);
  const freshSocket = FakeWebSocket.instances
    .filter((socket) => socket.options.role === DEEPGRAM_ROLE_THEM)
    .at(-1);
  freshSocket.emit('message', JSON.stringify({
    channel: { alternatives: [{ transcript: 'Fresh session entry.' }] },
    is_final: true
  }));

  const freshEntryId = service.getPayload().entries[0].id;
  const oldMatch = oldEntryId.match(/^deepgram-([0-9a-f-]{36})-them-(\d+)$/);
  const freshMatch = freshEntryId.match(/^deepgram-([0-9a-f-]{36})-them-(\d+)$/);
  assert.ok(oldMatch);
  assert.ok(freshMatch);
  assert.notEqual(freshMatch[1], oldMatch[1]);
  assert.equal(freshMatch[2], '0');
  assert.equal(oldSocket.sent.at(-1), JSON.stringify({ type: 'CloseStream' }));
});

test('Deepgram clear ignores late messages from old-session sockets', async () => {
  const {
    DeepgramTranscriptionService,
    DEEPGRAM_ROLE_ME
  } = require('../src/deepgramTranscriptionService');

  FakeWebSocket.instances = [];
  const service = new DeepgramTranscriptionService({
    WebSocketImpl: FakeWebSocket
  });
  await startReady(service, 'dg_test_key_late');

  const oldSocket = FakeWebSocket.instances.find((socket) => socket.options.role === DEEPGRAM_ROLE_ME);
  const clearPromise = service.clear();
  openLatestRoleSockets();
  await clearPromise;
  oldSocket.emit('message', JSON.stringify({
    channel: { alternatives: [{ transcript: 'Late old-session result.' }] },
    is_final: true
  }));

  assert.deepEqual(service.getPayload().entries, []);
  assert.equal(service.getPayload().fullText, '');
});

test('Deepgram service sends audio chunks without waiting for response IPC', async () => {
  const {
    DeepgramTranscriptionService,
    DEEPGRAM_ROLE_ME
  } = require('../src/deepgramTranscriptionService');

  FakeWebSocket.instances = [];
  const service = new DeepgramTranscriptionService({
    WebSocketImpl: FakeWebSocket
  });
  await startReady(service, 'dg_test_key_audio');

  const meSocket = FakeWebSocket.instances.find((socket) => socket.options.role === DEEPGRAM_ROLE_ME);
  meSocket.open();
  service.sendAudioChunk(DEEPGRAM_ROLE_ME, Buffer.from([1, 2, 3]));

  assert.deepEqual(meSocket.sent, [Buffer.from([1, 2, 3])]);
});

test('Deepgram service buffers startup audio chunks until the socket opens', async () => {
  const {
    DeepgramTranscriptionService,
    DEEPGRAM_ROLE_THEM
  } = require('../src/deepgramTranscriptionService');

  FakeWebSocket.instances = [];
  const service = new DeepgramTranscriptionService({
    WebSocketImpl: FakeWebSocket
  });
  const startPromise = service.start({ apiKey: 'dg_test_key_buffer' });

  const themSocket = FakeWebSocket.instances.find((socket) => socket.options.role === DEEPGRAM_ROLE_THEM);
  const firstChunk = Buffer.from([9, 8, 7]);
  const secondChunk = Buffer.from([6, 5, 4]);

  assert.equal(service.sendAudioChunk(DEEPGRAM_ROLE_THEM, firstChunk), true);
  assert.equal(service.sendAudioChunk(DEEPGRAM_ROLE_THEM, secondChunk), true);
  assert.deepEqual(themSocket.sent, []);

  themSocket.open();
  FakeWebSocket.instances.find((socket) => socket.options.role === 'Me').open();
  await startPromise;

  assert.deepEqual(themSocket.sent, [firstChunk, secondChunk]);
});

test('Deepgram service retains only unsent buffered chunks when a startup flush fails', async () => {
  const {
    DeepgramTranscriptionService,
    DEEPGRAM_ROLE_ME,
    DEEPGRAM_ROLE_THEM
  } = require('../src/deepgramTranscriptionService');
  FakeWebSocket.instances = [];
  const service = new DeepgramTranscriptionService({
    WebSocketImpl: FakeWebSocket,
    retryDelaysMs: [2, 3, 4],
    openTimeoutMs: 30
  });
  const startPromise = service.start({ apiKey: 'dg_flush_retry' });
  const themSocket = FakeWebSocket.instances.find((socket) => socket.options.role === DEEPGRAM_ROLE_THEM);
  const meSocket = FakeWebSocket.instances.find((socket) => socket.options.role === DEEPGRAM_ROLE_ME);
  const firstChunk = Buffer.from([1]);
  const secondChunk = Buffer.from([2]);
  service.sendAudioChunk(DEEPGRAM_ROLE_THEM, firstChunk);
  service.sendAudioChunk(DEEPGRAM_ROLE_THEM, secondChunk);
  themSocket.throwOnSendCount = 2;
  meSocket.open();
  themSocket.open();

  await new Promise((resolve) => setTimeout(resolve, 4));
  const replacement = FakeWebSocket.instances
    .filter((socket) => socket.options.role === DEEPGRAM_ROLE_THEM)
    .at(-1);
  replacement.open();
  await startPromise;

  assert.deepEqual(themSocket.sent, [firstChunk]);
  assert.deepEqual(replacement.sent, [secondChunk]);
});

test('Deepgram service start resolves only after both roles open and exposes exact production timing defaults', async () => {
  const {
    DEEPGRAM_OPEN_TIMEOUT_MS,
    DEEPGRAM_RETRY_DELAYS_MS,
    DEEPGRAM_CLOSE_GRACE_MS,
    DeepgramTranscriptionService,
    DEEPGRAM_ROLE_ME,
    DEEPGRAM_ROLE_THEM
  } = require('../src/deepgramTranscriptionService');

  FakeWebSocket.instances = [];
  const service = new DeepgramTranscriptionService({ WebSocketImpl: FakeWebSocket });
  let resolved = false;
  const startPromise = service.start({ apiKey: 'dg_ready' }).then(() => {
    resolved = true;
  });
  const themSocket = FakeWebSocket.instances.find((socket) => socket.options.role === DEEPGRAM_ROLE_THEM);
  const meSocket = FakeWebSocket.instances.find((socket) => socket.options.role === DEEPGRAM_ROLE_ME);

  themSocket.open();
  await Promise.resolve();
  assert.equal(resolved, false);
  meSocket.open();
  await startPromise;

  assert.equal(resolved, true);
  assert.equal(DEEPGRAM_OPEN_TIMEOUT_MS, 10_000);
  assert.deepEqual(DEEPGRAM_RETRY_DELAYS_MS, [500, 1000, 2000]);
  assert.equal(DEEPGRAM_CLOSE_GRACE_MS, 1500);
});

test('Deepgram service reconnects only the failed role while its healthy peer continues and flushes buffered chunks', async () => {
  const {
    DeepgramTranscriptionService,
    DEEPGRAM_ROLE_ME,
    DEEPGRAM_ROLE_THEM
  } = require('../src/deepgramTranscriptionService');

  FakeWebSocket.instances = [];
  const service = new DeepgramTranscriptionService({
    WebSocketImpl: FakeWebSocket,
    retryDelaysMs: [5, 10, 20],
    openTimeoutMs: 50
  });
  const startPromise = service.start({ apiKey: 'dg_retry' });
  const originalThem = FakeWebSocket.instances.find((socket) => socket.options.role === DEEPGRAM_ROLE_THEM);
  const originalMe = FakeWebSocket.instances.find((socket) => socket.options.role === DEEPGRAM_ROLE_ME);
  originalThem.open();
  originalMe.open();
  await startPromise;

  originalThem.unexpectedClose();
  const buffered = Buffer.from([4, 5, 6]);
  const healthy = Buffer.from([1, 2, 3]);
  assert.equal(service.sendAudioChunk(DEEPGRAM_ROLE_THEM, buffered), true);
  assert.equal(service.sendAudioChunk(DEEPGRAM_ROLE_ME, healthy), true);
  assert.deepEqual(originalMe.sent, [healthy]);

  await new Promise((resolve) => setTimeout(resolve, 8));
  const replacementThem = FakeWebSocket.instances
    .filter((socket) => socket.options.role === DEEPGRAM_ROLE_THEM)
    .at(-1);
  assert.notEqual(replacementThem, originalThem);
  replacementThem.open();
  await Promise.resolve();

  assert.deepEqual(replacementThem.sent, [buffered]);
  assert.equal(service.sockets.get(DEEPGRAM_ROLE_ME), originalMe);
});

test('Deepgram service fails the whole capture closed when a failed role exceeds 16 buffered chunks', async () => {
  const {
    DeepgramTranscriptionService,
    DEEPGRAM_ROLE_ME,
    DEEPGRAM_ROLE_THEM
  } = require('../src/deepgramTranscriptionService');

  FakeWebSocket.instances = [];
  const service = new DeepgramTranscriptionService({
    WebSocketImpl: FakeWebSocket,
    retryDelaysMs: [50, 100, 200],
    closeGraceMs: 5
  });
  const fatalEvents = [];
  service.on('fatalError', (error, context) => fatalEvents.push({ error, context }));
  const startPromise = service.start({ apiKey: 'dg_overflow', revision: 73 });
  const themSocket = FakeWebSocket.instances.find((socket) => socket.options.role === DEEPGRAM_ROLE_THEM);
  const meSocket = FakeWebSocket.instances.find((socket) => socket.options.role === DEEPGRAM_ROLE_ME);
  themSocket.open();
  meSocket.open();
  await startPromise;

  themSocket.unexpectedClose();
  for (let index = 0; index < 16; index += 1) {
    assert.equal(service.sendAudioChunk(DEEPGRAM_ROLE_THEM, Buffer.from([index])), true);
  }
  assert.equal(service.sendAudioChunk(DEEPGRAM_ROLE_THEM, Buffer.from([16])), false);
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(service.active, false);
  assert.equal(meSocket.closed, true);
  assert.equal(fatalEvents.length, 1);
  assert.equal(fatalEvents[0].error.message, 'Deepgram Them audio buffer overflowed.');
  assert.equal(fatalEvents[0].context.revision, 73);
  assert.equal(Number.isInteger(fatalEvents[0].context.generation), true);
});

test('Deepgram service exhausts three delayed retries after per-attempt open timeouts and fails start closed', async () => {
  const {
    DeepgramTranscriptionService,
    DEEPGRAM_ROLE_ME,
    DEEPGRAM_ROLE_THEM
  } = require('../src/deepgramTranscriptionService');

  FakeWebSocket.instances = [];
  const service = new DeepgramTranscriptionService({
    WebSocketImpl: FakeWebSocket,
    retryDelaysMs: [2, 3, 4],
    openTimeoutMs: 3,
    closeGraceMs: 2
  });
  const fatalEvents = [];
  service.on('fatalError', (error, context) => fatalEvents.push({ error, context }));
  const startPromise = service.start({ apiKey: 'dg_exhaust', revision: 81 });
  FakeWebSocket.instances.find((socket) => socket.options.role === DEEPGRAM_ROLE_ME).open();

  await assert.rejects(startPromise, /failed after 3 retries/i);

  assert.equal(
    FakeWebSocket.instances.filter((socket) => socket.options.role === DEEPGRAM_ROLE_THEM).length,
    4
  );
  assert.equal(service.active, false);
  assert.equal(fatalEvents.length, 1);
  assert.match(fatalEvents[0].error.message, /failed after 3 retries/i);
  assert.equal(fatalEvents[0].context.revision, 81);
  assert.equal(Number.isInteger(fatalEvents[0].context.generation), true);
});

test('Deepgram service graceful stop accepts final messages then force-closes after 1500 ms production grace', async () => {
  const {
    DeepgramTranscriptionService,
    DEEPGRAM_ROLE_ME,
    DEEPGRAM_ROLE_THEM
  } = require('../src/deepgramTranscriptionService');

  FakeWebSocket.instances = [];
  const service = new DeepgramTranscriptionService({
    WebSocketImpl: FakeWebSocket,
    closeGraceMs: 15
  });
  const startPromise = service.start({ apiKey: 'dg_stop' });
  const themSocket = FakeWebSocket.instances.find((socket) => socket.options.role === DEEPGRAM_ROLE_THEM);
  const meSocket = FakeWebSocket.instances.find((socket) => socket.options.role === DEEPGRAM_ROLE_ME);
  themSocket.open();
  meSocket.open();
  await startPromise;
  themSocket.autoCloseOnClient = false;
  meSocket.autoCloseOnClient = false;
  themSocket.autoServerCloseOnCloseStream = false;
  meSocket.autoServerCloseOnCloseStream = false;

  const stopPromise = service.stop();
  themSocket.emit('message', JSON.stringify({
    channel: { alternatives: [{ transcript: 'Final during drain.' }] },
    is_final: true
  }));
  themSocket.serverClose();
  await stopPromise;

  assert.deepEqual(themSocket.sent, [JSON.stringify({ type: 'CloseStream' })]);
  assert.deepEqual(meSocket.sent, [JSON.stringify({ type: 'CloseStream' })]);
  assert.equal(meSocket.clientCloseCount, 1);
  assert.deepEqual(service.getPayload().entries.map((entry) => entry.sourceText), ['Final during drain.']);
});

test('Deepgram service cancels the grace timer when every server closes promptly', async () => {
  const { DeepgramTranscriptionService } = require('../src/deepgramTranscriptionService');
  const scheduledTimers = new Set();
  const setTimeoutFn = (callback, delayMs) => {
    const timer = { callback, delayMs };
    scheduledTimers.add(timer);
    return timer;
  };
  const clearTimeoutFn = (timer) => scheduledTimers.delete(timer);

  FakeWebSocket.instances = [];
  const service = new DeepgramTranscriptionService({
    WebSocketImpl: FakeWebSocket,
    setTimeoutFn,
    clearTimeoutFn
  });
  const startPromise = service.start({ apiKey: 'dg_timer_cleanup' });
  openLatestRoleSockets();
  await startPromise;
  await service.stop();

  assert.equal(scheduledTimers.size, 0);
});

test('Deepgram API-key rotation replaces both sockets without changing session entries or counters', async () => {
  const {
    DeepgramTranscriptionService,
    DEEPGRAM_ROLE_ME,
    DEEPGRAM_ROLE_THEM
  } = require('../src/deepgramTranscriptionService');

  FakeWebSocket.instances = [];
  const service = new DeepgramTranscriptionService({ WebSocketImpl: FakeWebSocket });
  const startPromise = service.start({ apiKey: 'dg_old_key' });
  const oldThem = FakeWebSocket.instances.find((socket) => socket.options.role === DEEPGRAM_ROLE_THEM);
  const oldMe = FakeWebSocket.instances.find((socket) => socket.options.role === DEEPGRAM_ROLE_ME);
  oldThem.open();
  oldMe.open();
  await startPromise;
  oldThem.emit('message', JSON.stringify({
    channel: { alternatives: [{ transcript: 'Before rotation.' }] },
    is_final: true
  }));
  const firstId = service.getPayload().entries[0].id;

  const rotationPromise = service.rotateApiKey({ apiKey: 'dg_new_key' });
  const newThem = FakeWebSocket.instances.filter((socket) => socket.options.role === DEEPGRAM_ROLE_THEM).at(-1);
  const newMe = FakeWebSocket.instances.filter((socket) => socket.options.role === DEEPGRAM_ROLE_ME).at(-1);
  newThem.open();
  newMe.open();
  await rotationPromise;
  newThem.emit('message', JSON.stringify({
    channel: { alternatives: [{ transcript: 'After rotation.' }] },
    is_final: true
  }));

  const entries = service.getPayload().entries;
  const firstMatch = firstId.match(/^deepgram-([0-9a-f-]{36})-them-(\d+)$/);
  const secondMatch = entries[1].id.match(/^deepgram-([0-9a-f-]{36})-them-(\d+)$/);
  assert.equal(entries.length, 2);
  assert.equal(secondMatch[1], firstMatch[1]);
  assert.equal(Number(secondMatch[2]), Number(firstMatch[2]) + 1);
  assert.deepEqual(
    [newThem, newMe].map((socket) => socket.options.headers.Authorization),
    ['Token dg_new_key', 'Token dg_new_key']
  );
  assert.equal(typeof service.finalize, 'undefined');
});

test('Deepgram service aborts an in-flight start with typed supersession and closes its connecting sockets', async () => {
  const {
    DeepgramTranscriptionService,
    DEEPGRAM_OPERATION_SUPERSEDED
  } = require('../src/deepgramTranscriptionService');

  FakeWebSocket.instances = [];
  const service = new DeepgramTranscriptionService({
    WebSocketImpl: FakeWebSocket,
    openTimeoutMs: 3,
    retryDelaysMs: [],
    closeGraceMs: 2
  });
  const fatalErrors = [];
  service.on('fatalError', (error) => fatalErrors.push(error));
  const controller = new AbortController();
  const startPromise = service.start({
    apiKey: 'dg_abort_start',
    signal: controller.signal,
    revision: 101
  });
  const connectingSockets = [...FakeWebSocket.instances];

  controller.abort();

  assert.equal(DEEPGRAM_OPERATION_SUPERSEDED, 'DEEPGRAM_OPERATION_SUPERSEDED');
  await assert.rejects(startPromise, (error) => (
    error?.code === 'DEEPGRAM_OPERATION_SUPERSEDED'
  ));
  assert.equal(connectingSockets.length, 2);
  assert.equal(connectingSockets.every((socket) => socket.closed), true);
  assert.equal(service.sockets.size, 0);
  assert.deepEqual(fatalErrors, []);

  for (const socket of connectingSockets) {
    socket.emit('error', new Error('late start socket failure'));
  }
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(fatalErrors, []);
});

test('Deepgram service aborts an intermediate rotation and converges both roles on a valid latest key', async () => {
  const {
    DeepgramTranscriptionService,
    DEEPGRAM_OPERATION_SUPERSEDED
  } = require('../src/deepgramTranscriptionService');

  FakeWebSocket.instances = [];
  const service = new DeepgramTranscriptionService({
    WebSocketImpl: FakeWebSocket,
    openTimeoutMs: 3,
    retryDelaysMs: [],
    closeGraceMs: 2
  });
  const fatalErrors = [];
  service.on('fatalError', (error) => fatalErrors.push(error));
  await startReady(service, 'dg_initial_rotation');

  const controller = new AbortController();
  const intermediatePromise = service.rotateApiKey({
    apiKey: 'dg_invalid_intermediate',
    signal: controller.signal,
    revision: 202
  });
  const intermediateSockets = FakeWebSocket.instances.filter((socket) => (
    socket.options.headers.Authorization === 'Token dg_invalid_intermediate'
  ));
  controller.abort();

  assert.equal(DEEPGRAM_OPERATION_SUPERSEDED, 'DEEPGRAM_OPERATION_SUPERSEDED');
  await assert.rejects(intermediatePromise, (error) => (
    error?.code === 'DEEPGRAM_OPERATION_SUPERSEDED'
  ));
  assert.equal(intermediateSockets.length, 2);
  assert.equal(intermediateSockets.every((socket) => socket.closed), true);

  const latestPromise = service.rotateApiKey({
    apiKey: 'dg_valid_latest',
    revision: 203
  });
  openLatestRoleSockets();
  await latestPromise;

  assert.deepEqual(
    [...service.sockets.values()].map((socket) => socket.options.headers.Authorization),
    ['Token dg_valid_latest', 'Token dg_valid_latest']
  );
  assert.deepEqual(fatalErrors, []);
});

test('Deepgram service aborts an in-flight clear without fatal error and closes replacement sockets', async () => {
  const {
    DeepgramTranscriptionService,
    DEEPGRAM_OPERATION_SUPERSEDED
  } = require('../src/deepgramTranscriptionService');

  FakeWebSocket.instances = [];
  const service = new DeepgramTranscriptionService({
    WebSocketImpl: FakeWebSocket,
    openTimeoutMs: 3,
    retryDelaysMs: [],
    closeGraceMs: 2
  });
  const fatalErrors = [];
  service.on('fatalError', (error) => fatalErrors.push(error));
  await startReady(service, 'dg_clear_abort');
  const controller = new AbortController();

  const clearPromise = service.clear({ signal: controller.signal, revision: 302 });
  const replacementSockets = FakeWebSocket.instances.filter((socket) => (
    socket.readyState === FakeWebSocket.CONNECTING
  ));
  controller.abort();

  assert.equal(DEEPGRAM_OPERATION_SUPERSEDED, 'DEEPGRAM_OPERATION_SUPERSEDED');
  await assert.rejects(clearPromise, (error) => (
    error?.code === 'DEEPGRAM_OPERATION_SUPERSEDED'
  ));
  assert.equal(replacementSockets.length, 2);
  assert.equal(replacementSockets.every((socket) => socket.closed), true);
  assert.equal(service.sockets.size, 0);
  assert.deepEqual(fatalErrors, []);
});

test('Deepgram service stop invalidates an in-flight connection before late callbacks and never emits fatal error', async () => {
  const { DeepgramTranscriptionService } = require('../src/deepgramTranscriptionService');

  FakeWebSocket.instances = [];
  const service = new DeepgramTranscriptionService({
    WebSocketImpl: FakeWebSocket,
    closeGraceMs: 2
  });
  const fatalErrors = [];
  service.on('fatalError', (error) => fatalErrors.push(error));
  const startPromise = service.start({ apiKey: 'dg_stop_connect', revision: 401 });
  const connectingSockets = [...FakeWebSocket.instances];
  const generationBeforeStop = service.operationId;

  const stopPromise = service.stop();
  assert.ok(service.operationId > generationBeforeStop);
  await assert.rejects(startPromise, /stopped/i);
  await stopPromise;

  for (const socket of connectingSockets) {
    socket.emit('error', new Error('late stopped socket failure'));
  }
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(connectingSockets.every((socket) => socket.closed), true);
  assert.deepEqual(fatalErrors, []);
});

test('Deepgram service fails a current malformed protocol message closed with its originating revision', async () => {
  const {
    DeepgramTranscriptionService,
    DEEPGRAM_ROLE_THEM
  } = require('../src/deepgramTranscriptionService');

  FakeWebSocket.instances = [];
  const service = new DeepgramTranscriptionService({
    WebSocketImpl: FakeWebSocket,
    closeGraceMs: 2
  });
  const fatalEvents = [];
  service.on('fatalError', (error, context) => fatalEvents.push({ error, context }));
  const startPromise = service.start({ apiKey: 'dg_protocol', revision: 501 });
  openLatestRoleSockets();
  await startPromise;

  service.sockets.get(DEEPGRAM_ROLE_THEM).emit('message', '{invalid-json');
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(service.active, false);
  assert.equal(fatalEvents.length, 1);
  assert.match(fatalEvents[0].error.message, /json/i);
  assert.equal(fatalEvents[0].context.revision, 501);
  assert.equal(Number.isInteger(fatalEvents[0].context.generation), true);
});

test('a current failure still fails closed while an older generation fatal event is pending', async () => {
  const {
    DeepgramTranscriptionService,
    DEEPGRAM_ROLE_THEM
  } = require('../src/deepgramTranscriptionService');

  FakeWebSocket.instances = [];
  const service = new DeepgramTranscriptionService({
    WebSocketImpl: FakeWebSocket,
    closeGraceMs: 2
  });
  const fatalEvents = [];
  service.on('fatalError', (error, context) => fatalEvents.push({ error, context }));
  const firstStart = service.start({ apiKey: 'dg_old_fatal', revision: 601 });
  openLatestRoleSockets();
  await firstStart;
  const oldGeneration = service.operationId;

  const oldFatal = service.failClosed(new Error('old generation failed'), {
    revision: 601,
    generation: oldGeneration
  });
  const latestStart = service.start({ apiKey: 'dg_latest_fatal', revision: 602 });
  openLatestRoleSockets();
  service.sockets.get(DEEPGRAM_ROLE_THEM).emit('message', '{latest-invalid-json');

  await assert.rejects(latestStart, /invalid deepgram json/i);
  await oldFatal;
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(service.active, false);
  assert.deepEqual(
    fatalEvents.map((event) => event.context.revision),
    [601, 602]
  );
});
