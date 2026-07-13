const test = require('node:test');
const assert = require('node:assert/strict');
const EventEmitter = require('node:events');

const { CaptionSyncService } = require('../src/captionSync');

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
    assert.deepEqual(workerClient.calls, ['start', 'restart', 'getVisibility']);
    assert.deepEqual(clearResult, {
        success: true,
        liveCaptionsVisible: false
    });
});

test('three consecutive unavailable reads emit one recoverable episode and success resets it', async () => {
    const workerClient = new FakeWorkerClient();
    const service = new CaptionSyncService({ workerClient });
    const errors = [];
    service.on('error', (error) => errors.push(error));
    await service.start();

    const unavailable = {
        status: 'unavailable',
        code: 'CAPTIONS_ELEMENT_UNAVAILABLE',
        message: 'caption element missing'
    };

    workerClient.emit('snapshot', unavailable);
    workerClient.emit('snapshot', unavailable);
    assert.equal(errors.length, 0);
    workerClient.emit('snapshot', unavailable);
    workerClient.emit('snapshot', unavailable);

    assert.equal(errors.length, 1);
    assert.equal(errors[0].source, 'live-captions');
    assert.equal(errors[0].code, 'CAPTIONS_ELEMENT_UNAVAILABLE');
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

test('a failed Clear restart allows a later explicit source start', async () => {
    const workerClient = new FakeWorkerClient();
    const originalRestart = workerClient.restart;
    let restartAttempts = 0;
    workerClient.restart = async function restart() {
        this.calls.push('restart');
        restartAttempts += 1;
        if (restartAttempts === 1) {
            const error = new Error('native restart failed');
            error.code = 'LIVECAPTIONS_RESTART_FAILED';
            throw error;
        }
        return originalRestart.call(this);
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
    assert.deepEqual(workerClient.calls, ['start', 'restart', 'start', 'restart', 'restart']);
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

test('source switching rotates a Live Captions session and establishes a fresh native boundary before resume', async () => {
    const workerClient = new FakeWorkerClient();
    const service = new CaptionSyncService({
        workerClient,
        createSessionId: createSessionIdSequence()
    });

    const firstSessionId = service.getSessionId();
    await service.start();
    service.beginNewSession({ requireFreshBoundary: true });
    await service.stop();
    const resumed = await service.start();

    assert.equal(firstSessionId, 'caption-session-1');
    assert.equal(service.getSessionId(), 'caption-session-2');
    assert.equal(resumed, true);
    assert.equal(service.getState().requiresFreshSessionBoundary, false);
    assert.deepEqual(workerClient.calls, ['start', 'stop', 'start', 'restart']);
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
