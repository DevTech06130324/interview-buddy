const EventEmitter = require('node:events');
const path = require('node:path');
const { Worker } = require('node:worker_threads');
const { normalizeCheckpoint } = require('./liveCaptionsClearCheckpoint');

const DEFAULT_COMMAND_TIMEOUT_MS = 30000;

function createDefaultWorker() {
    return new Worker(path.join(__dirname, 'liveCaptionsWorker.js'));
}

function normalizeOwnership(value) {
    const processId = Number.isInteger(value?.processId) && value.processId > 0
        ? value.processId
        : 0;
    return {
        owned: Boolean(value?.owned && processId),
        processId
    };
}

function responseError(payload) {
    const error = new Error(payload?.message || 'Live Captions worker command failed.');
    error.code = payload?.code || 'LIVECAPTIONS_WORKER_COMMAND_FAILED';
    return error;
}

class LiveCaptionsWorkerClient extends EventEmitter {
    constructor({
        createWorker = createDefaultWorker,
        setTimeoutFn = setTimeout,
        clearTimeoutFn = clearTimeout,
        commandTimeoutMs = DEFAULT_COMMAND_TIMEOUT_MS
    } = {}) {
        super();
        this.createWorker = createWorker;
        this.setTimeoutFn = setTimeoutFn;
        this.clearTimeoutFn = clearTimeoutFn;
        this.commandTimeoutMs = commandTimeoutMs;
        this.worker = null;
        this.handledWorkers = new WeakSet();
        this.pendingRequests = new Map();
        this.nextRequestId = 1;
        this.lifecycleRevision = 0;
        this.startPromise = null;
        this.recoveryPromise = null;
        this.finishPromise = null;
        this.workerTerminationPromise = null;
        this.active = false;
        this.desiredActive = false;
        this.phase = 'inactive';
        this.manualRetryRequired = false;
        this.crashCount = 0;
        this.ownership = { owned: false, processId: 0 };
        this.clearCheckpoint = normalizeCheckpoint();
    }

    getState() {
        return {
            phase: this.phase,
            active: this.active,
            manualRetryRequired: this.manualRetryRequired,
            crashCount: this.crashCount,
            retryAttempt: this.crashCount,
            ownership: { ...this.ownership }
        };
    }

    setPhase(phase) {
        if (this.phase === phase) {
            return this.getState();
        }

        this.phase = phase;
        const snapshot = this.getState();
        this.emit('state', snapshot);
        return snapshot;
    }

    async start() {
        if (this.finishPromise) {
            await this.finishPromise.catch(() => undefined);
        }
        if (this.workerTerminationPromise) {
            await this.workerTerminationPromise;
        }
        if (this.active && this.worker) {
            return this.getState();
        }
        if (this.startPromise) {
            return this.startPromise;
        }

        this.lifecycleRevision += 1;
        const revision = this.lifecycleRevision;
        this.desiredActive = true;
        this.manualRetryRequired = false;
        this.crashCount = 0;
        this.setPhase('starting');

        const startPromise = this.startForRevision(revision);
        this.startPromise = startPromise;
        try {
            return await startPromise;
        } finally {
            if (this.startPromise === startPromise) {
                this.startPromise = null;
            }
        }
    }

    async startForRevision(revision) {
        if (revision !== this.lifecycleRevision || !this.desiredActive) {
            return this.getState();
        }

        const worker = this.worker || this.spawnWorker();
        let result;
        try {
            result = await this.sendCommand(worker, 'start', {
                checkpoint: this.getClearCheckpoint()
            });
        } catch (error) {
            const recoveryPromise = this.recoveryPromise;
            if (
                recoveryPromise
                && revision === this.lifecycleRevision
                && this.desiredActive
                && this.crashCount === 1
            ) {
                await recoveryPromise;
                return this.getState();
            }
            throw error;
        }
        if (revision !== this.lifecycleRevision || worker !== this.worker || !this.desiredActive) {
            return this.getState();
        }

        this.updateOwnership(result?.ownership);
        this.active = Boolean(result?.started);
        this.setPhase(this.active ? 'active' : 'error');
        return this.getState();
    }

    async restart() {
        const worker = this.requireWorker();
        this.beginClearCheckpoint();
        try {
            const result = await this.sendCommand(worker, 'restart');
            this.updateOwnership(result?.ownership);
            return result;
        } catch (error) {
            this.active = false;
            this.setPhase('error');
            throw error;
        }
    }

    async getVisibility() {
        const result = await this.sendCommand(this.requireWorker(), 'getVisibility');
        return typeof result?.visible === 'boolean' ? result.visible : null;
    }

    async setVisibility(visible) {
        const result = await this.sendCommand(this.requireWorker(), 'setVisibility', {
            visible: Boolean(visible)
        });
        return typeof result?.visible === 'boolean' ? result.visible : null;
    }

    async stop() {
        return this.beginFinish('stop');
    }

    async close() {
        return this.beginFinish('close');
    }

    beginFinish(command) {
        if (this.finishPromise) {
            return this.finishPromise;
        }

        const finishPromise = this.finish(command);
        const trackedPromise = finishPromise.finally(() => {
            if (this.finishPromise === trackedPromise) {
                this.finishPromise = null;
            }
        });
        this.finishPromise = trackedPromise;
        return trackedPromise;
    }

    async finish(command) {
        this.lifecycleRevision += 1;
        this.desiredActive = false;
        this.active = false;
        this.manualRetryRequired = false;
        this.setPhase(command === 'close' ? 'closing' : 'stopping');

        let worker = this.worker;
        let result = command === 'close'
            ? { closed: false, ownership: this.ownership }
            : { stopped: true, ownership: this.ownership };
        try {
            if (!worker) {
                if (this.workerTerminationPromise) {
                    await this.workerTerminationPromise;
                }
                worker = this.worker;
            }
            let workerCommand = command;
            if (!worker) {
                worker = this.spawnWorker();
                workerCommand = 'close';
            }

            if (worker) {
                const workerResult = await this.sendCommand(worker, workerCommand);
                this.updateOwnership(workerResult?.ownership);
                this.resetClearCheckpoint();
                result = command === 'stop' && workerCommand === 'close'
                    ? { stopped: true, ownership: { ...this.ownership } }
                    : workerResult;
            } else if (command === 'close') {
                this.ownership = { owned: false, processId: 0 };
            }
            return result;
        } finally {
            if (worker) {
                await this.retireWorker(worker);
            }
            this.crashCount = 0;
            this.setPhase('inactive');
        }
    }

    requireWorker() {
        if (!this.worker) {
            const error = new Error('Live Captions worker is not running. Start it and retry.');
            error.code = 'LIVECAPTIONS_WORKER_NOT_RUNNING';
            throw error;
        }
        return this.worker;
    }

    spawnWorker() {
        const worker = this.createWorker();
        this.worker = worker;
        worker.on('message', (message) => this.handleMessage(worker, message));
        worker.on('error', (error) => this.handleWorkerFailure(worker, error));
        worker.on('exit', (code) => {
            if (code !== 0) {
                const error = new Error(`Live Captions worker exited with code ${code}.`);
                error.code = 'LIVECAPTIONS_WORKER_EXITED';
                this.handleWorkerFailure(worker, error);
            } else if (worker === this.worker && !this.handledWorkers.has(worker)) {
                const error = new Error('Live Captions worker exited unexpectedly.');
                error.code = 'LIVECAPTIONS_WORKER_EXITED';
                this.handleWorkerFailure(worker, error);
            }
        });
        return worker;
    }

    sendCommand(worker, command, payload = {}) {
        const requestId = this.nextRequestId;
        this.nextRequestId += 1;

        return new Promise((resolve, reject) => {
            const pending = {
                worker,
                resolve,
                reject,
                timeoutId: null
            };
            this.pendingRequests.set(requestId, pending);
            pending.timeoutId = this.setTimeoutFn(() => {
                if (this.pendingRequests.get(requestId) !== pending) {
                    return;
                }

                this.pendingRequests.delete(requestId);
                const error = new Error(
                    `Live Captions worker command "${command}" timed out after ${this.commandTimeoutMs} ms.`
                );
                error.code = 'LIVECAPTIONS_WORKER_COMMAND_TIMEOUT';
                error.source = 'live-captions';
                error.recoverable = true;
                reject(error);
                this.handleWorkerFailure(worker, error);
            }, this.commandTimeoutMs);
            try {
                worker.postMessage({
                    type: 'command',
                    requestId,
                    command,
                    payload
                });
            } catch (error) {
                this.clearPendingRequest(requestId, pending);
                reject(error);
            }
        });
    }

    handleMessage(worker, message) {
        if (worker !== this.worker || !message || typeof message !== 'object') {
            return;
        }

        if (message.type === 'snapshot') {
            this.emit('snapshot', message.snapshot);
            return;
        }

        if (message.type === 'checkpoint') {
            this.clearCheckpoint = normalizeCheckpoint(message.checkpoint);
            return;
        }

        if (message.type !== 'response' || !Number.isInteger(message.requestId)) {
            return;
        }

        const pending = this.pendingRequests.get(message.requestId);
        if (!pending || pending.worker !== worker) {
            return;
        }

        this.clearPendingRequest(message.requestId, pending);
        if (message.ok) {
            pending.resolve(message.result);
        } else {
            pending.reject(responseError(message.error));
        }
    }

    handleWorkerFailure(worker, error) {
        if (worker !== this.worker || this.handledWorkers.has(worker)) {
            return;
        }

        this.handledWorkers.add(worker);
        this.worker = null;
        this.active = false;
        this.rejectWorkerRequests(worker, error);
        const terminationPromise = Promise.resolve(worker.terminate?.()).catch(() => undefined);
        this.trackWorkerTermination(terminationPromise);

        if (!this.desiredActive) {
            this.setPhase('inactive');
            return;
        }

        this.crashCount += 1;
        const revision = this.lifecycleRevision;
        if (this.crashCount === 1) {
            this.setPhase('restarting');
            const recoveryPromise = this.restartAfterCrash(revision, terminationPromise);
            this.recoveryPromise = recoveryPromise;
            void recoveryPromise
                .catch((restartError) => {
                    if (
                        revision === this.lifecycleRevision
                        && this.desiredActive
                        && !this.manualRetryRequired
                    ) {
                        this.failForManualRetry(restartError);
                    }
                })
                .finally(() => {
                    if (this.recoveryPromise === recoveryPromise) {
                        this.recoveryPromise = null;
                    }
                });
            return;
        }

        this.failForManualRetry(error);
    }

    async restartAfterCrash(revision, terminationPromise) {
        await terminationPromise;
        if (revision !== this.lifecycleRevision || !this.desiredActive) {
            return;
        }

        const worker = this.spawnWorker();
        const result = await this.sendCommand(worker, 'start', {
            checkpoint: this.getClearCheckpoint()
        });
        if (revision !== this.lifecycleRevision || worker !== this.worker || !this.desiredActive) {
            return;
        }

        this.updateOwnership(result?.ownership);
        this.active = Boolean(result?.started);
        this.setPhase(this.active ? 'active' : 'error');
    }

    failForManualRetry(cause) {
        this.desiredActive = false;
        this.active = false;
        this.setPhase('error');
        this.manualRetryRequired = true;
        const error = new Error('Live Captions worker stopped after two crashes. Start Live Captions again to retry.');
        error.code = 'LIVECAPTIONS_WORKER_MANUAL_RETRY';
        error.source = 'live-captions';
        error.recoverable = true;
        error.cause = cause;
        if (this.listenerCount('error') > 0) {
            this.emit('error', error);
        }
    }

    rejectWorkerRequests(worker, error) {
        for (const [requestId, pending] of this.pendingRequests) {
            if (pending.worker !== worker) {
                continue;
            }
            this.clearPendingRequest(requestId, pending);
            pending.reject(error);
        }
    }

    clearPendingRequest(requestId, pending) {
        if (this.pendingRequests.get(requestId) === pending) {
            this.pendingRequests.delete(requestId);
        }
        if (pending.timeoutId !== null) {
            this.clearTimeoutFn(pending.timeoutId);
            pending.timeoutId = null;
        }
    }

    async retireWorker(worker) {
        if (worker === this.worker) {
            this.worker = null;
        }
        this.handledWorkers.add(worker);
        this.rejectWorkerRequests(worker, new Error('Live Captions worker was stopped.'));
        const terminationPromise = Promise.resolve(worker.terminate?.()).catch(() => undefined);
        this.trackWorkerTermination(terminationPromise);
        await terminationPromise;
    }

    trackWorkerTermination(terminationPromise) {
        this.workerTerminationPromise = terminationPromise;
        void terminationPromise.finally(() => {
            if (this.workerTerminationPromise === terminationPromise) {
                this.workerTerminationPromise = null;
            }
        });
    }

    updateOwnership(value) {
        if (value && typeof value === 'object') {
            this.ownership = normalizeOwnership(value);
        }
    }

    getClearCheckpoint() {
        return normalizeCheckpoint(this.clearCheckpoint);
    }

    beginClearCheckpoint() {
        const checkpoint = this.getClearCheckpoint();
        this.clearCheckpoint = normalizeCheckpoint({
            clearSessionActive: true,
            clearBaselineText: checkpoint.lastSuccessfulRawText,
            postClearText: '',
            lastSuccessfulRawText: checkpoint.lastSuccessfulRawText
        });
    }

    resetClearCheckpoint() {
        this.clearCheckpoint = normalizeCheckpoint();
    }
}

module.exports = {
    DEFAULT_COMMAND_TIMEOUT_MS,
    LiveCaptionsWorkerClient
};
