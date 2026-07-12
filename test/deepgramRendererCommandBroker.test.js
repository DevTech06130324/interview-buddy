const test = require('node:test');
const assert = require('node:assert/strict');

const {
  DEEPGRAM_RENDERER_START_ACK_TIMEOUT_MS,
  DEEPGRAM_RENDERER_STOP_ACK_TIMEOUT_MS,
  DeepgramRendererCommandBroker
} = require('../src/deepgramRendererCommandBroker');

function createFakeTimers() {
  const timers = new Set();
  return {
    timers,
    setTimeoutFn(callback, delayMs) {
      const timer = { callback, delayMs };
      timers.add(timer);
      return timer;
    },
    clearTimeoutFn(timer) {
      timers.delete(timer);
    }
  };
}

test('renderer command broker times out a missing acknowledgement and removes pending state', async () => {
  const fakeTimers = createFakeTimers();
  const sent = [];
  const broker = new DeepgramRendererCommandBroker({
    sendCommand: (command) => sent.push(command),
    createRequestId: () => 'request-timeout',
    startAckTimeoutMs: 25,
    setTimeoutFn: fakeTimers.setTimeoutFn,
    clearTimeoutFn: fakeTimers.clearTimeoutFn
  });

  const resultPromise = broker.request('start', { operationId: 7 });
  assert.equal(broker.pendingCount(), 1);
  assert.equal(fakeTimers.timers.size, 1);
  assert.deepEqual(sent, [{ requestId: '7:request-timeout', action: 'start' }]);
  [...fakeTimers.timers][0].callback();

  assert.equal(await resultPromise, false);
  assert.equal(broker.pendingCount(), 0);
  assert.equal(fakeTimers.timers.size, 0);
  assert.equal(DEEPGRAM_RENDERER_START_ACK_TIMEOUT_MS, 30_000);
  assert.equal(DEEPGRAM_RENDERER_STOP_ACK_TIMEOUT_MS, 1500);
});

test('renderer command broker cancels every pending command when the renderer is lost', async () => {
  const fakeTimers = createFakeTimers();
  let nextId = 0;
  const broker = new DeepgramRendererCommandBroker({
    sendCommand: () => {},
    createRequestId: () => String(nextId++),
    setTimeoutFn: fakeTimers.setTimeoutFn,
    clearTimeoutFn: fakeTimers.clearTimeoutFn
  });
  const startResult = broker.request('start', { operationId: 1 });
  const stopResult = broker.request('stop', { operationId: 2 });

  broker.cancelAll();

  assert.deepEqual(await Promise.all([startResult, stopResult]), [false, false]);
  assert.equal(broker.pendingCount(), 0);
  assert.equal(fakeTimers.timers.size, 0);
});

test('renderer command broker accepts only the matching action and request ID once', async () => {
  const fakeTimers = createFakeTimers();
  const broker = new DeepgramRendererCommandBroker({
    sendCommand: () => {},
    createRequestId: () => 'ack',
    setTimeoutFn: fakeTimers.setTimeoutFn,
    clearTimeoutFn: fakeTimers.clearTimeoutFn
  });
  const resultPromise = broker.request('start', { operationId: 3 });

  assert.equal(broker.acknowledge({ requestId: '3:ack', action: 'stop', success: true }), false);
  assert.equal(broker.acknowledge({ requestId: '3:ack', action: 'start', success: true }), true);
  assert.equal(broker.acknowledge({ requestId: '3:ack', action: 'start', success: true }), false);
  assert.equal(await resultPromise, true);
  assert.equal(fakeTimers.timers.size, 0);
});
