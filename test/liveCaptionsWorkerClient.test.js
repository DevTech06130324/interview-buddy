const test = require('node:test');
const assert = require('node:assert/strict');
const EventEmitter = require('node:events');

const { LiveCaptionsWorkerRuntime } = require('../src/liveCaptionsWorker');
const {
    DEFAULT_COMMAND_TIMEOUT_MS,
    LiveCaptionsWorkerClient
} = require('../src/liveCaptionsWorkerClient');

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return { promise, resolve, reject };
}

function createFakeTimers() {
    const pending = new Map();
    let nextId = 1;
    return {
        setTimeoutFn(callback, delayMs) {
            const id = nextId;
            nextId += 1;
            pending.set(id, { callback, delayMs });
            return id;
        },
        clearTimeoutFn(id) {
            pending.delete(id);
        },
        runNext() {
            const next = pending.entries().next().value;
            assert.ok(next, 'expected a pending command timeout');
            const [id, timer] = next;
            pending.delete(id);
            timer.callback();
            return timer.delayMs;
        },
        get size() {
            return pending.size;
        }
    };
}

class FakeWorker extends EventEmitter {
    constructor() {
        super();
        this.messages = [];
        this.terminated = false;
    }

    postMessage(message) {
        this.messages.push(message);
    }

    respondTo(command, result) {
        const request = this.messages.find((message) => message.command === command);
        assert.ok(request, `expected ${command} command`);
        this.emit('message', {
            type: 'response',
            requestId: request.requestId,
            ok: true,
            result
        });
    }

    failCommand(command, code = 'FAKE_COMMAND_FAILED') {
        const request = this.messages.find((message) => message.command === command);
        assert.ok(request, `expected ${command} command`);
        this.emit('message', {
            type: 'response',
            requestId: request.requestId,
            ok: false,
            error: {
                code,
                message: `${command} failed`
            }
        });
    }

    terminate() {
        this.terminated = true;
        return this.terminationGate?.promise || Promise.resolve(0);
    }
}

class RuntimeBackedWorker extends EventEmitter {
    constructor(handler) {
        super();
        this.messages = [];
        this.terminated = false;
        this.timers = createFakeTimers();
        this.runtime = new LiveCaptionsWorkerRuntime({
            handler,
            postMessage: (message) => this.emit('message', message),
            setTimeoutFn: this.timers.setTimeoutFn,
            clearTimeoutFn: this.timers.clearTimeoutFn
        });
    }

    postMessage(message) {
        this.messages.push(message);
        void this.runtime.handleMessage(message);
    }

    runNextPoll() {
        return this.timers.runNext();
    }

    terminate() {
        this.terminated = true;
        return Promise.resolve(0);
    }
}

async function flushAsyncWork() {
    await new Promise((resolve) => setImmediate(resolve));
}

test('client forwards snapshots without loading a native boundary', async () => {
    const workers = [];
    const client = new LiveCaptionsWorkerClient({
        createWorker() {
            const worker = new FakeWorker();
            workers.push(worker);
            return worker;
        }
    });
    const snapshots = [];
    client.on('snapshot', (snapshot) => snapshots.push(snapshot));

    const startPromise = client.start();
    workers[0].respondTo('start', {
        started: true,
        ownership: { owned: false, processId: 52 }
    });
    await startPromise;

    workers[0].emit('message', {
        type: 'snapshot',
        snapshot: { status: 'ok', text: '' }
    });

    assert.deepEqual(snapshots, [{ status: 'ok', text: '' }]);
});

test('an unowned Clear boundary survives worker replacement without replaying pre-Clear text', async () => {
    const workers = [];
    const firstRawText = 'Old question. Old details.';
    const firstHandler = {
        async initialize() {
            return true;
        },
        async launchLiveCaptions() {
            return { success: true, ownership: { owned: false, processId: 52 } };
        },
        async restartLiveCaptions() {
            return { success: true, ownership: { owned: false, processId: 52 } };
        },
        async cleanup() {
            return { ownership: { owned: false, processId: 0 } };
        },
        getCaptions() {
            return { status: 'ok', text: firstHandler.rawTexts.shift() || '' };
        },
        rawTexts: [
            firstRawText,
            `${firstRawText} New answer.`
        ]
    };
    const replacementHandler = {
        async initialize() {
            return true;
        },
        async launchLiveCaptions() {
            return { success: true, ownership: { owned: false, processId: 52 } };
        },
        async cleanup() {
            return { ownership: { owned: false, processId: 0 } };
        },
        getCaptions() {
            return {
                status: 'ok',
                text: `${firstRawText} New answer. More detail.`
            };
        }
    };
    const handlers = [firstHandler, replacementHandler];
    const client = new LiveCaptionsWorkerClient({
        createWorker() {
            const worker = new RuntimeBackedWorker(handlers.shift());
            workers.push(worker);
            return worker;
        }
    });
    const snapshots = [];
    client.on('snapshot', (snapshot) => snapshots.push(snapshot));

    await client.start();
    await client.restart();
    workers[0].runNextPoll();
    assert.deepEqual(snapshots, [{ status: 'ok', text: ' New answer.' }]);

    workers[0].emit('exit', 1);
    await flushAsyncWork();
    await flushAsyncWork();

    assert.equal(workers.length, 2, 'the first worker crash should create one replacement');
    assert.deepEqual(
        workers[1].messages.find((message) => message.command === 'start')?.payload,
        {
            checkpoint: {
                clearSessionActive: true,
                clearBaselineText: firstRawText,
                postClearText: ' New answer.',
                lastSuccessfulRawText: `${firstRawText} New answer.`
            }
        }
    );

    workers[1].runNextPoll();
    assert.deepEqual(snapshots, [
        { status: 'ok', text: ' New answer.' },
        { status: 'ok', text: ' New answer. More detail.' }
    ]);
    assert.equal(
        snapshots.some((snapshot) => snapshot.text.includes('Old question.') || snapshot.text.includes('Old details.')),
        false,
        'a replacement worker must never re-publish pre-Clear raw text'
    );

    await client.stop();
});

test('client restarts one crash, fails closed on the second, and explicit start creates a fresh lifecycle', async () => {
    const workers = [];
    const client = new LiveCaptionsWorkerClient({
        createWorker() {
            const worker = new FakeWorker();
            workers.push(worker);
            return worker;
        }
    });
    const sourceErrors = [];
    const sourceStates = [];
    client.on('error', (error) => sourceErrors.push(error));
    client.on('state', (state) => sourceStates.push(state));

    const initialStart = client.start();
    workers[0].respondTo('start', {
        started: true,
        ownership: { owned: true, processId: 77 }
    });
    await initialStart;

    workers[0].emit('error', new Error('first worker crash'));
    workers[0].emit('exit', 1);
    await flushAsyncWork();

    assert.equal(workers.length, 2, 'first crash creates one replacement worker');
    assert.ok(sourceStates.some((state) => (
        state.phase === 'restarting' && state.retryAttempt === 1
    )));
    const replacementStart = workers[1].messages.find((message) => message.command === 'start');
    assert.deepEqual(replacementStart.payload, {
        checkpoint: {
            clearSessionActive: false,
            clearBaselineText: '',
            postClearText: '',
            lastSuccessfulRawText: ''
        }
    });
    workers[1].respondTo('start', {
        started: true,
        ownership: { owned: true, processId: 77 }
    });
    await flushAsyncWork();

    workers[1].emit('exit', 9);
    await flushAsyncWork();

    assert.equal(workers.length, 2, 'second crash does not restart automatically');
    assert.equal(sourceErrors.length, 1);
    assert.equal(sourceErrors[0].code, 'LIVECAPTIONS_WORKER_MANUAL_RETRY');
    assert.equal(sourceErrors[0].recoverable, true);
    assert.deepEqual(client.getState(), {
        phase: 'error',
        active: false,
        manualRetryRequired: true,
        crashCount: 2,
        retryAttempt: 2,
        ownership: { owned: true, processId: 77 }
    });

    const retryStart = client.start();
    await flushAsyncWork();
    assert.equal(workers.length, 3, 'explicit retry starts a fresh worker lifecycle');
    workers[2].respondTo('start', {
        started: true,
        ownership: { owned: true, processId: 77 }
    });
    await retryStart;
    assert.deepEqual(client.getState(), {
        phase: 'active',
        active: true,
        manualRetryRequired: false,
        crashCount: 0,
        retryAttempt: 0,
        ownership: { owned: true, processId: 77 }
    });
});

test('a crash during initial start waits for the one allowed replacement', async () => {
    const workers = [];
    const client = new LiveCaptionsWorkerClient({
        createWorker() {
            const worker = new FakeWorker();
            workers.push(worker);
            return worker;
        }
    });
    client.on('error', () => {});

    const startPromise = client.start();
    workers[0].emit('exit', 8);
    await flushAsyncWork();

    assert.equal(workers.length, 2);
    workers[1].respondTo('start', {
        started: true,
        ownership: { owned: true, processId: 99 }
    });

    const state = await startPromise;
    assert.equal(state.active, true);
    assert.equal(state.phase, 'active');
    assert.equal(state.crashCount, 1);
});

test('a failed stop command still retires the worker and closes client source state', async () => {
    const workers = [];
    const client = new LiveCaptionsWorkerClient({
        createWorker() {
            const worker = new FakeWorker();
            workers.push(worker);
            return worker;
        }
    });

    const startPromise = client.start();
    workers[0].respondTo('start', {
        started: true,
        ownership: { owned: false, processId: 33 }
    });
    await startPromise;

    const stopPromise = client.stop();
    workers[0].failCommand('stop');
    await assert.rejects(stopPromise, { code: 'FAKE_COMMAND_FAILED' });

    assert.equal(workers[0].terminated, true);
    assert.equal(client.getState().phase, 'inactive');
    assert.equal(client.getState().active, false);
});

test('an explicit start during stop waits and creates a fresh worker lifecycle', async () => {
    const workers = [];
    const client = new LiveCaptionsWorkerClient({
        createWorker() {
            const worker = new FakeWorker();
            workers.push(worker);
            return worker;
        }
    });

    const initialStart = client.start();
    workers[0].respondTo('start', {
        started: true,
        ownership: { owned: true, processId: 61 }
    });
    await initialStart;

    const stopPromise = client.stop();
    const nextStart = client.start();
    workers[0].respondTo('stop', {
        stopped: true,
        ownership: { owned: false, processId: 0 }
    });
    await stopPromise;
    await flushAsyncWork();

    assert.equal(workers.length, 2);
    workers[1].respondTo('start', {
        started: true,
        ownership: { owned: true, processId: 62 }
    });

    const state = await nextStart;
    assert.equal(state.active, true);
    assert.deepEqual(state.ownership, { owned: true, processId: 62 });
});

test('a failed restart marks the client inactive so explicit start sends a new start command', async () => {
    const workers = [];
    const client = new LiveCaptionsWorkerClient({
        createWorker() {
            const worker = new FakeWorker();
            workers.push(worker);
            return worker;
        }
    });

    const initialStart = client.start();
    workers[0].respondTo('start', {
        started: true,
        ownership: { owned: true, processId: 81 }
    });
    await initialStart;

    const restartPromise = client.restart();
    workers[0].failCommand('restart', 'LIVECAPTIONS_RESTART_FAILED');
    await assert.rejects(restartPromise, { code: 'LIVECAPTIONS_RESTART_FAILED' });
    assert.equal(client.getState().active, false);

    const retryStart = client.start();
    const startMessages = workers[0].messages.filter((message) => message.command === 'start');
    assert.equal(startMessages.length, 2);
    workers[0].emit('message', {
        type: 'response',
        requestId: startMessages[1].requestId,
        ok: true,
        result: {
            started: true,
            ownership: { owned: true, processId: 81 }
        }
    });

    assert.equal((await retryStart).active, true);
});

test('automatic replacement waits for the crashed worker thread to terminate', async () => {
    const workers = [];
    const client = new LiveCaptionsWorkerClient({
        createWorker() {
            const worker = new FakeWorker();
            workers.push(worker);
            return worker;
        }
    });
    client.on('error', () => {});

    const initialStart = client.start();
    workers[0].respondTo('start', {
        started: true,
        ownership: { owned: true, processId: 94 }
    });
    await initialStart;

    const terminationGate = deferred();
    workers[0].terminationGate = terminationGate;
    workers[0].emit('error', new Error('worker crashed'));
    await flushAsyncWork();

    assert.equal(workers.length, 1, 'replacement must not overlap the old native thread');

    terminationGate.resolve(1);
    await flushAsyncWork();
    assert.equal(workers.length, 2);
    workers[1].respondTo('start', {
        started: true,
        ownership: { owned: true, processId: 94 }
    });
    await flushAsyncWork();
    assert.equal(client.getState().active, true);
});

test('command timeouts use the one-restart crash budget and then require manual retry', async () => {
    const workers = [];
    const timers = createFakeTimers();
    const client = new LiveCaptionsWorkerClient({
        createWorker() {
            const worker = new FakeWorker();
            workers.push(worker);
            return worker;
        },
        setTimeoutFn: timers.setTimeoutFn,
        clearTimeoutFn: timers.clearTimeoutFn,
        commandTimeoutMs: 15000
    });
    const errors = [];
    client.on('error', (error) => errors.push(error));

    const startPromise = client.start();
    assert.equal(timers.runNext(), 15000);
    await flushAsyncWork();

    assert.equal(workers.length, 2);
    workers[1].respondTo('start', {
        started: true,
        ownership: { owned: true, processId: 105 }
    });
    assert.equal((await startPromise).active, true);
    assert.equal(timers.size, 0, 'successful response clears its timeout');

    const visibilityPromise = client.getVisibility();
    const visibilityRejection = assert.rejects(visibilityPromise, {
        code: 'LIVECAPTIONS_WORKER_COMMAND_TIMEOUT'
    });
    timers.runNext();
    await visibilityRejection;
    await flushAsyncWork();

    assert.equal(workers.length, 2, 'second timeout does not create another worker');
    assert.equal(errors.length, 1);
    assert.equal(errors[0].code, 'LIVECAPTIONS_WORKER_MANUAL_RETRY');
    assert.equal(client.getState().manualRetryRequired, true);
});

test('close timeout terminates the worker and settles without automatic restart', async () => {
    const workers = [];
    const timers = createFakeTimers();
    const client = new LiveCaptionsWorkerClient({
        createWorker() {
            const worker = new FakeWorker();
            workers.push(worker);
            return worker;
        },
        setTimeoutFn: timers.setTimeoutFn,
        clearTimeoutFn: timers.clearTimeoutFn,
        commandTimeoutMs: 15000
    });

    const startPromise = client.start();
    workers[0].respondTo('start', {
        started: true,
        ownership: { owned: true, processId: 106 }
    });
    await startPromise;

    const closePromise = client.close();
    const closeRejection = assert.rejects(closePromise, {
        code: 'LIVECAPTIONS_WORKER_COMMAND_TIMEOUT'
    });
    timers.runNext();
    await closeRejection;

    assert.equal(workers[0].terminated, true);
    assert.equal(workers.length, 1);
    assert.equal(client.getState().phase, 'inactive');
});

test('manual retry after the second crash waits for native teardown', async () => {
    const workers = [];
    const client = new LiveCaptionsWorkerClient({
        createWorker() {
            const worker = new FakeWorker();
            workers.push(worker);
            return worker;
        }
    });
    client.on('error', () => {});

    const initialStart = client.start();
    workers[0].respondTo('start', {
        started: true,
        ownership: { owned: true, processId: 107 }
    });
    await initialStart;

    workers[0].emit('exit', 1);
    await flushAsyncWork();
    workers[1].respondTo('start', {
        started: true,
        ownership: { owned: true, processId: 107 }
    });
    await flushAsyncWork();

    const secondTermination = deferred();
    workers[1].terminationGate = secondTermination;
    workers[1].emit('exit', 2);
    await flushAsyncWork();
    assert.equal(client.getState().manualRetryRequired, true);

    const retryStart = client.start();
    await flushAsyncWork();
    assert.equal(workers.length, 2, 'manual retry must wait for second worker teardown');

    secondTermination.resolve(2);
    await flushAsyncWork();
    assert.equal(workers.length, 3);
    workers[2].respondTo('start', {
        started: true,
        ownership: { owned: true, processId: 107 }
    });
    assert.equal((await retryStart).active, true);
});

test('default command deadline covers attach, exact-exit cleanup, and retry', () => {
    assert.ok(
        DEFAULT_COMMAND_TIMEOUT_MS >= 30000,
        '5s attach + 5s cleanup reattach + 2s HWND + 2s exit grace + 2s terminate wait + 400ms delay + 5s retry needs margin'
    );
});

test('close creates a cleanup-only worker when ownership responses were lost', async () => {
    const workers = [];
    const client = new LiveCaptionsWorkerClient({
        createWorker() {
            const worker = new FakeWorker();
            workers.push(worker);
            return worker;
        }
    });

    const closePromise = client.close();
    assert.equal(workers.length, 1);
    assert.deepEqual(
        workers[0].messages.map((message) => message.command),
        ['close'],
        'cleanup worker must not launch Live Captions during shutdown'
    );
    workers[0].respondTo('close', {
        closed: true,
        ownership: { owned: false, processId: 0 }
    });

    assert.equal((await closePromise).closed, true);
    assert.equal(workers[0].terminated, true);
});

test('workerless stop uses cleanup-only close when all ownership responses were lost', async () => {
    const workers = [];
    const client = new LiveCaptionsWorkerClient({
        createWorker() {
            const worker = new FakeWorker();
            workers.push(worker);
            return worker;
        }
    });

    const stopPromise = client.stop();
    assert.equal(workers.length, 1);
    assert.deepEqual(
        workers[0].messages.map((message) => message.command),
        ['close'],
        'native registry cleanup must not depend on client ownership metadata'
    );
    workers[0].respondTo('close', {
        closed: true,
        ownership: { owned: false, processId: 0 }
    });

    assert.deepEqual(await stopPromise, {
        stopped: true,
        ownership: { owned: false, processId: 0 }
    });
    assert.equal(workers[0].terminated, true);
});
