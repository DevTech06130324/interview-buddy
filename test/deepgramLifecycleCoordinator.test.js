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

function createSupersededError() {
  const error = new Error('Deepgram lifecycle operation was superseded.');
  error.code = 'DEEPGRAM_OPERATION_SUPERSEDED';
  return error;
}

function waitForAbortableGate(gate, signal) {
  if (signal?.aborted) {
    return Promise.reject(createSupersededError());
  }

  return new Promise((resolve, reject) => {
    const onAbort = () => reject(createSupersededError());
    signal?.addEventListener('abort', onAbort, { once: true });
    gate.promise.then(resolve, reject).finally(() => {
      signal?.removeEventListener('abort', onAbort);
    });
  });
}

async function waitFor(predicate, message = 'condition was not reached') {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (predicate()) {
      return;
    }
    await Promise.resolve();
  }
  assert.fail(message);
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
  await waitFor(
    () => coordinator.getState().phase === 'awaiting-renderer',
    'renderer acknowledgement gate was not reached'
  );
  assert.equal(coordinator.getState().active, false);
  assert.equal(coordinator.getState().phase, 'awaiting-renderer');
  rendererReady.resolve(true);

  const finalState = await startPromise;
  assert.equal(finalState.active, true);
  assert.equal(finalState.phase, 'active');
  assert.equal(states.some((state) => state.active && state.phase !== 'active'), false);
});

test('duplicate Start with the same desired key preserves revision and the in-flight renderer gate', async () => {
  const rendererReady = deferred();
  let backendStartCount = 0;
  let rendererStartCount = 0;
  const coordinator = new DeepgramLifecycleCoordinator({
    service: {
      start: async () => {
        backendStartCount += 1;
      },
      stop: async () => {}
    },
    requestRendererStart: async () => {
      rendererStartCount += 1;
      return rendererReady.promise;
    },
    requestRendererStop: async () => true
  });

  const firstStart = coordinator.start({ apiKey: 'dg_duplicate_start' });
  await waitFor(
    () => coordinator.getState().phase === 'awaiting-renderer',
    'renderer acknowledgement gate was not reached'
  );
  const revisionBeforeDuplicate = coordinator.getState().revision;
  const duplicateStart = coordinator.start({ apiKey: 'dg_duplicate_start' });

  assert.equal(duplicateStart, firstStart);
  assert.equal(coordinator.getState().revision, revisionBeforeDuplicate);
  rendererReady.resolve(true);
  await Promise.all([firstStart, duplicateStart]);

  assert.equal(backendStartCount, 1);
  assert.equal(rendererStartCount, 1);
  assert.equal(coordinator.getState().active, true);
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

test('duplicate Stop with the same reason preserves revision during and after cleanup', async () => {
  const rendererStop = deferred();
  let rendererStopCount = 0;
  let backendStopCount = 0;
  const coordinator = new DeepgramLifecycleCoordinator({
    service: {
      start: async () => {},
      stop: async () => {
        backendStopCount += 1;
      }
    },
    requestRendererStart: async () => true,
    requestRendererStop: async () => {
      rendererStopCount += 1;
      return rendererStop.promise;
    }
  });
  await coordinator.start({ apiKey: 'dg_duplicate_stop' });

  const firstStop = coordinator.stop({ reason: 'source-switched' });
  const stopRevision = coordinator.getState().revision;
  const duplicateDuringCleanup = coordinator.stop({ reason: 'source-switched' });

  assert.equal(duplicateDuringCleanup, firstStop);
  assert.equal(coordinator.getState().revision, stopRevision);
  rendererStop.resolve(true);
  await Promise.all([firstStop, duplicateDuringCleanup]);
  assert.equal(rendererStopCount, 1);
  assert.equal(backendStopCount, 1);

  const convergedRevision = coordinator.getState().revision;
  await coordinator.stop({ reason: 'source-switched' });
  assert.equal(coordinator.getState().revision, convergedRevision);
  assert.equal(rendererStopCount, 1);
  assert.equal(backendStopCount, 1);
});

test('Clear arriving while backend Stop is pending resets the session before a later Start', async () => {
  const backendStop = deferred();
  const backendClear = deferred();
  const calls = [];
  const retainedEntries = ['retained-old-session'];
  const entriesPublishedOnStart = [];
  const coordinator = new DeepgramLifecycleCoordinator({
    service: {
      start: async () => {
        calls.push('backend-start');
        entriesPublishedOnStart.push([...retainedEntries]);
      },
      stop: async () => {
        calls.push('backend-stop');
        await backendStop.promise;
      },
      clear: async () => {
        calls.push('backend-clear');
        retainedEntries.length = 0;
        await backendClear.promise;
        return false;
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
  await coordinator.start({ apiKey: 'dg_stop_then_clear' });
  calls.length = 0;
  entriesPublishedOnStart.length = 0;

  const stopPromise = coordinator.stop({ reason: 'manual-stop' });
  await waitFor(() => calls.includes('backend-stop'), 'backend Stop was not started');
  const clearPromise = coordinator.clear();

  assert.equal(coordinator.desired.sessionRevision, 1);
  assert.equal(coordinator.applied.sessionRevision, 0);
  assert.deepEqual(calls, ['renderer-stop', 'backend-stop']);

  backendStop.resolve();
  await waitFor(() => calls.includes('backend-clear'), 'Clear was skipped after Stop');
  assert.equal(coordinator.desired.sessionRevision, 1);
  assert.equal(coordinator.applied.sessionRevision, 0);

  backendClear.resolve();
  await Promise.all([stopPromise, clearPromise]);
  assert.equal(coordinator.applied.sessionRevision, 1);
  assert.deepEqual(calls, ['renderer-stop', 'backend-stop', 'backend-clear']);

  const restartState = await coordinator.start({ apiKey: 'dg_stop_then_clear' });
  assert.deepEqual(entriesPublishedOnStart, [[]]);
  assert.deepEqual(calls, [
    'renderer-stop',
    'backend-stop',
    'backend-clear',
    'backend-start',
    'renderer-start'
  ]);
  assert.equal(restartState.active, true);
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

  const state = await coordinator.setApiKey({ apiKey: 'dg_new' });

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
  await waitFor(
    () => coordinator.getState().phase === 'awaiting-renderer',
    'renderer acknowledgement gate was not reached'
  );
  const stopPromise = coordinator.stop({ reason: 'cancelled' });
  rendererReady.resolve(true);
  await Promise.all([startPromise, stopPromise]);

  assert.equal(coordinator.getState().active, false);
  assert.equal(coordinator.getState().reason, 'cancelled');
  assert.deepEqual(calls, ['backend-start', 'renderer-stop', 'backend-stop']);
});

test('stop drains a failed renderer attempt whose acknowledgement became stale', async () => {
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

  const startPromise = coordinator.start({ apiKey: 'dg_stale_renderer_failure' });
  await waitFor(
    () => coordinator.getState().phase === 'awaiting-renderer',
    'renderer acknowledgement gate was not reached'
  );
  const stopPromise = coordinator.stop({ reason: 'cancelled' });
  rendererReady.resolve(false);
  await Promise.all([startPromise, stopPromise]);

  assert.equal(coordinator.getState().active, false);
  assert.equal(coordinator.getState().reason, 'cancelled');
  assert.deepEqual(calls, ['backend-start', 'renderer-stop', 'backend-stop']);
});

test('a newer running intent drains a stale failed renderer attempt before retrying capture', async () => {
  const firstRendererAttempt = deferred();
  const calls = [];
  let rendererAttempts = 0;
  const coordinator = new DeepgramLifecycleCoordinator({
    service: {
      start: async () => calls.push('backend-start'),
      stop: async () => calls.push('backend-stop'),
      rotateApiKey: async ({ apiKey }) => calls.push(`rotate:${apiKey}`)
    },
    requestRendererStart: async () => {
      rendererAttempts += 1;
      calls.push(`renderer-start:${rendererAttempts}`);
      if (rendererAttempts === 1) {
        return firstRendererAttempt.promise;
      }
      return true;
    },
    requestRendererStop: async () => {
      calls.push('renderer-stop');
      return true;
    }
  });

  const startPromise = coordinator.start({ apiKey: 'dg_initial' });
  await waitFor(
    () => coordinator.getState().phase === 'awaiting-renderer',
    'renderer acknowledgement gate was not reached'
  );
  coordinator.setApiKey({ apiKey: 'dg_latest' });
  firstRendererAttempt.resolve(false);
  const state = await startPromise;

  assert.deepEqual(calls, [
    'backend-start',
    'renderer-start:1',
    'rotate:dg_latest',
    'renderer-stop',
    'renderer-start:2'
  ]);
  assert.equal(state.active, true);
});

test('an unacknowledged stale renderer cleanup fails closed without retrying capture', async () => {
  const firstRendererAttempt = deferred();
  const calls = [];
  let rendererAttempts = 0;
  const coordinator = new DeepgramLifecycleCoordinator({
    service: {
      start: async () => calls.push('backend-start'),
      stop: async () => calls.push('backend-stop'),
      rotateApiKey: async ({ apiKey }) => calls.push(`rotate:${apiKey}`)
    },
    requestRendererStart: async () => {
      rendererAttempts += 1;
      calls.push(`renderer-start:${rendererAttempts}`);
      return firstRendererAttempt.promise;
    },
    requestRendererStop: async () => {
      calls.push('renderer-stop');
      return false;
    }
  });

  const startPromise = coordinator.start({ apiKey: 'dg_initial' });
  await waitFor(
    () => coordinator.getState().phase === 'awaiting-renderer',
    'renderer acknowledgement gate was not reached'
  );
  coordinator.setApiKey({ apiKey: 'dg_latest' });
  firstRendererAttempt.resolve(false);
  const state = await startPromise;

  assert.deepEqual(calls, [
    'backend-start',
    'renderer-start:1',
    'rotate:dg_latest',
    'renderer-stop',
    'backend-stop'
  ]);
  assert.equal(state.active, false);
  assert.equal(state.reason, 'renderer-stop-failed');
  assert.match(state.error, /not acknowledged/i);
});

test('an unacknowledged renderer stop cancels a queued restart', async () => {
  const starts = [];
  const calls = [];
  const coordinator = new DeepgramLifecycleCoordinator({
    service: {
      start: async ({ apiKey }) => starts.push(apiKey),
      stop: async () => calls.push('backend-stop'),
      rotateApiKey: async () => {}
    },
    requestRendererStart: async () => true,
    requestRendererStop: async () => {
      calls.push('renderer-stop');
      return false;
    }
  });
  await coordinator.start({ apiKey: 'dg_initial' });

  const stopPromise = coordinator.stop({ reason: 'replace' });
  const restartPromise = coordinator.start({ apiKey: 'dg_queued' });
  const state = await Promise.all([stopPromise, restartPromise]).then((results) => results.at(-1));

  assert.deepEqual(starts, ['dg_initial']);
  assert.deepEqual(calls, ['renderer-stop', 'backend-stop']);
  assert.equal(state.active, false);
  assert.equal(state.reason, 'renderer-stop-failed');
  assert.match(state.error, /not acknowledged/i);
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
  await waitFor(
    () => calls.includes('backend-stop'),
    'backend cleanup did not start'
  );

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

test('a later explicit stop invalidates a start queued behind an in-flight stop', async () => {
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
  const firstStop = coordinator.stop({ reason: 'replace' });
  const queuedStart = coordinator.start({ apiKey: 'dg_queued' });
  const terminalStop = coordinator.stop({ reason: 'manual-stop' });

  backendStop.resolve();
  await Promise.all([firstStop, queuedStart, terminalStop]);

  assert.deepEqual(calls, [
    'backend-start:dg_first',
    'renderer-start',
    'renderer-stop',
    'backend-stop'
  ]);
  assert.equal(coordinator.getState().active, false);
});

test('source-switch stop invalidates a start queued behind transcript clear', async () => {
  const backendClear = deferred();
  const calls = [];
  const coordinator = new DeepgramLifecycleCoordinator({
    service: {
      start: async ({ apiKey }) => calls.push(`backend-start:${apiKey}`),
      clear: async () => {
        calls.push('backend-clear');
        await backendClear.promise;
      },
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
  await coordinator.start({ apiKey: 'dg_first' });
  const clearPromise = coordinator.clear();
  const queuedStart = coordinator.start({ apiKey: 'dg_queued' });
  const sourceSwitchStop = coordinator.stop({ reason: 'source-switched' });

  backendClear.resolve();
  await Promise.all([clearPromise, queuedStart, sourceSwitchStop]);

  assert.deepEqual(calls, [
    'backend-start:dg_first',
    'renderer-start',
    'backend-clear',
    'renderer-stop',
    'backend-stop'
  ]);
  assert.equal(coordinator.getState().active, false);
  assert.equal(coordinator.getState().reason, 'source-switched');
});

test('shutdown stop invalidates a start queued behind an in-flight stop', async () => {
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
  const firstStop = coordinator.stop({ reason: 'replace' });
  const queuedStart = coordinator.start({ apiKey: 'dg_queued' });
  const shutdownStop = coordinator.stop({ reason: 'app-exit' });

  backendStop.resolve();
  await Promise.all([firstStop, queuedStart, shutdownStop]);

  assert.deepEqual(calls, [
    'backend-start:dg_first',
    'renderer-start',
    'renderer-stop',
    'backend-stop'
  ]);
  assert.equal(coordinator.getState().active, false);
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
  const secondRotation = coordinator.setApiKey({ apiKey: 'dg_second' });
  const thirdRotation = coordinator.setApiKey({ apiKey: 'dg_third' });
  await Promise.resolve();

  assert.deepEqual(calls, ['rotate:dg_second']);
  firstRotation.resolve();
  await Promise.all([secondRotation, thirdRotation]);

  assert.deepEqual(calls, ['rotate:dg_second', 'rotate:dg_third']);
  assert.equal(coordinator.getState().active, true);
});

test('lifecycle clear supersedes startup and replaces the session before renderer capture', async () => {
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
  assert.deepEqual(calls, ['backend-start', 'clear', 'renderer-start']);
  assert.equal(coordinator.getState().active, true);
});

test('lifecycle clear applies a new transcript session while already inactive', async () => {
  const calls = [];
  const coordinator = new DeepgramLifecycleCoordinator({
    service: {
      start: async () => calls.push('backend-start'),
      stop: async () => calls.push('backend-stop'),
      clear: async () => {
        calls.push('clear');
        return false;
      },
      rotateApiKey: async () => {}
    },
    requestRendererStart: async () => true,
    requestRendererStop: async () => true
  });

  const state = await coordinator.clear();

  assert.deepEqual(calls, ['clear']);
  assert.equal(state.active, false);
  assert.equal(state.phase, 'inactive');
});

test('a Clear issued after an earlier Clear resolves still applies its own session reset', async () => {
  const firstClear = deferred();
  let clearCount = 0;
  const coordinator = new DeepgramLifecycleCoordinator({
    service: {
      start: async () => {},
      stop: async () => {},
      clear: async () => {
        clearCount += 1;
        await firstClear.promise;
        return false;
      },
      rotateApiKey: async () => {}
    },
    requestRendererStart: async () => true,
    requestRendererStop: async () => true
  });

  const first = coordinator.clear();
  await waitFor(() => clearCount === 1, 'first Clear was not started');
  firstClear.resolve();
  const second = coordinator.clear();
  await Promise.all([first, second]);

  assert.equal(clearCount, 2);
  assert.equal(coordinator.desired.sessionRevision, 2);
  assert.equal(coordinator.applied.sessionRevision, 2);
});

test('inactive clear settles after renderer cleanup failed closed', async () => {
  const calls = [];
  let statePublications = 0;
  const coordinator = new DeepgramLifecycleCoordinator({
    service: {
      start: async () => calls.push('backend-start'),
      stop: async () => calls.push('backend-stop'),
      clear: async () => {
        calls.push('clear');
        return false;
      },
      rotateApiKey: async () => {}
    },
    requestRendererStart: async () => true,
    requestRendererStop: async () => {
      calls.push('renderer-stop');
      return false;
    },
    onState: () => {
      statePublications += 1;
      if (statePublications > 40) {
        throw new Error('inactive clear reconciliation spun');
      }
    }
  });
  await coordinator.start({ apiKey: 'dg_initial' });
  const failedStop = await coordinator.stop({ reason: 'manual-stop' });
  assert.equal(failedStop.reason, 'renderer-stop-failed');

  const state = await coordinator.clear();

  assert.deepEqual(calls, [
    'backend-start',
    'renderer-stop',
    'backend-stop',
    'clear'
  ]);
  assert.equal(state.active, false);
  assert.equal(state.reason, 'renderer-stop-failed');
  assert.ok(statePublications <= 40);
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
  const rotationPromise = coordinator.setApiKey({ apiKey: 'dg_rotating' });
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
  const secondRotation = coordinator.setApiKey({ apiKey: 'dg_second' });
  const thirdRotation = coordinator.setApiKey({ apiKey: 'dg_third' });
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

test('explicit stop supersedes an abort-aware clear reconnect before cleanup', async () => {
  const clearReconnect = deferred();
  const calls = [];
  const coordinator = new DeepgramLifecycleCoordinator({
    service: {
      start: async () => {},
      clear: async ({ signal } = {}) => {
        calls.push('clear');
        await waitForAbortableGate(clearReconnect, signal);
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
  const stopPromise = coordinator.stop({ reason: 'app-exit' });
  const [clearState, stopState] = await Promise.race([
    Promise.all([clearPromise, stopPromise]),
    new Promise((_, reject) => setTimeout(() => reject(new Error('stop waited for clear')), 25))
  ]);

  assert.deepEqual(calls, ['clear', 'renderer-stop', 'backend-stop']);
  assert.equal(stopState.active, false);
  assert.equal(stopState.reason, 'app-exit');

  assert.equal(clearState.active, false);
  assert.equal(clearState.reason, 'app-exit');
  assert.deepEqual(calls, ['clear', 'renderer-stop', 'backend-stop']);
});

test('three API-key edits during connection converge on the latest key and one renderer start', async () => {
  const firstConnection = deferred();
  const starts = [];
  let rendererStartCount = 0;
  let rendererStopCount = 0;
  const states = [];
  const coordinator = new DeepgramLifecycleCoordinator({
    service: {
      start: async ({ apiKey, signal }) => {
        starts.push(apiKey);
        if (apiKey === 'dg_initial') {
          await waitForAbortableGate(firstConnection, signal);
        }
      },
      stop: async () => {},
      clear: async () => true,
      rotateApiKey: async () => {}
    },
    requestRendererStart: async () => {
      rendererStartCount += 1;
      return true;
    },
    requestRendererStop: async () => {
      rendererStopCount += 1;
      return true;
    },
    onState: (state) => states.push(state)
  });

  const startPromise = coordinator.start({ apiKey: 'dg_initial' });
  const firstEdit = coordinator.setApiKey({ apiKey: 'dg_edit_1' });
  const secondEdit = coordinator.setApiKey({ apiKey: 'dg_edit_2' });
  const finalEdit = coordinator.setApiKey({ apiKey: 'dg_final' });

  assert.equal(firstEdit, startPromise);
  assert.equal(secondEdit, startPromise);
  assert.equal(finalEdit, startPromise);
  const state = await finalEdit;

  assert.deepEqual(starts, ['dg_initial', 'dg_final']);
  assert.equal(rendererStartCount, 1);
  assert.equal(rendererStopCount, 0);
  assert.equal(state.active, true);
  assert.equal(state.phase, 'active');
  assert.equal(states.some((entry) => entry.reason === 'backend-failed'), false);
});

test('three API-key edits at the renderer acknowledgement gate rotate once and do not restart capture', async () => {
  const rendererGate = deferred();
  const starts = [];
  const rotations = [];
  let rendererStartCount = 0;
  let rendererStopCount = 0;
  const coordinator = new DeepgramLifecycleCoordinator({
    service: {
      start: async ({ apiKey }) => starts.push(apiKey),
      stop: async () => {},
      clear: async () => true,
      rotateApiKey: async ({ apiKey }) => rotations.push(apiKey)
    },
    requestRendererStart: async () => {
      rendererStartCount += 1;
      return rendererGate.promise;
    },
    requestRendererStop: async () => {
      rendererStopCount += 1;
      return true;
    }
  });

  const startPromise = coordinator.start({ apiKey: 'dg_initial' });
  await waitFor(
    () => coordinator.getState().phase === 'awaiting-renderer',
    'renderer acknowledgement gate was not reached'
  );
  coordinator.setApiKey({ apiKey: 'dg_edit_1' });
  coordinator.setApiKey({ apiKey: 'dg_edit_2' });
  const finalEdit = coordinator.setApiKey({ apiKey: 'dg_final' });
  rendererGate.resolve(true);

  const state = await Promise.all([startPromise, finalEdit]).then((results) => results.at(-1));

  assert.deepEqual(starts, ['dg_initial']);
  assert.deepEqual(rotations, ['dg_final']);
  assert.equal(rendererStartCount, 1);
  assert.equal(rendererStopCount, 0);
  assert.equal(state.active, true);
});

test('three API-key edits during active rotation collapse to the latest key without renderer cleanup', async () => {
  const firstRotation = deferred();
  const rotations = [];
  let rendererStartCount = 0;
  let rendererStopCount = 0;
  const coordinator = new DeepgramLifecycleCoordinator({
    service: {
      start: async () => {},
      stop: async () => {},
      clear: async () => true,
      rotateApiKey: async ({ apiKey, signal }) => {
        rotations.push(apiKey);
        if (apiKey === 'dg_edit_1') {
          await waitForAbortableGate(firstRotation, signal);
        }
      }
    },
    requestRendererStart: async () => {
      rendererStartCount += 1;
      return true;
    },
    requestRendererStop: async () => {
      rendererStopCount += 1;
      return true;
    }
  });
  await coordinator.start({ apiKey: 'dg_initial' });

  coordinator.setApiKey({ apiKey: 'dg_edit_1' });
  coordinator.setApiKey({ apiKey: 'dg_edit_2' });
  const finalEdit = coordinator.setApiKey({ apiKey: 'dg_final' });
  const state = await finalEdit;

  assert.deepEqual(rotations, ['dg_edit_1', 'dg_final']);
  assert.equal(rendererStartCount, 1);
  assert.equal(rendererStopCount, 0);
  assert.equal(state.active, true);
});

test('a stale rotation failure after three API-key edits cannot fail closed and converges on the latest key', async () => {
  const staleRotation = deferred();
  const rotations = [];
  const calls = [];
  const states = [];
  const coordinator = new DeepgramLifecycleCoordinator({
    service: {
      start: async () => calls.push('backend-start'),
      stop: async () => calls.push('backend-stop'),
      clear: async () => true,
      rotateApiKey: async ({ apiKey }) => {
        rotations.push(apiKey);
        if (apiKey === 'dg_edit_1') {
          await staleRotation.promise;
        }
      }
    },
    requestRendererStart: async () => {
      calls.push('renderer-start');
      return true;
    },
    requestRendererStop: async () => {
      calls.push('renderer-stop');
      return true;
    },
    onState: (state) => states.push(state)
  });
  await coordinator.start({ apiKey: 'dg_initial' });

  coordinator.setApiKey({ apiKey: 'dg_edit_1' });
  coordinator.setApiKey({ apiKey: 'dg_edit_2' });
  const finalEdit = coordinator.setApiKey({ apiKey: 'dg_final' });
  staleRotation.reject(new Error('invalid intermediate key'));
  const state = await finalEdit;

  assert.deepEqual(rotations, ['dg_edit_1', 'dg_final']);
  assert.deepEqual(calls, ['backend-start', 'renderer-start']);
  assert.equal(state.active, true);
  assert.equal(states.some((entry) => entry.reason === 'backend-failed'), false);
  assert.equal(states.some((entry) => entry.reason === 'api-key-rotation-failed'), false);
});

test('clear superseded by rapid key edits retries the session and preserves renderer capture', async () => {
  const firstClear = deferred();
  const calls = [];
  let clearCount = 0;
  const coordinator = new DeepgramLifecycleCoordinator({
    service: {
      start: async ({ apiKey }) => calls.push(`start:${apiKey}`),
      stop: async () => calls.push('backend-stop'),
      clear: async ({ apiKey, signal } = {}) => {
        clearCount += 1;
        calls.push(`clear:${clearCount}:${apiKey}`);
        if (clearCount === 1) {
          await waitForAbortableGate(firstClear, signal);
        }
        return true;
      },
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
  await coordinator.start({ apiKey: 'dg_initial' });

  coordinator.clear();
  coordinator.setApiKey({ apiKey: 'dg_edit_1' });
  coordinator.setApiKey({ apiKey: 'dg_edit_2' });
  const finalEdit = coordinator.setApiKey({ apiKey: 'dg_final' });
  const state = await finalEdit;

  assert.deepEqual(calls, [
    'start:dg_initial',
    'renderer-start',
    'clear:1:dg_initial',
    'clear:2:dg_final'
  ]);
  assert.equal(state.active, true);
});

test('source-switch stop supersedes clear and queued start without a fatal state', async () => {
  const clearGate = deferred();
  const calls = [];
  const states = [];
  const coordinator = new DeepgramLifecycleCoordinator({
    service: {
      start: async ({ apiKey }) => calls.push(`start:${apiKey}`),
      stop: async () => calls.push('backend-stop'),
      clear: async ({ signal } = {}) => {
        calls.push('clear');
        await waitForAbortableGate(clearGate, signal);
      },
      rotateApiKey: async ({ apiKey }) => calls.push(`rotate:${apiKey}`)
    },
    requestRendererStart: async () => {
      calls.push('renderer-start');
      return true;
    },
    requestRendererStop: async () => {
      calls.push('renderer-stop');
      return true;
    },
    onState: (state) => states.push(state)
  });
  await coordinator.start({ apiKey: 'dg_initial' });

  coordinator.clear();
  coordinator.start({ apiKey: 'dg_queued' });
  const stopState = await coordinator.stop({ reason: 'source-switched' });

  assert.deepEqual(calls, [
    'start:dg_initial',
    'renderer-start',
    'clear',
    'renderer-stop',
    'backend-stop'
  ]);
  assert.equal(stopState.active, false);
  assert.equal(stopState.reason, 'source-switched');
  assert.equal(states.some((entry) => entry.reason === 'backend-failed'), false);
});

test('shutdown supersedes a start queued during non-cancellable cleanup and remains terminal', async () => {
  const backendStop = deferred();
  const starts = [];
  const calls = [];
  const coordinator = new DeepgramLifecycleCoordinator({
    service: {
      start: async ({ apiKey }) => starts.push(apiKey),
      stop: async () => {
        calls.push('backend-stop');
        await backendStop.promise;
      },
      clear: async () => true,
      rotateApiKey: async () => {}
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
  await coordinator.start({ apiKey: 'dg_initial' });

  const firstStop = coordinator.stop({ reason: 'replace' });
  const queuedStart = coordinator.start({ apiKey: 'dg_queued' });
  const shutdown = coordinator.shutdown();
  backendStop.resolve();
  const state = await shutdown;

  assert.equal(firstStop, queuedStart);
  assert.equal(queuedStart, shutdown);
  assert.deepEqual(starts, ['dg_initial']);
  assert.deepEqual(calls, ['renderer-start', 'renderer-stop', 'backend-stop']);
  assert.equal(state.active, false);
  assert.equal(state.reason, 'app-exit');

  const postShutdownState = await coordinator.start({ apiKey: 'dg_after_shutdown' });
  assert.deepEqual(starts, ['dg_initial']);
  assert.equal(postShutdownState.active, false);
  assert.equal(postShutdownState.reason, 'app-exit');
});

test('clear after shutdown is effect-free and cannot mutate terminal desired state', async () => {
  const calls = [];
  const coordinator = new DeepgramLifecycleCoordinator({
    service: {
      start: async () => calls.push('backend-start'),
      stop: async () => calls.push('backend-stop'),
      clear: async () => calls.push('clear'),
      rotateApiKey: async () => calls.push('rotate')
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
  await coordinator.shutdown();
  const terminalDesired = { ...coordinator.desired };

  const state = await coordinator.clear();

  assert.deepEqual(calls, []);
  assert.deepEqual(coordinator.desired, terminalDesired);
  assert.equal(state.active, false);
  assert.equal(state.phase, 'inactive');
  assert.equal(state.reason, 'app-exit');
});

test('Stop after shutdown is terminal and cannot publish or schedule lifecycle effects', async () => {
  const calls = [];
  const states = [];
  const coordinator = new DeepgramLifecycleCoordinator({
    service: {
      start: async () => calls.push('backend-start'),
      stop: async () => calls.push('backend-stop'),
      clear: async () => calls.push('clear'),
      rotateApiKey: async () => calls.push('rotate')
    },
    requestRendererStart: async () => {
      calls.push('renderer-start');
      return true;
    },
    requestRendererStop: async () => {
      calls.push('renderer-stop');
      return true;
    },
    onState: (state) => states.push(state)
  });
  await coordinator.shutdown();
  const terminalDesired = { ...coordinator.desired };
  const stateCount = states.length;

  const state = await coordinator.stop({ reason: 'source-switched' });

  assert.deepEqual(calls, []);
  assert.deepEqual(coordinator.desired, terminalDesired);
  assert.equal(states.length, stateCount);
  assert.equal(state.active, false);
  assert.equal(state.reason, 'app-exit');
});

test('key edits, start, and repeated shutdown cannot mutate terminal desired state', async () => {
  const calls = [];
  const coordinator = new DeepgramLifecycleCoordinator({
    service: {
      start: async () => calls.push('backend-start'),
      stop: async () => calls.push('backend-stop'),
      clear: async () => calls.push('clear'),
      rotateApiKey: async () => calls.push('rotate')
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
  await coordinator.setApiKey({ apiKey: 'dg_terminal' });
  await coordinator.shutdown();
  const terminalDesired = { ...coordinator.desired };

  const states = await Promise.all([
    coordinator.setApiKey({ apiKey: 'dg_ignored_set' }),
    coordinator.start({ apiKey: 'dg_ignored_start' }),
    coordinator.shutdown()
  ]);

  assert.deepEqual(calls, []);
  assert.deepEqual(coordinator.desired, terminalDesired);
  assert.equal(states.every((state) => state.active === false), true);
  assert.equal(states.every((state) => state.reason === 'app-exit'), true);
});

test('stale failClosed revision is ignored after a newer API-key intent', async () => {
  const starts = [];
  const rotations = [];
  const states = [];
  const calls = [];
  const coordinator = new DeepgramLifecycleCoordinator({
    service: {
      start: async ({ apiKey, revision }) => starts.push({ apiKey, revision }),
      stop: async () => calls.push('backend-stop'),
      clear: async () => true,
      rotateApiKey: async ({ apiKey }) => rotations.push(apiKey)
    },
    requestRendererStart: async () => true,
    requestRendererStop: async () => {
      calls.push('renderer-stop');
      return true;
    },
    onState: (state) => states.push(state)
  });
  await coordinator.start({ apiKey: 'dg_initial' });
  const staleRevision = starts[0].revision;

  const keyEdit = coordinator.setApiKey({ apiKey: 'dg_latest' });
  const staleFailure = coordinator.failClosed(new Error('stale socket failure'), {
    revision: staleRevision
  });
  const state = await Promise.all([keyEdit, staleFailure]).then((results) => results.at(-1));

  assert.deepEqual(rotations, ['dg_latest']);
  assert.deepEqual(calls, []);
  assert.equal(state.active, true);
  assert.equal(states.some((entry) => entry.reason === 'backend-failed'), false);
});

test('API-key edits while inactive record the latest key without starting capture', async () => {
  const starts = [];
  const coordinator = new DeepgramLifecycleCoordinator({
    service: {
      start: async ({ apiKey }) => starts.push(apiKey),
      stop: async () => {},
      clear: async () => true,
      rotateApiKey: async () => {}
    },
    requestRendererStart: async () => true,
    requestRendererStop: async () => true
  });

  await coordinator.setApiKey({ apiKey: 'dg_edit_1' });
  await coordinator.setApiKey({ apiKey: 'dg_edit_2' });
  await coordinator.setApiKey({ apiKey: 'dg_final' });
  assert.deepEqual(starts, []);

  const state = await coordinator.start();
  assert.deepEqual(starts, ['dg_final']);
  assert.equal(state.active, true);
});

test('an intent changed by state publication cannot launch the stale effect', async () => {
  const staleConnection = deferred();
  const starts = [];
  let coordinator;
  let keyChanged = false;
  coordinator = new DeepgramLifecycleCoordinator({
    service: {
      start: async ({ apiKey }) => {
        starts.push(apiKey);
        if (apiKey === 'dg_initial') {
          await staleConnection.promise;
        }
      },
      stop: async () => {},
      clear: async () => true,
      rotateApiKey: async () => {}
    },
    requestRendererStart: async () => true,
    requestRendererStop: async () => true,
    onState: (state) => {
      if (!keyChanged && state.phase === 'connecting') {
        keyChanged = true;
        coordinator.setApiKey({ apiKey: 'dg_final' });
      }
    }
  });

  const statePromise = coordinator.start({ apiKey: 'dg_initial' });
  await waitFor(() => starts.length > 0, 'latest connection was not started');

  assert.deepEqual(starts, ['dg_final']);
  const state = await statePromise;
  assert.equal(state.active, true);
});
