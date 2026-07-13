const EventEmitter = require('node:events');
const { randomUUID } = require('node:crypto');
const { LiveCaptionsWorkerClient } = require('./liveCaptionsWorkerClient');

const CONTROL_CHARS_EXCEPT_WHITESPACE_PATTERN = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
const UNAVAILABLE_ERROR_THRESHOLD = 3;
const IDLE_CAPTION_ELEMENT_UNAVAILABLE_CODES = new Set([
    'LIVECAPTIONS_ELEMENT_UNAVAILABLE',
    'CAPTIONS_ELEMENT_UNAVAILABLE'
]);

class CaptionSyncService extends EventEmitter {
    constructor({
        workerClient = new LiveCaptionsWorkerClient(),
        createSessionId = randomUUID
    } = {}) {
        super();
        this.workerClient = workerClient;
        this.createSessionId = createSessionId;
        this.isRunning = false;
        this.lastEmittedText = '';
        this.startPromise = null;
        this.consecutiveUnavailableReads = 0;
        this.unavailableErrorEmitted = false;
        this.hasEmittedCaptionText = false;
        this.sessionId = this.createSessionId();
        this.requiresFreshSessionBoundary = false;

        this.workerClient.on('snapshot', (snapshot) => this.handleSnapshot(snapshot));
        this.workerClient.on('error', (error) => this.handleWorkerError(error));
        this.workerClient.on('state', () => this.emit('state', this.getState()));
    }

    getSessionId() {
        return this.sessionId;
    }

    getState() {
        const workerState = this.workerClient?.getState?.() || {};
        return {
            active: this.isRunning,
            sessionId: this.getSessionId(),
            requiresFreshSessionBoundary: this.requiresFreshSessionBoundary,
            phase: typeof workerState.phase === 'string'
                ? workerState.phase
                : (this.isRunning ? 'active' : 'inactive'),
            retryAttempt: Number.isSafeInteger(workerState.retryAttempt)
                ? Math.max(0, workerState.retryAttempt)
                : (Number.isSafeInteger(workerState.crashCount)
                    ? Math.max(0, workerState.crashCount)
                    : 0)
        };
    }

    beginNewSession({ requireFreshBoundary = false } = {}) {
        const shouldRequireFreshBoundary = Boolean(requireFreshBoundary)
            && (this.requiresFreshSessionBoundary || this.hasEmittedCaptionText);
        this.sessionId = this.createSessionId();
        this.lastEmittedText = '';
        this.hasEmittedCaptionText = false;
        this.resetUnavailableEpisode();
        this.requiresFreshSessionBoundary = shouldRequireFreshBoundary;
        return this.getSessionId();
    }

    async start() {
        if (this.isRunning) {
            return true;
        }
        if (this.startPromise) {
            return this.startPromise;
        }

        const startPromise = (async () => {
            try {
                const state = await this.workerClient.start();
                if (state?.active && this.requiresFreshSessionBoundary) {
                    await this.workerClient.restart();
                    this.requiresFreshSessionBoundary = false;
                }
                this.isRunning = Boolean(state?.active);
                return this.isRunning;
            } catch (error) {
                this.isRunning = false;
                this.emit('error', error);
                return false;
            }
        })();
        this.startPromise = startPromise;

        try {
            return await startPromise;
        } finally {
            if (this.startPromise === startPromise) {
                this.startPromise = null;
            }
        }
    }

    stop() {
        this.isRunning = false;
        this.resetUnavailableEpisode();
        return this.workerClient.stop().catch((error) => {
            this.emit('error', error);
            return { stopped: false };
        });
    }

    stopAndCloseLiveCaptions() {
        this.isRunning = false;
        this.resetUnavailableEpisode();
        return this.workerClient.close().catch((error) => {
            this.emit('error', error);
            return { closed: false };
        });
    }

    async clearTranscript() {
        this.beginNewSession();

        this.emit('captionUpdate', {
            fullText: '',
            entries: []
        });

        try {
            await this.workerClient.restart();
            const liveCaptionsVisible = await this.getLiveCaptionsVisibility();
            return {
                success: true,
                liveCaptionsVisible
            };
        } catch (error) {
            this.isRunning = false;
            this.requiresFreshSessionBoundary = true;
            this.emit('error', error);
            return {
                success: false,
                liveCaptionsVisible: null
            };
        }
    }

    async getLiveCaptionsVisibility() {
        // Renderer initialization can ask for the persisted visibility before
        // the ready-to-show hook has started the worker. Start the source on
        // demand so this harmless read cannot race worker startup.
        if (!this.isRunning && !(await this.start())) {
            return null;
        }

        return this.workerClient.getVisibility();
    }

    async toggleLiveCaptionsVisibility() {
        const isVisible = await this.getLiveCaptionsVisibility();
        return this.setLiveCaptionsVisibility(!isVisible);
    }

    async setLiveCaptionsVisibility(isVisible) {
        if (!this.isRunning && !(await this.start())) {
            return null;
        }

        return this.workerClient.setVisibility(Boolean(isVisible));
    }

    handleSnapshot(snapshot) {
        if (!this.isRunning || !snapshot || typeof snapshot !== 'object') {
            return;
        }

        if (snapshot.status === 'unavailable') {
            this.handleUnavailableSnapshot(snapshot);
            return;
        }

        if (snapshot.status !== 'ok' || typeof snapshot.text !== 'string') {
            this.handleUnavailableSnapshot({
                code: 'LIVECAPTIONS_INVALID_SNAPSHOT',
                message: 'Live Captions returned an invalid caption snapshot.'
            });
            return;
        }

        this.resetUnavailableEpisode();
        if (snapshot.text.length === 0) {
            return;
        }

        const processedText = this.preprocessText(snapshot.text);
        const normalizedText = processedText.trim() === '' ? '' : processedText;
        if (normalizedText === '' || normalizedText === this.lastEmittedText) {
            return;
        }

        this.lastEmittedText = normalizedText;
        this.hasEmittedCaptionText = true;
        this.emit('captionUpdate', { fullText: normalizedText });
    }

    handleUnavailableSnapshot(snapshot) {
        if (this.isIdleCaptionElementUnavailable(snapshot)) {
            return;
        }

        this.consecutiveUnavailableReads += 1;
        if (
            this.consecutiveUnavailableReads < UNAVAILABLE_ERROR_THRESHOLD
            || this.unavailableErrorEmitted
        ) {
            return;
        }

        this.unavailableErrorEmitted = true;
        const error = new Error(snapshot.message || 'Live Captions text is unavailable.');
        error.source = 'live-captions';
        error.code = snapshot.code || 'LIVECAPTIONS_READ_UNAVAILABLE';
        error.recoverable = true;
        this.emit('error', error);
    }

    isIdleCaptionElementUnavailable(snapshot) {
        return !this.hasEmittedCaptionText
            && IDLE_CAPTION_ELEMENT_UNAVAILABLE_CODES.has(snapshot?.code);
    }

    handleWorkerError(error) {
        if (error?.code === 'LIVECAPTIONS_WORKER_MANUAL_RETRY') {
            this.isRunning = false;
        }
        this.emit('error', error);
    }

    resetUnavailableEpisode() {
        this.consecutiveUnavailableReads = 0;
        this.unavailableErrorEmitted = false;
    }

    preprocessText(text) {
        return String(text || '')
            .replace(CONTROL_CHARS_EXCEPT_WHITESPACE_PATTERN, '')
            .replace(/([A-Z])\.([A-Z])\./g, '$1$2')
            .replace(/([A-Z])\.([A-Z])/g, '$1 $2')
            .replace(/([.!?])([A-Za-z])/g, '$1 $2')
            .replace(/([\uFF0C\u3002\uFF01\uFF1F])([A-Za-z])/g, '$1 $2')
            .replace(/\n{2,}/g, '. ');
    }
}

const captionSyncService = new CaptionSyncService();

module.exports = captionSyncService;
module.exports.CaptionSyncService = CaptionSyncService;
