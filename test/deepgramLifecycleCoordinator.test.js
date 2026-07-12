const test = require('node:test');
const assert = require('node:assert/strict');

const {
  DeepgramLifecycleCoordinator
} = require('../src/deepgramLifecycleCoordinator');

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

test('lifecycle reports active only after backend readiness and renderer capture acknowledgement', async () => {
  const backendReady = deferred();
  const rendererReady = deferred();
  const states = [];
  const coordinator = new DeepgramLifecycleCoordinator({
    service: {
      start: () => backendReady.promise,
      stop: async () => {}
    },
    requestRendererStart: () => rendererReady.promise,
    requestRendererStop: async () => true,
    onState: (state) => states.push(state)
  });

  const startPromise = coordinator.start({ apiKey: 'dg_transaction' });
  assert.equal(coordinator.getState().active, false);
  assert.equal(coordinator.getState().phase, 'connecting');
  backendReady.resolve(true);
  await Promise.resolve();
  assert.equal(coordinator.getState().active, false);
  assert.equal(coordinator.getState().phase, 'awaiting-renderer');
  rendererReady.resolve(true);

  const finalState = await startPromise;
  assert.equal(finalState.active, true);
  assert.equal(finalState.phase, 'active');
  assert.equal(states.some((state) => state.active && state.phase !== 'active'), false);
});

test('lifecycle tears down renderer resources and backend after failed renderer startup', async () => {
  const calls = [];
  const coordinator = new DeepgramLifecycleCoordinator({
    service: {
      start: async () => {
        calls.push('backend-start');
      },
      stop: async () => {
        calls.push('backend-stop');
      }
    },
    requestRendererStart: async () => {
      calls.push('renderer-start');
      return false;
    },
    requestRendererStop: async () => {
      calls.push('renderer-stop');
      return true;
    }
  });

  const state = await coordinator.start({ apiKey: 'dg_capture_fail' });

  assert.deepEqual(calls, [
    'backend-start',
    'renderer-start',
    'renderer-stop',
    'backend-stop'
  ]);
  assert.equal(state.active, false);
  assert.equal(state.phase, 'inactive');
  assert.equal(state.reason, 'renderer-start-failed');
});

test('lifecycle stop drains renderer recorders before closing backend sockets', async () => {
  const calls = [];
  const coordinator = new DeepgramLifecycleCoordinator({
    service: {
      start: async () => calls.push('backend-start'),
      stop: async () => calls.push('backend-stop')
    },
    requestRendererStart: async () => {
      calls.push('renderer-start');
      return true;
    },
    requestRendererStop: async () => {
      calls.push('renderer-stop');
      return true;
    }
  });
  await coordinator.start({ apiKey: 'dg_stop_order' });
  calls.length = 0;

  const state = await coordinator.stop({ reason: 'manual-stop' });

  assert.deepEqual(calls, ['renderer-stop', 'backend-stop']);
  assert.equal(state.active, false);
  assert.equal(state.phase, 'inactive');
  assert.equal(state.reason, 'manual-stop');
});

test('lifecycle key rotation preserves active renderer capture while both backend roles reconnect', async () => {
  const calls = [];
  const coordinator = new DeepgramLifecycleCoordinator({
    service: {
      start: async () => calls.push('backend-start'),
      stop: async () => calls.push('backend-stop'),
      rotateApiKey: async ({ apiKey }) => calls.push(`rotate:${apiKey}`)
    },
    requestRendererStart: async () => {
      calls.push('renderer-start');
      return true;
    },
    requestRendererStop: async () => {
      calls.push('renderer-stop');
      return true;
    }
  });
  await coordinator.start({ apiKey: 'dg_old' });
  calls.length = 0;

  const state = await coordinator.rotateApiKey({ apiKey: 'dg_new' });

  assert.deepEqual(calls, ['rotate:dg_new']);
  assert.equal(state.active, true);
  assert.equal(state.phase, 'active');
});

test('lifecycle rejects a late renderer start acknowledgement after stop cancellation', async () => {
  const rendererReady = deferred();
  const calls = [];
  const coordinator = new DeepgramLifecycleCoordinator({
    service: {
      start: async () => calls.push('backend-start'),
      stop: async () => calls.push('backend-stop')
    },
    requestRendererStart: () => rendererReady.promise,
    requestRendererStop: async () => {
      calls.push('renderer-stop');
      return true;
    }
  });

  const startPromise = coordinator.start({ apiKey: 'dg_cancel' });
  await Promise.resolve();
  const stopPromise = coordinator.stop({ reason: 'cancelled' });
  rendererReady.resolve(true);
  await Promise.all([startPromise, stopPromise]);

  assert.equal(coordinator.getState().active, false);
  assert.equal(coordinator.getState().reason, 'cancelled');
  assert.deepEqual(calls, ['backend-start', 'renderer-stop', 'backend-stop']);
});

test('lifecycle waits for an in-flight stop before starting a new transaction', async () => {
  const backendStop = deferred();
  const calls = [];
  const coordinator = new DeepgramLifecycleCoordinator({
    service: {
      start: async ({ apiKey }) => calls.push(`backend-start:${apiKey}`),
      stop: async () => {
        calls.push('backend-stop');
        await backendStop.promise;
      }
    },
    requestRendererStart: async () => {
      calls.push('renderer-start');
      return true;
    },
    requestRendererStop: async () => {
      calls.push('renderer-stop');
      return true;
    }
  });
  await coordinator.start({ apiKey: 'dg_first' });
  const stopPromise = coordinator.stop({ reason: 'replace' });
  const restartPromise = coordinator.start({ apiKey: 'dg_second' });
  await Promise.resolve();

  assert.deepEqual(calls, [
    'backend-start:dg_first',
    'renderer-start',
    'renderer-stop',
    'backend-stop'
  ]);
  backendStop.resolve();
  await Promise.all([stopPromise, restartPromise]);

  assert.deepEqual(calls, [
    'backend-start:dg_first',
    'renderer-start',
    'renderer-stop',
    'backend-stop',
    'backend-start:dg_second',
    'renderer-start'
  ]);
  assert.equal(coordinator.getState().active, true);
});

test('lifecycle serializes overlapping API-key rotations without stopping renderer capture', async () => {
  const firstRotation = deferred();
  const calls = [];
  const coordinator = new DeepgramLifecycleCoordinator({
    service: {
      start: async () => {},
      stop: async () => calls.push('backend-stop'),
      rotateApiKey: async ({ apiKey }) => {
        calls.push(`rotate:${apiKey}`);
        if (apiKey === 'dg_second') {
          await firstRotation.promise;
        }
      }
    },
    requestRendererStart: async () => true,
    requestRendererStop: async () => {
      calls.push('renderer-stop');
      return true;
    }
  });
  await coordinator.start({ apiKey: 'dg_first' });
  const secondRotation = coordinator.rotateApiKey({ apiKey: 'dg_second' });
  const thirdRotation = coordinator.rotateApiKey({ apiKey: 'dg_third' });
  await Promise.resolve();

  assert.deepEqual(calls, ['rotate:dg_second']);
  firstRotation.resolve();
  await Promise.all([secondRotation, thirdRotation]);

  assert.deepEqual(calls, ['rotate:dg_second', 'rotate:dg_third']);
  assert.equal(coordinator.getState().active, true);
});

test('lifecycle clear waits for startup before replacing the transcript session', async () => {
  const backendStart = deferred();
  const calls = [];
  const coordinator = new DeepgramLifecycleCoordinator({
    service: {
      start: async () => {
        calls.push('backend-start');
        await backendStart.promise;
      },
      stop: async () => {},
      clear: async () => calls.push('clear')
    },
    requestRendererStart: async () => {
      calls.push('renderer-start');
      return true;
    },
    requestRendererStop: async () => true
  });
  const startPromise = coordinator.start({ apiKey: 'dg_start_clear' });
  const clearPromise = coordinator.clear();
  await Promise.resolve();
  assert.deepEqual(calls, ['backend-start']);

  backendStart.resolve();
  await Promise.all([startPromise, clearPromise]);
  assert.deepEqual(calls, ['backend-start', 'renderer-start', 'clear']);
  assert.equal(coordinator.getState().active, true);
});

test('lifecycle clear waits for API-key rotation before replacing the transcript session', async () => {
  const rotation = deferred();
  const calls = [];
  const coordinator = new DeepgramLifecycleCoordinator({
    service: {
      start: async () => {},
      stop: async () => {},
      rotateApiKey: async () => {
        calls.push('rotate');
        await rotation.promise;
      },
      clear: async () => calls.push('clear')
    },
    requestRendererStart: async () => true,
    requestRendererStop: async () => true
  });
  await coordinator.start({ apiKey: 'dg_before_clear' });
  const rotationPromise = coordinator.rotateApiKey({ apiKey: 'dg_rotating' });
  const clearPromise = coordinator.clear();
  await Promise.resolve();
  assert.deepEqual(calls, ['rotate']);

  rotation.resolve();
  await Promise.all([rotationPromise, clearPromise]);
  assert.deepEqual(calls, ['rotate', 'clear']);
});

test('explicit stop invalidates a queued API-key rotation instead of restarting capture', async () => {
  const firstRotation = deferred();
  const calls = [];
  const coordinator = new DeepgramLifecycleCoordinator({
    service: {
      start: async ({ apiKey }) => calls.push(`start:${apiKey}`),
      stop: async () => calls.push('stop'),
      rotateApiKey: async ({ apiKey }) => {
        calls.push(`rotate:${apiKey}`);
        if (apiKey === 'dg_second') {
          await firstRotation.promise;
        }
      }
    },
    requestRendererStart: async () => true,
    requestRendererStop: async () => true
  });
  await coordinator.start({ apiKey: 'dg_first' });
  const secondRotation = coordinator.rotateApiKey({ apiKey: 'dg_second' });
  const thirdRotation = coordinator.rotateApiKey({ apiKey: 'dg_third' });
  const stopPromise = coordinator.stop({ reason: 'manual-stop' });
  firstRotation.resolve();
  await Promise.all([secondRotation, thirdRotation, stopPromise]);

  assert.deepEqual(calls, ['start:dg_first', 'rotate:dg_second', 'stop']);
  assert.equal(coordinator.getState().active, false);
});

test('clear failure fails closed without waiting on its own clear promise', async () => {
  const calls = [];
  const coordinator = new DeepgramLifecycleCoordinator({
    service: {
      start: async () => {},
      clear: async () => {
        throw new Error('clear reconnect failed');
      },
      stop: async () => calls.push('stop')
    },
    requestRendererStart: async () => true,
    requestRendererStop: async () => true
  });
  await coordinator.start({ apiKey: 'dg_clear_failure' });

  const state = await Promise.race([
    coordinator.clear(),
    new Promise((_, reject) => setTimeout(() => reject(new Error('clear deadlocked')), 25))
  ]);

  assert.deepEqual(calls, ['stop']);
  assert.equal(state.active, false);
  assert.equal(state.reason, 'backend-failed');
  assert.equal(state.error, 'clear reconnect failed');
});

test('explicit stop preempts an in-flight clear reconnect and ignores its late failure', async () => {
  const clearReconnect = deferred();
  const calls = [];
  const coordinator = new DeepgramLifecycleCoordinator({
    service: {
      start: async () => {},
      clear: async () => {
        calls.push('clear');
        await clearReconnect.promise;
      },
      stop: async () => calls.push('backend-stop')
    },
    requestRendererStart: async () => true,
    requestRendererStop: async () => {
      calls.push('renderer-stop');
      return true;
    }
  });
  await coordinator.start({ apiKey: 'dg_clear_stop' });

  const clearPromise = coordinator.clear();
  await Promise.resolve();
  const stopState = await Promise.race([
    coordinator.stop({ reason: 'app-exit' }),
    new Promise((_, reject) => setTimeout(() => reject(new Error('stop waited for clear')), 25))
  ]);

  assert.deepEqual(calls, ['clear', 'renderer-stop', 'backend-stop']);
  assert.equal(stopState.active, false);
  assert.equal(stopState.reason, 'app-exit');

  clearReconnect.reject(new Error('late clear failure'));
  const clearState = await clearPromise;
  assert.equal(clearState.active, false);
  assert.equal(clearState.reason, 'app-exit');
  assert.deepEqual(calls, ['clear', 'renderer-stop', 'backend-stop']);
});
