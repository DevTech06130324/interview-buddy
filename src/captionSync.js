const liveCaptionsHandler = require('./livecaptions');
const EventEmitter = require('events');
const { logTranscriptEvent } = require('./transcriptLogger');

const CONTROL_CHARS_EXCEPT_WHITESPACE_PATTERN = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

class CaptionSyncService extends EventEmitter {
    constructor() {
        super();
        this.isRunning = false;
        this.activePollInterval = 60;
        this.idlePollInterval = 180;
        this.idleThreshold = 10;
        this.currentPollInterval = this.activePollInterval;
        this.unchangedPollCount = 0;
        this.lastEmittedText = '';
        this.lastRawPolledText = '';
        this.loopGeneration = 0;
        this.pollSequence = 0;
        this.startPromise = null;
    }

    async start() {
        if (this.isRunning) {
            return true;
        }

        if (this.startPromise) {
            return this.startPromise;
        }

        const startGeneration = this.loopGeneration;
        const startPromise = (async () => {
            // Initialize and launch LiveCaptions
            await liveCaptionsHandler.initialize();
            await liveCaptionsHandler.launchLiveCaptions();

            // Small delay to allow window to initialize
            await this.sleep(1000);

            if (this.loopGeneration !== startGeneration || this.isRunning) {
                return this.isRunning;
            }

            this.lastEmittedText = '';
            this.lastRawPolledText = '';
            this.currentPollInterval = this.activePollInterval;
            this.unchangedPollCount = 0;
            this.startSyncLoop();
            return true;
        })();

        this.startPromise = startPromise;

        try {
            return await startPromise;
        } catch (error) {
            console.error('[ERROR] Failed to start caption sync:', error);
            this.emit('error', error);
            // Don't throw - allow app to continue even if LiveCaptions isn't available
            // The UI will show the error message
            return false;
        } finally {
            if (this.startPromise === startPromise) {
                this.startPromise = null;
            }
        }
    }

    stop() {
        this.stopPolling();
        liveCaptionsHandler.cleanup();
    }

    async stopAndCloseLiveCaptions() {
        this.stopPolling();
        await liveCaptionsHandler.closeLiveCaptions();
    }

    stopPolling() {
        const hadStartInFlight = Boolean(this.startPromise);
        this.isRunning = false;
        this.lastEmittedText = '';
        this.lastRawPolledText = '';
        this.currentPollInterval = this.activePollInterval;
        this.unchangedPollCount = 0;
        this.loopGeneration += 1;
        logTranscriptEvent('caption-sync-stop', {
            loopGeneration: this.loopGeneration,
            hadStartInFlight
        });
    }

    async clearTranscript() {
        const wasRunning = this.isRunning;
        this.isRunning = false;
        this.lastEmittedText = '';
        this.lastRawPolledText = '';
        this.loopGeneration += 1;

        logTranscriptEvent('caption-sync-clear-requested', {
            loopGeneration: this.loopGeneration,
            wasRunning
        });

        this.emit('captionUpdate', {
            fullText: '',
            entries: []
        });

        await this.sleep(100);

        try {
            await liveCaptionsHandler.restartLiveCaptions();
            await this.sleep(1000);

            this.lastEmittedText = '';
            this.lastRawPolledText = '';
            this.currentPollInterval = this.activePollInterval;
            this.unchangedPollCount = 0;
            if (wasRunning) {
                this.startSyncLoop();
            }

            const liveCaptionsVisible = await this.getLiveCaptionsVisibility();
            logTranscriptEvent('caption-sync-clear-succeeded', {
                loopGeneration: this.loopGeneration,
                liveCaptionsVisible
            });

            return {
                success: true,
                liveCaptionsVisible
            };
        } catch (error) {
            console.error('[ERROR] Failed to restart Live Captions after clearing transcript:', error);
            this.lastEmittedText = '';
            this.lastRawPolledText = '';
            logTranscriptEvent('caption-sync-clear-failed', {
                loopGeneration: this.loopGeneration,
                error
            });
            this.emit('error', error);
            return {
                success: false,
                liveCaptionsVisible: null
            };
        }
    }

    async getLiveCaptionsVisibility() {
        return liveCaptionsHandler.isWindowVisible();
    }

    async toggleLiveCaptionsVisibility() {
        return liveCaptionsHandler.toggleWindowVisibility();
    }

    async setLiveCaptionsVisibility(isVisible) {
        return liveCaptionsHandler.setWindowVisibility(Boolean(isVisible));
    }

    startSyncLoop() {
        this.loopGeneration += 1;
        this.isRunning = true;
        this.currentPollInterval = this.activePollInterval;
        this.unchangedPollCount = 0;
        logTranscriptEvent('caption-sync-loop-started', {
            loopGeneration: this.loopGeneration,
            activePollInterval: this.activePollInterval,
            idlePollInterval: this.idlePollInterval
        });
        void this.syncLoop(this.loopGeneration);
    }

    async syncLoop(loopGeneration) {
        while (this.isRunning && this.loopGeneration === loopGeneration) {
            try {
                // Get text from LiveCaptions (10-20ms operation)
                const fullText = liveCaptionsHandler.getCaptions();

                // Preprocess text to clean it up (fix acronyms, punctuation, etc.)
                const processedText = this.preprocessText(fullText);
                const normalizedText = processedText.trim() === '' ? '' : processedText;
                const shouldEmit = normalizedText !== this.lastEmittedText;

                if (fullText !== this.lastRawPolledText || shouldEmit) {
                    this.pollSequence += 1;
                    logTranscriptEvent('caption-sync-polled', {
                        loopGeneration,
                        pollSequence: this.pollSequence,
                        rawText: fullText,
                        processedText,
                        normalizedText,
                        previousEmittedText: this.lastEmittedText,
                        emitted: shouldEmit,
                        unchangedPollCount: this.unchangedPollCount,
                        currentPollInterval: this.currentPollInterval
                    });
                    this.lastRawPolledText = fullText;
                }

                if (shouldEmit) {
                    this.lastEmittedText = normalizedText;
                    this.currentPollInterval = this.activePollInterval;
                    this.unchangedPollCount = 0;

                    // Emit the full processed transcript only when it changes.
                    this.emit('captionUpdate', {
                        fullText: normalizedText
                    });
                } else {
                    this.unchangedPollCount += 1;
                    if (this.unchangedPollCount >= this.idleThreshold) {
                        this.currentPollInterval = this.idlePollInterval;
                    }
                }
            } catch (error) {
                console.error('[ERROR] Sync loop error:', error);
                logTranscriptEvent('caption-sync-loop-error', {
                    loopGeneration,
                    error
                });
                this.emit('error', error);
            }

            await this.sleep(this.currentPollInterval);
        }
    }

    preprocessText(text) {
        return String(text || '')
            // Native UIA strings may include a C-style NUL terminator; never let
            // control characters become transcript content.
            .replace(CONTROL_CHARS_EXCEPT_WHITESPACE_PATTERN, '')
            // Remove acronym formatting (e.g., "A.I." -> "AI")
            .replace(/([A-Z])\.([A-Z])\./g, '$1$2')
            .replace(/([A-Z])\.([A-Z])/g, '$1 $2')
            // Fix punctuation spacing
            .replace(/([.!?])([A-Za-z])/g, '$1 $2')
            // Handle CJK punctuation
            .replace(/([\uFF0C\u3002\uFF01\uFF1F])([A-Za-z])/g, '$1 $2')
            // Replace excessive newlines
            .replace(/\n{2,}/g, '. ');
    }

    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

module.exports = new CaptionSyncService();
