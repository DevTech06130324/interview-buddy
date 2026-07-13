const test = require('node:test');
const assert = require('node:assert/strict');

const {
    LiveCaptionsWorkerRuntime,
    normalizeCheckpoint
} = require('../src/liveCaptionsWorker');

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
            assert.ok(next, 'expected a scheduled worker poll');
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

function responseFor(messages, requestId) {
    return messages.find((message) => (
        message.type === 'response' && message.requestId === requestId
    ));
}

function checkpointMessages(messages) {
    return messages.filter((message) => message.type === 'checkpoint');
}

test('checkpoint normalization produces the exact canonical data-only schema', () => {
    assert.deepEqual(normalizeCheckpoint({
        clearSessionActive: true,
        clearBaselineText: 42,
        postClearText: null,
        lastSuccessfulRawText: 'Current raw text',
        ownership: { owned: true, processId: 91 },
        processId: 91
    }), {
        clearSessionActive: true,
        clearBaselineText: '',
        postClearText: '',
        lastSuccessfulRawText: 'Current raw text'
    });
});

test('a successful raw poll emits a canonical checkpoint', async () => {
    const handler = {
        async initialize() {
            return true;
        },
        async launchLiveCaptions() {
            return { success: true, ownership: { owned: false, processId: 44 } };
        },
        getCaptions() {
            return { status: 'ok', text: 'Interview question' };
        }
    };
    const timers = createFakeTimers();
    const messages = [];
    const runtime = new LiveCaptionsWorkerRuntime({
        handler,
        postMessage: (message) => messages.push(message),
        setTimeoutFn: timers.setTimeoutFn,
        clearTimeoutFn: timers.clearTimeoutFn
    });

    await runtime.handleMessage({ type: 'command', requestId: 1, command: 'start' });
    timers.runNext();

    assert.deepEqual(checkpointMessages(messages).at(-1), {
        type: 'checkpoint',
        checkpoint: {
            clearSessionActive: false,
            clearBaselineText: '',
            postClearText: '',
            lastSuccessfulRawText: 'Interview question'
        }
    });
});

test('Clear emits an active fresh-boundary checkpoint before native restart', async () => {
    const baseline = 'Old question. Late old detail.';
    const messages = [];
    let checkpointBeforeRestart = null;
    const handler = {
        async initialize() {
            return true;
        },
        async launchLiveCaptions() {
            return { success: true, ownership: { owned: false, processId: 52 } };
        },
        async restartLiveCaptions() {
            checkpointBeforeRestart = messages.at(-1);
            return { success: true, ownership: { owned: false, processId: 52 } };
        },
        getCaptions() {
            return { status: 'ok', text: baseline };
        }
    };
    const timers = createFakeTimers();
    const runtime = new LiveCaptionsWorkerRuntime({
        handler,
        postMessage: (message) => messages.push(message),
        setTimeoutFn: timers.setTimeoutFn,
        clearTimeoutFn: timers.clearTimeoutFn
    });

    await runtime.handleMessage({ type: 'command', requestId: 1, command: 'start' });
    await runtime.handleMessage({ type: 'command', requestId: 2, command: 'restart' });

    assert.deepEqual(checkpointBeforeRestart, {
        type: 'checkpoint',
        checkpoint: {
            clearSessionActive: true,
            clearBaselineText: baseline,
            postClearText: '',
            lastSuccessfulRawText: baseline
        }
    });
});

test('start restores an active Clear checkpoint after native attach without resetting it', async () => {
    const checkpoint = {
        clearSessionActive: true,
        clearBaselineText: 'Old question. New answer.',
        postClearText: ' New answer.',
        lastSuccessfulRawText: 'Old question. New answer.'
    };
    const handler = {
        async initialize() {
            return true;
        },
        async launchLiveCaptions() {
            return { success: true, ownership: { owned: false, processId: 52 } };
        },
        getCaptions() {
            return { status: 'ok', text: 'New answer. More detail.' };
        }
    };
    const timers = createFakeTimers();
    const messages = [];
    const runtime = new LiveCaptionsWorkerRuntime({
        handler,
        postMessage: (message) => messages.push(message),
        setTimeoutFn: timers.setTimeoutFn,
        clearTimeoutFn: timers.clearTimeoutFn
    });

    await runtime.handleMessage({
        type: 'command',
        requestId: 1,
        command: 'start',
        payload: { checkpoint }
    });
    timers.runNext();

    assert.deepEqual(
        messages.find((message) => message.type === 'snapshot'),
        {
            type: 'snapshot',
            snapshot: { status: 'ok', text: ' New answer. More detail.' }
        }
    );
    assert.deepEqual(checkpointMessages(messages).at(-1)?.checkpoint, {
        clearSessionActive: true,
        clearBaselineText: checkpoint.clearBaselineText,
        postClearText: ' New answer. More detail.',
        lastSuccessfulRawText: 'New answer. More detail.'
    });
});

test('projected post-Clear text advancement emits an updated checkpoint', async () => {
    const baseline = 'Old question.';
    const snapshots = [
        { status: 'ok', text: baseline },
        { status: 'ok', text: `${baseline} New answer.` }
    ];
    const handler = {
        async initialize() {
            return true;
        },
        async launchLiveCaptions() {
            return { success: true, ownership: { owned: false, processId: 53 } };
        },
        async restartLiveCaptions() {
            return { success: true, ownership: { owned: false, processId: 53 } };
        },
        getCaptions() {
            return snapshots.shift();
        }
    };
    const timers = createFakeTimers();
    const messages = [];
    const runtime = new LiveCaptionsWorkerRuntime({
        handler,
        postMessage: (message) => messages.push(message),
        setTimeoutFn: timers.setTimeoutFn,
        clearTimeoutFn: timers.clearTimeoutFn
    });

    await runtime.handleMessage({ type: 'command', requestId: 1, command: 'start' });
    await runtime.handleMessage({ type: 'command', requestId: 2, command: 'restart' });
    const checkpointCountBeforePoll = checkpointMessages(messages).length;
    timers.runNext();

    assert.ok(checkpointMessages(messages).length > checkpointCountBeforePoll);
    assert.deepEqual(checkpointMessages(messages).at(-1)?.checkpoint, {
        clearSessionActive: true,
        clearBaselineText: baseline,
        postClearText: ' New answer.',
        lastSuccessfulRawText: `${baseline} New answer.`
    });
});

test('intentional stop emits a reset checkpoint after native cleanup', async () => {
    const messages = [];
    let cleanupFinished = false;
    const handler = {
        async initialize() {
            return true;
        },
        async launchLiveCaptions() {
            return { success: true, ownership: { owned: false, processId: 54 } };
        },
        async cleanup() {
            cleanupFinished = true;
            return { ownership: { owned: false, processId: 0 } };
        }
    };
    const runtime = new LiveCaptionsWorkerRuntime({
        handler,
        postMessage: (message) => messages.push(message),
        setTimeoutFn() {
            return 1;
        },
        clearTimeoutFn() {}
    });

    await runtime.handleMessage({
        type: 'command',
        requestId: 1,
        command: 'start',
        payload: {
            checkpoint: {
                clearSessionActive: true,
                clearBaselineText: 'Old question.',
                postClearText: ' New answer.',
                lastSuccessfulRawText: 'Old question. New answer.'
            }
        }
    });
    await runtime.handleMessage({ type: 'command', requestId: 2, command: 'stop' });

    assert.equal(cleanupFinished, true);
    assert.deepEqual(checkpointMessages(messages).at(-1), {
        type: 'checkpoint',
        checkpoint: {
            clearSessionActive: false,
            clearBaselineText: '',
            postClearText: '',
            lastSuccessfulRawText: ''
        }
    });
});

test('worker runtime alone launches and polls the native handler', async () => {
    const calls = [];
    const snapshots = [
        { status: 'ok', text: 'Interview question' },
        {
            status: 'unavailable',
            code: 'CAPTIONS_READ_FAILED',
            message: 'The Live Captions text could not be read.'
        }
    ];
    const handler = {
        async initialize() {
            calls.push('initialize');
            return true;
        },
        async launchLiveCaptions(...args) {
            calls.push(['launch', args]);
            return {
                success: true,
                ownership: { owned: true, processId: 91 }
            };
        },
        getCaptions() {
            calls.push('poll');
            return snapshots.shift();
        }
    };
    const timers = createFakeTimers();
    const messages = [];
    const runtime = new LiveCaptionsWorkerRuntime({
        handler,
        postMessage: (message) => messages.push(message),
        setTimeoutFn: timers.setTimeoutFn,
        clearTimeoutFn: timers.clearTimeoutFn,
        activePollInterval: 60,
        idlePollInterval: 180,
        idleThreshold: 10
    });

    await runtime.handleMessage({
        type: 'command',
        requestId: 1,
        command: 'start',
        payload: { ownership: { owned: false, processId: 0 } }
    });

    assert.deepEqual(calls.slice(0, 2), [
        'initialize',
        ['launch', []]
    ]);
    assert.deepEqual(responseFor(messages, 1), {
        type: 'response',
        requestId: 1,
        ok: true,
        result: {
            started: true,
            ownership: { owned: true, processId: 91 }
        }
    });

    assert.equal(timers.runNext(), 60);
    assert.deepEqual(messages.at(-1), {
        type: 'snapshot',
        snapshot: { status: 'ok', text: 'Interview question' }
    });

    assert.equal(timers.runNext(), 60);
    assert.deepEqual(messages.at(-1), {
        type: 'snapshot',
        snapshot: {
            status: 'unavailable',
            code: 'CAPTIONS_READ_FAILED',
            message: 'The Live Captions text could not be read.'
        }
    });
});

test('worker runtime serializes restart, visibility, stop, and close commands', async () => {
    const calls = [];
    const handler = {
        async initialize() {
            calls.push('initialize');
            return true;
        },
        async launchLiveCaptions() {
            calls.push('launch');
            return { success: true, ownership: { owned: false, processId: 44 } };
        },
        async restartLiveCaptions() {
            calls.push('restart');
            return { success: true, ownership: { owned: true, processId: 45 } };
        },
        async isWindowVisible() {
            calls.push('get-visible');
            return false;
        },
        async setWindowVisibility(visible) {
            calls.push(['set-visible', visible]);
            return visible;
        },
        async cleanup() {
            calls.push('stop');
            return { ownership: { owned: false, processId: 0 } };
        },
        async closeLiveCaptions() {
            calls.push('close');
            return { closed: true, ownership: { owned: false, processId: 0 } };
        },
        getCaptions() {
            return { status: 'ok', text: '' };
        }
    };
    const timers = createFakeTimers();
    const messages = [];
    const runtime = new LiveCaptionsWorkerRuntime({
        handler,
        postMessage: (message) => messages.push(message),
        setTimeoutFn: timers.setTimeoutFn,
        clearTimeoutFn: timers.clearTimeoutFn
    });

    const command = async (requestId, name, payload = {}) => {
        await runtime.handleMessage({
            type: 'command',
            requestId,
            command: name,
            payload
        });
        const response = responseFor(messages, requestId);
        assert.equal(response.ok, true, `${name} should succeed`);
        return response.result;
    };

    await command(1, 'start');
    assert.deepEqual(await command(2, 'getVisibility'), { visible: false });
    assert.deepEqual(await command(3, 'setVisibility', { visible: true }), { visible: true });
    assert.deepEqual(await command(4, 'restart'), {
        restarted: true,
        ownership: { owned: true, processId: 45 }
    });
    assert.equal(timers.size, 1, 'restart leaves one poll scheduled');
    await command(5, 'stop');
    assert.equal(timers.size, 0, 'stop cancels polling');
    await command(6, 'close');

    assert.deepEqual(calls, [
        'initialize',
        'launch',
        'get-visible',
        ['set-visible', true],
        'restart',
        'stop',
        'close'
    ]);
});

test('failed restart leaves polling stopped so a later start relaunches the handler', async () => {
    let launchCount = 0;
    let restartCount = 0;
    const handler = {
        ownership: { owned: true, processId: 70 },
        async initialize() {
            return true;
        },
        async launchLiveCaptions() {
            launchCount += 1;
            return { success: true, ownership: { owned: true, processId: 70 } };
        },
        async restartLiveCaptions() {
            restartCount += 1;
            throw new Error('native restart failed');
        },
        getCaptions() {
            return { status: 'ok', text: '' };
        }
    };
    const timers = createFakeTimers();
    const messages = [];
    const runtime = new LiveCaptionsWorkerRuntime({
        handler,
        postMessage: (message) => messages.push(message),
        setTimeoutFn: timers.setTimeoutFn,
        clearTimeoutFn: timers.clearTimeoutFn
    });

    await runtime.handleMessage({ type: 'command', requestId: 1, command: 'start' });
    await runtime.handleMessage({ type: 'command', requestId: 2, command: 'restart' });

    assert.equal(responseFor(messages, 2).ok, false);
    assert.equal(timers.size, 0);

    await runtime.handleMessage({ type: 'command', requestId: 3, command: 'start' });

    assert.equal(responseFor(messages, 3).ok, true);
    assert.equal(launchCount, 2);
    assert.equal(restartCount, 1);
    assert.equal(timers.size, 1);
});

test('unowned Clear baselines unchanged, appended, and rolling native text cumulatively', async () => {
    const baseline = 'Old question. Old details.';
    const snapshots = [
        { status: 'ok', text: baseline },
        { status: 'ok', text: baseline },
        { status: 'ok', text: baseline },
        { status: 'ok', text: `${baseline} New answer.` },
        { status: 'ok', text: 'Old details. New answer. More detail.' },
        { status: 'ok', text: 'New answer. More detail. Next step.' }
    ];
    const handler = {
        async initialize() {
            return true;
        },
        async launchLiveCaptions() {
            return { success: true, ownership: { owned: false, processId: 44 } };
        },
        async restartLiveCaptions() {
            return { success: true, ownership: { owned: false, processId: 44 } };
        },
        getCaptions() {
            return snapshots.shift();
        }
    };
    const timers = createFakeTimers();
    const messages = [];
    const runtime = new LiveCaptionsWorkerRuntime({
        handler,
        postMessage: (message) => messages.push(message),
        setTimeoutFn: timers.setTimeoutFn,
        clearTimeoutFn: timers.clearTimeoutFn
    });

    await runtime.handleMessage({ type: 'command', requestId: 1, command: 'start' });
    timers.runNext();
    await runtime.handleMessage({ type: 'command', requestId: 2, command: 'restart' });
    timers.runNext();
    timers.runNext();
    timers.runNext();
    timers.runNext();

    const texts = messages
        .filter((message) => message.type === 'snapshot')
        .map((message) => message.snapshot.text);
    assert.deepEqual(texts, [
        baseline,
        '',
        ' New answer.',
        ' New answer. More detail.',
        ' New answer. More detail. Next step.'
    ]);
    assert.deepEqual(responseFor(messages, 2).result.ownership, {
        owned: false,
        processId: 44
    });
});

test('Clear before the first poll captures a fresh raw boundary', async () => {
    const baseline = 'Already visible before polling.';
    const snapshots = [
        { status: 'ok', text: baseline },
        { status: 'ok', text: baseline },
        { status: 'ok', text: `${baseline} New words.` }
    ];
    const handler = {
        async initialize() {
            return true;
        },
        async launchLiveCaptions() {
            return { success: true, ownership: { owned: false, processId: 51 } };
        },
        async restartLiveCaptions() {
            return { success: true, ownership: { owned: false, processId: 51 } };
        },
        getCaptions() {
            return snapshots.shift();
        }
    };
    const timers = createFakeTimers();
    const messages = [];
    const runtime = new LiveCaptionsWorkerRuntime({
        handler,
        postMessage: (message) => messages.push(message),
        setTimeoutFn: timers.setTimeoutFn,
        clearTimeoutFn: timers.clearTimeoutFn
    });

    await runtime.handleMessage({ type: 'command', requestId: 1, command: 'start' });
    await runtime.handleMessage({ type: 'command', requestId: 2, command: 'restart' });
    timers.runNext();
    timers.runNext();

    assert.deepEqual(
        messages.filter((message) => message.type === 'snapshot').map((message) => message.snapshot.text),
        ['', ' New words.']
    );
});

test('Clear includes text arriving between polls in its fresh boundary', async () => {
    const snapshots = [
        { status: 'ok', text: 'Old question.' },
        { status: 'ok', text: 'Old question. Late old detail.' },
        { status: 'ok', text: 'Old question. Late old detail.' },
        { status: 'ok', text: 'Old question. Late old detail. New answer.' }
    ];
    const handler = {
        async initialize() {
            return true;
        },
        async launchLiveCaptions() {
            return { success: true, ownership: { owned: false, processId: 52 } };
        },
        async restartLiveCaptions() {
            return { success: true, ownership: { owned: false, processId: 52 } };
        },
        getCaptions() {
            return snapshots.shift();
        }
    };
    const timers = createFakeTimers();
    const messages = [];
    const runtime = new LiveCaptionsWorkerRuntime({
        handler,
        postMessage: (message) => messages.push(message),
        setTimeoutFn: timers.setTimeoutFn,
        clearTimeoutFn: timers.clearTimeoutFn
    });

    await runtime.handleMessage({ type: 'command', requestId: 1, command: 'start' });
    timers.runNext();
    await runtime.handleMessage({ type: 'command', requestId: 2, command: 'restart' });
    timers.runNext();
    timers.runNext();

    assert.deepEqual(
        messages.filter((message) => message.type === 'snapshot').map((message) => message.snapshot.text),
        ['Old question.', '', ' New answer.']
    );
});

test('Clear fails closed when a fresh raw boundary is unavailable', async () => {
    let restartCount = 0;
    const handler = {
        async initialize() {
            return true;
        },
        async launchLiveCaptions() {
            return { success: true, ownership: { owned: false, processId: 53 } };
        },
        async restartLiveCaptions() {
            restartCount += 1;
            return { success: true, ownership: { owned: false, processId: 53 } };
        },
        getCaptions() {
            return {
                status: 'unavailable',
                code: 'LIVECAPTIONS_READ_FAILED',
                message: 'boundary unavailable'
            };
        }
    };
    const timers = createFakeTimers();
    const messages = [];
    const runtime = new LiveCaptionsWorkerRuntime({
        handler,
        postMessage: (message) => messages.push(message),
        setTimeoutFn: timers.setTimeoutFn,
        clearTimeoutFn: timers.clearTimeoutFn
    });

    await runtime.handleMessage({ type: 'command', requestId: 1, command: 'start' });
    await runtime.handleMessage({ type: 'command', requestId: 2, command: 'restart' });

    assert.equal(responseFor(messages, 2).ok, false);
    assert.equal(responseFor(messages, 2).error.code, 'LIVECAPTIONS_CLEAR_BASELINE_UNAVAILABLE');
    assert.equal(restartCount, 0);
    assert.equal(timers.size, 0);
});
