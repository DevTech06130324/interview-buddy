const test = require('node:test');
const assert = require('node:assert/strict');

const {
  DEEPGRAM_RECORDER_DRAIN_TIMEOUT_MS,
  DeepgramCaptureController
} = require('../src/deepgramCaptureController');

class FakeTrack {
  constructor(kind) {
    this.kind = kind;
    this.stopCount = 0;
    this.listeners = new Map();
  }

  addEventListener(eventName, listener) {
    this.listeners.set(eventName, listener);
  }

  stop() {
    this.stopCount += 1;
  }

  end() {
    this.listeners.get('ended')?.();
  }
}

class FakeStream {
  constructor(tracks) {
    this.tracks = [...tracks];
  }

  getTracks() {
    return [...this.tracks];
  }

  getAudioTracks() {
    return this.tracks.filter((track) => track.kind === 'audio');
  }

  getVideoTracks() {
    return this.tracks.filter((track) => track.kind === 'video');
  }
}

class FakeRecorder {
  static instances = [];

  constructor(stream) {
    this.stream = stream;
    this.state = 'inactive';
    this.listeners = new Map();
    this.emitStop = true;
    FakeRecorder.instances.push(this);
  }

  addEventListener(eventName, listener, options = {}) {
    if (!this.listeners.has(eventName)) {
      this.listeners.set(eventName, []);
    }
    this.listeners.get(eventName).push({ listener, once: Boolean(options.once) });
  }

  emit(eventName, payload = {}) {
    const listeners = this.listeners.get(eventName) || [];
    this.listeners.set(eventName, listeners.filter(({ once }) => !once));
    for (const { listener } of listeners) {
      listener(payload);
    }
  }

  start(timeslice) {
    this.timeslice = timeslice;
    this.state = 'recording';
  }

  stop() {
    this.state = 'inactive';
    this.emit('dataavailable', {
      data: {
        size: 3,
        arrayBuffer: async () => Uint8Array.from([7, 8, 9]).buffer
      }
    });
    if (this.emitStop) {
      this.emit('stop');
    }
  }
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

function createController({
  displayStream,
  microphoneStream,
  getUserMedia,
  onFailure = () => {},
  recorderDrainTimeoutMs
} = {}) {
  const sentChunks = [];
  const controller = new DeepgramCaptureController({
    mediaDevices: {
      getDisplayMedia: async () => displayStream,
      getUserMedia: getUserMedia || (async () => microphoneStream)
    },
    MediaRecorderImpl: FakeRecorder,
    MediaStreamImpl: FakeStream,
    sendAudioChunk: async (role, chunk) => {
      sentChunks.push({ role, chunk: Buffer.from(chunk) });
    },
    onFailure,
    recorderDrainTimeoutMs
  });
  return { controller, sentChunks };
}

test('capture controller owns acquired tracks and releases each unique track once after partial startup failure', async () => {
  const displayAudio = new FakeTrack('audio');
  const displayVideo = new FakeTrack('video');
  const displayStream = new FakeStream([displayAudio, displayVideo]);
  const { controller } = createController({
    displayStream,
    getUserMedia: async () => {
      throw new Error('microphone denied');
    }
  });

  await assert.rejects(controller.start(), /microphone denied/);

  assert.equal(displayAudio.stopCount, 1);
  assert.equal(displayVideo.stopCount, 1);
  assert.equal(controller.isActive(), false);
});

test('capture controller stops display video immediately and drains final recorder chunks before releasing audio tracks', async () => {
  FakeRecorder.instances = [];
  const displayAudio = new FakeTrack('audio');
  const displayVideo = new FakeTrack('video');
  const microphoneAudio = new FakeTrack('audio');
  const { controller, sentChunks } = createController({
    displayStream: new FakeStream([displayAudio, displayVideo]),
    microphoneStream: new FakeStream([microphoneAudio])
  });

  assert.equal(await controller.start(), true);
  assert.equal(displayVideo.stopCount, 1);
  assert.equal(displayAudio.stopCount, 0);
  assert.equal(microphoneAudio.stopCount, 0);

  await controller.stop();

  assert.equal(displayVideo.stopCount, 1);
  assert.equal(displayAudio.stopCount, 1);
  assert.equal(microphoneAudio.stopCount, 1);
  assert.equal(sentChunks.length, 2);
  assert.deepEqual(sentChunks.map(({ chunk }) => chunk), [
    Buffer.from([7, 8, 9]),
    Buffer.from([7, 8, 9])
  ]);
});

test('capture controller bounds recorder drain wait and then releases tracks', async () => {
  FakeRecorder.instances = [];
  const displayAudio = new FakeTrack('audio');
  const microphoneAudio = new FakeTrack('audio');
  const { controller } = createController({
    displayStream: new FakeStream([displayAudio]),
    microphoneStream: new FakeStream([microphoneAudio]),
    recorderDrainTimeoutMs: 15
  });

  await controller.start();
  for (const recorder of FakeRecorder.instances) {
    recorder.emitStop = false;
  }

  await controller.stop();

  assert.equal(DEEPGRAM_RECORDER_DRAIN_TIMEOUT_MS, 1000);
  assert.equal(displayAudio.stopCount, 1);
  assert.equal(microphoneAudio.stopCount, 1);
});

test('capture controller releases a late stream acquired after cancellation', async () => {
  const microphoneRequest = deferred();
  const displayAudio = new FakeTrack('audio');
  const microphoneAudio = new FakeTrack('audio');
  const { controller } = createController({
    displayStream: new FakeStream([displayAudio]),
    getUserMedia: () => microphoneRequest.promise
  });

  const startPromise = controller.start();
  await Promise.resolve();
  await controller.stop();
  microphoneRequest.resolve(new FakeStream([microphoneAudio]));

  assert.equal(await startPromise, false);
  assert.equal(displayAudio.stopCount, 1);
  assert.equal(microphoneAudio.stopCount, 1);
});

test('recorder failure closes capture and reports the failure once', async () => {
  FakeRecorder.instances = [];
  const failures = [];
  const displayAudio = new FakeTrack('audio');
  const microphoneAudio = new FakeTrack('audio');
  const { controller } = createController({
    displayStream: new FakeStream([displayAudio]),
    microphoneStream: new FakeStream([microphoneAudio]),
    onFailure: (error) => failures.push(error.message)
  });

  await controller.start();
  FakeRecorder.instances[0].emit('error', { error: new Error('recorder failed') });
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(failures, ['recorder failed']);
  assert.equal(controller.isActive(), false);
  assert.equal(displayAudio.stopCount, 1);
  assert.equal(microphoneAudio.stopCount, 1);
});

test('ended audio tracks fail capture closed instead of leaving main active with dead media', async () => {
  FakeRecorder.instances = [];
  const failures = [];
  const displayAudio = new FakeTrack('audio');
  const microphoneAudio = new FakeTrack('audio');
  const { controller } = createController({
    displayStream: new FakeStream([displayAudio]),
    microphoneStream: new FakeStream([microphoneAudio]),
    onFailure: (error) => failures.push(error.message)
  });

  await controller.start();
  microphoneAudio.end();
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(failures, ['Deepgram audio track ended unexpectedly.']);
  assert.equal(controller.isActive(), false);
  assert.equal(displayAudio.stopCount, 1);
  assert.equal(microphoneAudio.stopCount, 1);
});

test('late recorder events after bounded drain cannot send old audio or fail a later lifecycle', async () => {
  FakeRecorder.instances = [];
  const failures = [];
  const { controller, sentChunks } = createController({
    displayStream: new FakeStream([new FakeTrack('audio')]),
    microphoneStream: new FakeStream([new FakeTrack('audio')]),
    recorderDrainTimeoutMs: 5,
    onFailure: (error) => failures.push(error.message)
  });
  await controller.start();
  const oldRecorder = FakeRecorder.instances[0];
  for (const recorder of FakeRecorder.instances) {
    recorder.emitStop = false;
  }
  await controller.stop();
  const chunksAfterStop = sentChunks.length;

  oldRecorder.emit('dataavailable', {
    data: {
      size: 1,
      arrayBuffer: async () => Uint8Array.from([99]).buffer
    }
  });
  oldRecorder.emit('error', { error: new Error('late old recorder error') });
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(sentChunks.length, chunksAfterStop);
  assert.deepEqual(failures, []);
});

test('blob conversion resolving after drain timeout cannot send stale audio', async () => {
  FakeRecorder.instances = [];
  const blobConversion = deferred();
  const { controller, sentChunks } = createController({
    displayStream: new FakeStream([new FakeTrack('audio')]),
    microphoneStream: new FakeStream([new FakeTrack('audio')]),
    recorderDrainTimeoutMs: 5
  });
  await controller.start();
  FakeRecorder.instances[0].emit('dataavailable', {
    data: {
      size: 1,
      arrayBuffer: () => blobConversion.promise
    }
  });
  for (const recorder of FakeRecorder.instances) {
    recorder.emitStop = false;
  }

  await controller.stop();
  const chunksAfterStop = sentChunks.length;
  blobConversion.resolve(Uint8Array.from([42]).buffer);
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(sentChunks.length, chunksAfterStop);
});
