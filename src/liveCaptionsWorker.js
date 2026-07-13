const { isMainThread, parentPort } = require('node:worker_threads');
const { normalizeCheckpoint } = require('./liveCaptionsClearCheckpoint');

const DEFAULT_ACTIVE_POLL_INTERVAL = 60;
const DEFAULT_IDLE_POLL_INTERVAL = 180;
const DEFAULT_IDLE_THRESHOLD = 10;

function unavailableSnapshot(error, fallbackCode = 'LIVECAPTIONS_WORKER_READ_UNAVAILABLE') {
    return {
        status: 'unavailable',
        code: typeof error?.code === 'string' && error.code ? error.code : fallbackCode,
        message: error?.message || String(error || 'Live Captions text is unavailable.')
    };
}

function normalizeSnapshot(value) {
    if (value?.status === 'ok' && typeof value.text === 'string') {
        return { status: 'ok', text: value.text };
    }

    if (
        value?.status === 'unavailable'
        && typeof value.code === 'string'
        && typeof value.message === 'string'
    ) {
        return {
            status: 'unavailable',
            code: value.code,
            message: value.message
        };
    }

    return unavailableSnapshot(
        new Error('Live Captions returned an invalid caption snapshot.'),
        'LIVECAPTIONS_INVALID_SNAPSHOT'
    );
}

function serializeError(error) {
    return {
        code: typeof error?.code === 'string' && error.code
            ? error.code
            : 'LIVECAPTIONS_WORKER_COMMAND_FAILED',
        message: error?.message || String(error || 'Live Captions worker command failed.')
    };
}

function longestSuffixPrefixOverlap(left, right) {
    const maxLength = Math.min(left.length, right.length);
    for (let length = maxLength; length > 0; length -= 1) {
        if (left.slice(-length) === right.slice(0, length)) {
            return length;
        }
    }
    return 0;
}

function mergeCumulativeText(accumulated, candidate) {
    if (!candidate) {
        return accumulated;
    }
    if (!accumulated) {
        return candidate;
    }
    if (candidate.startsWith(accumulated)) {
        return candidate;
    }
    if (accumulated.startsWith(candidate)) {
        return accumulated;
    }

    const leadingWhitespace = accumulated.match(/^\s*/)?.[0] || '';
    const accumulatedWithoutLeadingWhitespace = accumulated.slice(leadingWhitespace.length);
    if (
        accumulatedWithoutLeadingWhitespace
        && candidate.startsWith(accumulatedWithoutLeadingWhitespace)
    ) {
        return leadingWhitespace + candidate;
    }
    if (
        accumulatedWithoutLeadingWhitespace
        && accumulatedWithoutLeadingWhitespace.startsWith(candidate)
    ) {
        return accumulated;
    }

    const overlap = longestSuffixPrefixOverlap(accumulated, candidate);
    if (overlap > 0) {
        return accumulated + candidate.slice(overlap);
    }

    const separator = /\s$/.test(accumulated) || /^\s/.test(candidate) ? '' : ' ';
    return accumulated + separator + candidate;
}

class LiveCaptionsWorkerRuntime {
    constructor({
        handler,
        postMessage,
        setTimeoutFn = setTimeout,
        clearTimeoutFn = clearTimeout,
        activePollInterval = DEFAULT_ACTIVE_POLL_INTERVAL,
        idlePollInterval = DEFAULT_IDLE_POLL_INTERVAL,
        idleThreshold = DEFAULT_IDLE_THRESHOLD
    }) {
        if (!handler || typeof postMessage !== 'function') {
            throw new TypeError('LiveCaptionsWorkerRuntime requires a handler and postMessage function.');
        }

        this.handler = handler;
        this.postMessage = postMessage;
        this.setTimeoutFn = setTimeoutFn;
        this.clearTimeoutFn = clearTimeoutFn;
        this.activePollInterval = activePollInterval;
        this.idlePollInterval = idlePollInterval;
        this.idleThreshold = idleThreshold;

        this.running = false;
        this.pollTimer = null;
        this.currentPollInterval = activePollInterval;
        this.unchangedPollCount = 0;
        this.lastSnapshotKey = '';
        this.lastSuccessfulRawText = '';
        this.clearBaselineText = '';
        this.postClearText = '';
        this.clearSessionActive = false;
        this.commandQueue = Promise.resolve();
    }

    handleMessage(message) {
        if (message?.type !== 'command' || !Number.isInteger(message.requestId)) {
            return Promise.resolve();
        }

        const commandRun = this.commandQueue.then(() => this.runCommand(message));
        this.commandQueue = commandRun.catch(() => undefined);
        return commandRun;
    }

    async runCommand(message) {
        try {
            const result = await this.executeCommand(message.command, message.payload || {});
            this.postMessage({
                type: 'response',
                requestId: message.requestId,
                ok: true,
                result
            });
            return result;
        } catch (error) {
            this.postMessage({
                type: 'response',
                requestId: message.requestId,
                ok: false,
                error: serializeError(error)
            });
            return null;
        }
    }

    async executeCommand(command, payload) {
        switch (command) {
        case 'start':
            return this.start(payload.checkpoint);
        case 'restart':
            return this.restart();
        case 'getVisibility':
            return { visible: await this.handler.isWindowVisible() };
        case 'setVisibility':
            return { visible: await this.handler.setWindowVisibility(Boolean(payload.visible)) };
        case 'stop':
            return this.stop();
        case 'close':
            return this.close();
        default: {
            const error = new Error(`Unknown Live Captions worker command: ${command}`);
            error.code = 'LIVECAPTIONS_WORKER_UNKNOWN_COMMAND';
            throw error;
        }
        }
    }

    async start(checkpoint) {
        if (this.running) {
            return { started: true, ownership: this.handler.ownership };
        }

        await this.handler.initialize();
        const result = await this.handler.launchLiveCaptions();
        this.running = true;
        this.resetPollingState();
        this.restoreCheckpoint(checkpoint);
        this.schedulePoll();
        return {
            started: true,
            ownership: result.ownership
        };
    }

    async restart() {
        const shouldResumePolling = this.running;
        this.running = false;
        this.cancelPoll();

        let clearBoundary;
        try {
            clearBoundary = normalizeSnapshot(this.handler.getCaptions());
        } catch (error) {
            clearBoundary = unavailableSnapshot(error);
        }
        if (clearBoundary.status !== 'ok') {
            const error = new Error(
                'Live Captions Clear could not establish a fresh transcript boundary.'
            );
            error.code = 'LIVECAPTIONS_CLEAR_BASELINE_UNAVAILABLE';
            throw error;
        }

        const clearBaselineText = clearBoundary.text;
        this.lastSuccessfulRawText = clearBaselineText;
        this.clearBaselineText = clearBaselineText;
        this.postClearText = '';
        this.clearSessionActive = true;
        this.emitCheckpoint();
        const result = await this.handler.restartLiveCaptions();
        this.running = shouldResumePolling;
        this.resetPollingState();
        if (result?.ownership?.owned) {
            this.resetClearState();
        }
        if (this.running) {
            this.schedulePoll();
        }
        return {
            restarted: true,
            ownership: result.ownership
        };
    }

    async stop() {
        this.running = false;
        this.cancelPoll();
        const result = await this.handler.cleanup();
        this.resetPollingState();
        this.resetClearState();
        return {
            stopped: true,
            ownership: result?.ownership || { owned: false, processId: 0 }
        };
    }

    async close() {
        this.running = false;
        this.cancelPoll();
        const result = await this.handler.closeLiveCaptions();
        this.resetPollingState();
        this.resetClearState();
        return {
            closed: Boolean(result?.closed),
            ownership: result?.ownership || { owned: false, processId: 0 }
        };
    }

    resetPollingState() {
        this.currentPollInterval = this.activePollInterval;
        this.unchangedPollCount = 0;
        this.lastSnapshotKey = '';
    }

    resetClearState() {
        this.lastSuccessfulRawText = '';
        this.clearBaselineText = '';
        this.postClearText = '';
        this.clearSessionActive = false;
        this.emitCheckpoint();
    }

    getCheckpoint() {
        return normalizeCheckpoint({
            clearSessionActive: this.clearSessionActive,
            clearBaselineText: this.clearBaselineText,
            postClearText: this.postClearText,
            lastSuccessfulRawText: this.lastSuccessfulRawText
        });
    }

    restoreCheckpoint(checkpoint) {
        const normalized = normalizeCheckpoint(checkpoint);
        this.clearSessionActive = normalized.clearSessionActive;
        this.clearBaselineText = normalized.clearBaselineText;
        this.postClearText = normalized.postClearText;
        this.lastSuccessfulRawText = normalized.lastSuccessfulRawText;
    }

    emitCheckpoint() {
        this.postMessage({
            type: 'checkpoint',
            checkpoint: this.getCheckpoint()
        });
    }

    filterClearedText(rawText) {
        if (!this.clearSessionActive) {
            return rawText;
        }

        let candidate = rawText;
        if (this.clearBaselineText) {
            if (rawText.startsWith(this.clearBaselineText)) {
                candidate = rawText.slice(this.clearBaselineText.length);
            } else {
                const overlap = longestSuffixPrefixOverlap(this.clearBaselineText, rawText);
                if (overlap > 0) {
                    candidate = rawText.slice(overlap);
                } else {
                    this.clearBaselineText = '';
                }
            }
        }

        this.postClearText = mergeCumulativeText(this.postClearText, candidate);
        return this.postClearText;
    }

    schedulePoll() {
        if (!this.running || this.pollTimer !== null) {
            return;
        }

        this.pollTimer = this.setTimeoutFn(() => {
            this.pollTimer = null;
            this.pollOnce();
        }, this.currentPollInterval);
    }

    cancelPoll() {
        if (this.pollTimer !== null) {
            this.clearTimeoutFn(this.pollTimer);
            this.pollTimer = null;
        }
    }

    pollOnce() {
        if (!this.running) {
            return;
        }

        let snapshot;
        try {
            snapshot = normalizeSnapshot(this.handler.getCaptions());
        } catch (error) {
            snapshot = unavailableSnapshot(error);
        }

        if (snapshot.status === 'ok') {
            this.lastSuccessfulRawText = snapshot.text;
            this.emitCheckpoint();
            const clearBaselineTextBeforeProjection = this.clearBaselineText;
            const postClearTextBeforeProjection = this.postClearText;
            snapshot = {
                status: 'ok',
                text: this.filterClearedText(snapshot.text)
            };
            if (
                this.clearBaselineText !== clearBaselineTextBeforeProjection
                || this.postClearText !== postClearTextBeforeProjection
            ) {
                this.emitCheckpoint();
            }
        }

        this.postMessage({ type: 'snapshot', snapshot });

        const snapshotKey = JSON.stringify(snapshot);
        if (snapshotKey === this.lastSnapshotKey) {
            this.unchangedPollCount += 1;
            if (this.unchangedPollCount >= this.idleThreshold) {
                this.currentPollInterval = this.idlePollInterval;
            }
        } else {
            this.lastSnapshotKey = snapshotKey;
            this.unchangedPollCount = 0;
            this.currentPollInterval = this.activePollInterval;
        }

        this.schedulePoll();
    }
}

if (!isMainThread && parentPort) {
    const liveCaptionsHandler = require('./livecaptions');
    const runtime = new LiveCaptionsWorkerRuntime({
        handler: liveCaptionsHandler,
        postMessage: (message) => parentPort.postMessage(message)
    });
    parentPort.on('message', (message) => {
        void runtime.handleMessage(message);
    });
}

module.exports = {
    LiveCaptionsWorkerRuntime,
    longestSuffixPrefixOverlap,
    mergeCumulativeText,
    normalizeCheckpoint,
    normalizeSnapshot
};
