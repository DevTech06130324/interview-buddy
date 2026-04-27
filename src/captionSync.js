const liveCaptionsHandler = require('./livecaptions');
const EventEmitter = require('events');

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
        this.loopGeneration = 0;
    }

    async start() {
        if (this.isRunning) return;

        try {
            // Initialize and launch LiveCaptions
            await liveCaptionsHandler.initialize();
            await liveCaptionsHandler.launchLiveCaptions();

            // Small delay to allow window to initialize
            await this.sleep(1000);

            this.lastEmittedText = '';
            this.currentPollInterval = this.activePollInterval;
            this.unchangedPollCount = 0;
            this.startSyncLoop();
        } catch (error) {
            console.error('[ERROR] Failed to start caption sync:', error);
            this.emit('error', error);
            // Don't throw - allow app to continue even if LiveCaptions isn't available
            // The UI will show the error message
        }
    }

    stop() {
        this.isRunning = false;
        this.lastEmittedText = '';
        this.currentPollInterval = this.activePollInterval;
        this.unchangedPollCount = 0;
        this.loopGeneration += 1;
        liveCaptionsHandler.cleanup();
    }

    async clearTranscript() {
        const wasRunning = this.isRunning;
        this.isRunning = false;
        this.lastEmittedText = '';
        this.loopGeneration += 1;

        this.emit('captionUpdate', {
            fullText: ''
        });

        await this.sleep(100);

        try {
            await liveCaptionsHandler.restartLiveCaptions();
            await this.sleep(1000);

            this.lastEmittedText = '';
            this.currentPollInterval = this.activePollInterval;
            this.unchangedPollCount = 0;
            if (wasRunning) {
                this.startSyncLoop();
            }

            return {
                success: true,
                liveCaptionsVisible: await this.getLiveCaptionsVisibility()
            };
        } catch (error) {
            console.error('[ERROR] Failed to restart Live Captions after clearing transcript:', error);
            this.lastEmittedText = '';
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

    startSyncLoop() {
        this.loopGeneration += 1;
        this.isRunning = true;
        this.currentPollInterval = this.activePollInterval;
        this.unchangedPollCount = 0;
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

                if (normalizedText !== this.lastEmittedText) {
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
                this.emit('error', error);
            }

            await this.sleep(this.currentPollInterval);
        }
    }

    preprocessText(text) {
        return String(text || '')
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
