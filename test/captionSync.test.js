const test = require('node:test');
const assert = require('node:assert/strict');
const EventEmitter = require('node:events');

const { CaptionSyncService } = require('../src/captionSync');
const {
    getCaptionSyncErrorLifecycleState
} = require('../src/captionSyncErrorState');

class FakeWorkerClient extends EventEmitter {
    constructor() {
        super();
        this.calls = [];
    }

    async start() {
        this.calls.push('start');
        return { active: true };
    }

    async stop() {
        this.calls.push('stop');
        return { active: false };
    }

    async close() {
        this.calls.push('close');
        return { closed: true };
    }

    async restart() {
        this.calls.push('restart');
        return { restarted: true };
    }

    async getVisibility() {
        this.calls.push('getVisibility');
        return false;
    }

    async setVisibility(visible) {
        this.calls.push(['setVisibility', visible]);
        return visible;
    }
}

function createSessionIdSequence() {
    let nextId = 0;
    return () => {
        nextId += 1;
        return `caption-session-${nextId}`;
    };
}

test('empty successful and unavailable reads preserve accumulated transcript; explicit Clear resets it', async () => {
    const workerClient = new FakeWorkerClient();
    const service = new CaptionSyncService({ workerClient });
    const updates = [];
    const errors = [];
    service.on('captionUpdate', (update) => updates.push(update));
    service.on('error', (error) => errors.push(error));

    await service.start();
    workerClient.emit('snapshot', { status: 'ok', text: 'Retained interview transcript' });
    workerClient.emit('snapshot', { status: 'ok', text: '' });
    workerClient.emit('snapshot', {
        status: 'unavailable',
        code: 'CAPTIONS_READ_FAILED',
        message: 'read failed'
    });

    assert.deepEqual(updates, [{ fullText: 'Retained interview transcript' }]);
    assert.equal(errors.length, 0);

    const clearResult = await service.clearTranscript();

    assert.deepEqual(updates.at(-1), { fullText: '', entries: [] });
    assert.deepEqual(workerClient.calls, ['start', 'close', 'start', 'getVisibility']);
    assert.deepEqual(clearResult, {
        success: true,
        liveCaptionsVisible: false
    });
});

test('visibility controls start Live Captions when called during renderer startup', async () => {
    const workerClient = new FakeWorkerClient();
    const service = new CaptionSyncService({ workerClient });

    assert.equal(await service.getLiveCaptionsVisibility(), false);
    assert.deepEqual(workerClient.calls, ['start', 'getVisibility']);

    assert.equal(await service.setLiveCaptionsVisibility(true), true);
    assert.deepEqual(workerClient.calls, ['start', 'getVisibility', ['setVisibility', true]]);
});

test('starting an already-running Live Captions source closes it before relaunching', async () => {
    const workerClient = new FakeWorkerClient();
    const service = new CaptionSyncService({ workerClient });

    assert.equal(await service.start(), true);
    assert.equal(await service.start(), true);

    assert.deepEqual(workerClient.calls, ['start', 'close', 'start']);
});

test('recoverable read errors keep an active Live Captions source active', () => {
    const state = getCaptionSyncErrorLifecycleState({
        code: 'LIVECAPTIONS_ELEMENT_UNAVAILABLE',
        message: 'The Live Captions text element is unavailable.',
        recoverable: true
    }, {
        phase: 'active',
        active: true,
        sessionId: 'caption-session-1',
        retryAttempt: 0
    });

    assert.deepEqual(state, {
        phase: 'active',
        active: true,
        sessionId: 'caption-session-1',
        retryAttempt: 0,
        error: 'The Live Captions text element is unavailable.',
        reason: 'LIVECAPTIONS_ELEMENT_UNAVAILABLE'
    });
});

test('missing Live Captions text element before the first caption is treated as idle startup', async () => {
    const workerClient = new FakeWorkerClient();
    const service = new CaptionSyncService({ workerClient });
    const errors = [];
    service.on('error', (error) => errors.push(error));
    await service.start();

    const unavailable = {
        status: 'unavailable',
        code: 'LIVECAPTIONS_ELEMENT_UNAVAILABLE',
        message: 'The Live Captions text element is unavailable.'
    };

    workerClient.emit('snapshot', unavailable);
    workerClient.emit('snapshot', unavailable);
    workerClient.emit('snapshot', unavailable);
    workerClient.emit('snapshot', unavailable);

    assert.equal(errors.length, 0);
});

test('missing Live Captions text element after captions were visible still reports a recoverable episode', async () => {
    const workerClient = new FakeWorkerClient();
    const service = new CaptionSyncService({ workerClient });
    const errors = [];
    service.on('error', (error) => errors.push(error));
    await service.start();

    workerClient.emit('snapshot', { status: 'ok', text: 'Visible caption text.' });
    const unavailable = {
        status: 'unavailable',
        code: 'LIVECAPTIONS_ELEMENT_UNAVAILABLE',
        message: 'The Live Captions text element is unavailable.'
    };

    workerClient.emit('snapshot', unavailable);
    workerClient.emit('snapshot', unavailable);
    workerClient.emit('snapshot', unavailable);

    assert.equal(errors.length, 1);
    assert.equal(errors[0].source, 'live-captions');
    assert.equal(errors[0].code, 'LIVECAPTIONS_ELEMENT_UNAVAILABLE');
    assert.equal(errors[0].recoverable, true);
});

test('three consecutive unavailable reads emit one recoverable episode and success resets it', async () => {
    const workerClient = new FakeWorkerClient();
    const service = new CaptionSyncService({ workerClient });
    const errors = [];
    service.on('error', (error) => errors.push(error));
    await service.start();

    const unavailable = {
        status: 'unavailable',
        code: 'LIVECAPTIONS_READ_FAILED',
        message: 'caption read failed'
    };

    workerClient.emit('snapshot', unavailable);
    workerClient.emit('snapshot', unavailable);
    assert.equal(errors.length, 0);
    workerClient.emit('snapshot', unavailable);
    workerClient.emit('snapshot', unavailable);

    assert.equal(errors.length, 1);
    assert.equal(errors[0].source, 'live-captions');
    assert.equal(errors[0].code, 'LIVECAPTIONS_READ_FAILED');
    assert.equal(errors[0].recoverable, true);

    workerClient.emit('snapshot', { status: 'ok', text: '' });
    workerClient.emit('snapshot', unavailable);
    workerClient.emit('snapshot', unavailable);
    workerClient.emit('snapshot', unavailable);

    assert.equal(errors.length, 2, 'a later successful read resets the source-error episode');
});

test('worker manual-retry errors propagate without fabricating an empty transcript update', async () => {
    const workerClient = new FakeWorkerClient();
    const service = new CaptionSyncService({ workerClient });
    const updates = [];
    const errors = [];
    service.on('captionUpdate', (update) => updates.push(update));
    service.on('error', (error) => errors.push(error));

    await service.start();
    workerClient.emit('snapshot', { status: 'ok', text: 'Keep this transcript' });
    const workerError = new Error('Live Captions worker stopped; retry manually.');
    workerError.code = 'LIVECAPTIONS_WORKER_MANUAL_RETRY';
    workerError.recoverable = true;
    workerClient.emit('error', workerError);

    assert.deepEqual(updates, [{ fullText: 'Keep this transcript' }]);
    assert.deepEqual(errors, [workerError]);
});

test('a failed Clear relaunch allows a later explicit source start', async () => {
    const workerClient = new FakeWorkerClient();
    let startAttempts = 0;
    workerClient.start = async function start() {
        this.calls.push('start');
        startAttempts += 1;
        if (startAttempts === 2) {
            const error = new Error('native relaunch failed');
            error.code = 'LIVECAPTIONS_RELAUNCH_FAILED';
            throw error;
        }
        return { active: true };
    };
    const service = new CaptionSyncService({ workerClient });
    service.on('error', () => {});

    await service.start();
    const result = await service.clearTranscript();
    const restarted = await service.start();

    assert.deepEqual(result, {
        success: false,
        liveCaptionsVisible: null
    });
    assert.equal(restarted, true);
    assert.deepEqual(workerClient.calls, ['start', 'close', 'start', 'start']);
});

test('Clear baseline snapshots never restore old text and remain cumulative after rolling overlap', async () => {
    const workerClient = new FakeWorkerClient();
    const service = new CaptionSyncService({ workerClient });
    const updates = [];
    service.on('captionUpdate', (update) => updates.push(update));
    service.on('error', () => {});

    await service.start();
    workerClient.emit('snapshot', { status: 'ok', text: 'Old question. Old details.' });
    await service.clearTranscript();
    workerClient.emit('snapshot', { status: 'ok', text: '' });
    workerClient.emit('snapshot', { status: 'ok', text: ' New answer.' });
    workerClient.emit('snapshot', { status: 'ok', text: ' New answer. More detail.' });

    assert.deepEqual(updates, [
        { fullText: 'Old question. Old details.' },
        { fullText: '', entries: [] },
        { fullText: ' New answer.' },
        { fullText: ' New answer. More detail.' }
    ]);
});

test('source switching rotates a Live Captions session and relaunches before resume', async () => {
    const workerClient = new FakeWorkerClient();
    const service = new CaptionSyncService({
        workerClient,
        createSessionId: createSessionIdSequence()
    });

    const firstSessionId = service.getSessionId();
    await service.start();
    workerClient.emit('snapshot', { status: 'ok', text: 'Previous Live Captions text.' });
    service.beginNewSession({ requireFreshBoundary: true });
    await service.stop();
    const resumed = await service.start();

    assert.equal(firstSessionId, 'caption-session-1');
    assert.equal(service.getSessionId(), 'caption-session-2');
    assert.equal(resumed, true);
    assert.equal(service.getState().requiresFreshSessionBoundary, false);
    assert.deepEqual(workerClient.calls, ['start', 'stop', 'close', 'start']);
});

test('source switching before any Live Captions text resumes without forcing a clear boundary', async () => {
    const workerClient = new FakeWorkerClient();
    workerClient.restart = async function restart() {
        this.calls.push('restart');
        const error = new Error('Live Captions Clear could not establish a fresh transcript boundary.');
        error.code = 'LIVECAPTIONS_CLEAR_BASELINE_UNAVAILABLE';
        throw error;
    };
    const service = new CaptionSyncService({
        workerClient,
        createSessionId: createSessionIdSequence()
    });
    const errors = [];
    service.on('error', (error) => errors.push(error));

    await service.start();
    service.beginNewSession({ requireFreshBoundary: true });
    await service.stop();
    service.beginNewSession({ requireFreshBoundary: true });
    const resumed = await service.start();

    assert.equal(resumed, true);
    assert.equal(service.getState().requiresFreshSessionBoundary, false);
    assert.deepEqual(errors, []);
    assert.deepEqual(workerClient.calls, ['start', 'stop', 'start']);
});

test('ordinary Stop and resume preserve the current Live Captions session without restarting its boundary', async () => {
    const workerClient = new FakeWorkerClient();
    const service = new CaptionSyncService({
        workerClient,
        createSessionId: createSessionIdSequence()
    });

    await service.start();
    const sessionId = service.getSessionId();
    await service.stop();
    await service.start();

    assert.equal(service.getSessionId(), sessionId);
    assert.deepEqual(workerClient.calls, ['start', 'stop', 'start']);
});
