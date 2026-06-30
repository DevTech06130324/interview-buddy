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
    this.sent.push(chunk);
  }

  close() {
    this.closed = true;
    this.readyState = FakeWebSocket.CLOSED;
    this.emit('close');
  }
}

FakeWebSocket.CONNECTING = 0;
FakeWebSocket.OPEN = 1;
FakeWebSocket.CLOSED = 3;

test('Deepgram service opens one authorized stream per speaker role', () => {
  const {
    DeepgramTranscriptionService,
    DEEPGRAM_ROLE_THEM,
    DEEPGRAM_ROLE_ME
  } = require('../src/deepgramTranscriptionService');

  FakeWebSocket.instances = [];
  const service = new DeepgramTranscriptionService({
    WebSocketImpl: FakeWebSocket,
    now: () => 12000
  });

  service.start({ apiKey: 'dg_test_key_123456' });

  assert.equal(FakeWebSocket.instances.length, 2);
  assert.ok(FakeWebSocket.instances.every((socket) => socket.url.startsWith('wss://api.deepgram.com/v1/listen?')));
  assert.deepEqual(
    FakeWebSocket.instances.map((socket) => socket.options.headers.Authorization),
    ['Token dg_test_key_123456', 'Token dg_test_key_123456']
  );
  assert.deepEqual(
    FakeWebSocket.instances.map((socket) => socket.options.role).sort(),
    [DEEPGRAM_ROLE_ME, DEEPGRAM_ROLE_THEM].sort()
  );
});

test('Deepgram service emits ordered Them and Me transcript entries', () => {
  const {
    DeepgramTranscriptionService,
    DEEPGRAM_ROLE_ME,
    DEEPGRAM_ROLE_THEM
  } = require('../src/deepgramTranscriptionService');

  FakeWebSocket.instances = [];
  let clock = 1000;
  const service = new DeepgramTranscriptionService({
    WebSocketImpl: FakeWebSocket,
    now: () => {
      clock += 1000;
      return clock;
    }
  });
  const payloads = [];
  service.on('captionUpdate', (payload) => payloads.push(payload));
  service.start({ apiKey: 'dg_test_key_abcdef' });

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
  assert.ok(latestPayload.payloadVersion >= 2);
});

test('Deepgram service sends audio chunks without waiting for response IPC', () => {
  const {
    DeepgramTranscriptionService,
    DEEPGRAM_ROLE_ME
  } = require('../src/deepgramTranscriptionService');

  FakeWebSocket.instances = [];
  const service = new DeepgramTranscriptionService({
    WebSocketImpl: FakeWebSocket
  });
  service.start({ apiKey: 'dg_test_key_audio' });

  const meSocket = FakeWebSocket.instances.find((socket) => socket.options.role === DEEPGRAM_ROLE_ME);
  meSocket.open();
  service.sendAudioChunk(DEEPGRAM_ROLE_ME, Buffer.from([1, 2, 3]));

  assert.deepEqual(meSocket.sent, [Buffer.from([1, 2, 3])]);
});
