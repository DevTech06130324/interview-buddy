const fs = require('fs');
const path = require('path');

let native = null;

function getNativeModuleCandidates() {
    const candidates = [];
    const seen = new Set();
    const addCandidate = (candidatePath) => {
        const resolvedPath = path.resolve(candidatePath);
        if (!seen.has(resolvedPath)) {
            seen.add(resolvedPath);
            candidates.push(resolvedPath);
        }
    };

    addCandidate(path.join(__dirname, '..', 'native', 'build', 'Release', 'livecaptions_native.node'));

    if (__dirname.includes('app.asar')) {
        addCandidate(
            path.join(
                __dirname.replace('app.asar', 'app.asar.unpacked'),
                '..',
                'native',
                'build',
                'Release',
                'livecaptions_native.node'
            )
        );
    }

    if (typeof process.resourcesPath === 'string' && process.resourcesPath) {
        addCandidate(
            path.join(
                process.resourcesPath,
                'app.asar.unpacked',
                'native',
                'build',
                'Release',
                'livecaptions_native.node'
            )
        );
        addCandidate(
            path.join(
                process.resourcesPath,
                'native',
                'build',
                'Release',
                'livecaptions_native.node'
            )
        );
    }

    return candidates;
}

function buildMissingNativeAddonError(candidates) {
    const error = new Error(
        `Live Captions native addon was not found.\n` +
        `Checked these paths:\n- ${candidates.join('\n- ')}\n\n` +
        `Run "npm run build-native" and then package the app again.`
    );
    error.code = 'LIVECAPTIONS_NATIVE_NOT_FOUND';
    return error;
}

function loadNativeModule() {
    if (native) return native;

    const candidates = getNativeModuleCandidates();
    let lastLoadError = null;

    for (const nativePath of candidates) {
        if (!fs.existsSync(nativePath)) {
            continue;
        }

        try {
            native = require(nativePath);
            return native;
        } catch (error) {
            lastLoadError = error;
            lastLoadError.message = `Failed to load Live Captions native addon from "${nativePath}": ${error.message}`;
        }
    }

    const error = lastLoadError || buildMissingNativeAddonError(candidates);
    console.error('[ERROR] Failed to load native module:', error);
    throw error;
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

function normalizeLifecycleResult(value) {
    if (value && typeof value === 'object') {
        return {
            success: Boolean(value.success),
            ownership: normalizeOwnership(value)
        };
    }

    return {
        success: Boolean(value),
        ownership: { owned: false, processId: 0 }
    };
}

function unavailableSnapshot(error, fallbackCode = 'LIVECAPTIONS_READ_UNAVAILABLE') {
    return {
        status: 'unavailable',
        code: typeof error?.code === 'string' && error.code ? error.code : fallbackCode,
        message: error?.message || String(error || 'Live Captions text is unavailable.')
    };
}

function normalizeCaptionSnapshot(value) {
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

class LiveCaptionsHandler {
    constructor({
        nativeLoader = loadNativeModule,
        platform = process.platform,
        sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
    } = {}) {
        this.nativeLoader = nativeLoader;
        this.platform = platform;
        this.sleep = sleep;
        this.initialized = false;
        this.ownership = { owned: false, processId: 0 };
    }

    async initialize() {
        if (this.initialized) return true;
        const nativeModule = this.nativeLoader();
        this.initialized = Boolean(nativeModule.initialize());
        if (!this.initialized) {
            const error = new Error('Failed to initialize Windows UI Automation for Live Captions.');
            error.code = 'LIVECAPTIONS_NATIVE_INITIALIZATION_FAILED';
            throw error;
        }
        return this.initialized;
    }

    async launchLiveCaptions() {
        if (!this.initialized) {
            await this.initialize();
        }

        let result = normalizeLifecycleResult(
            this.nativeLoader().launchLiveCaptions()
        );

        if (!result.success && this.platform === 'win32') {
            console.warn('[WARNING] Live Captions launch/attach failed. Retrying once.');
            await this.closeLiveCaptions();
            await this.sleep(400);
            await this.initialize();
            result = normalizeLifecycleResult(
                this.nativeLoader().launchLiveCaptions()
            );
        }

        if (!result.success) {
            throw new Error('Failed to launch or find Live Captions. Please ensure Windows Live Captions is running or installed.');
        }

        this.ownership = result.ownership;
        return result;
    }

    getCaptions() {
        try {
            return normalizeCaptionSnapshot(this.nativeLoader().getCaptions());
        } catch (error) {
            return unavailableSnapshot(error);
        }
    }

    async restartLiveCaptions() {
        if (!this.initialized) {
            await this.initialize();
        }

        const result = normalizeLifecycleResult(
            this.nativeLoader().restartLiveCaptions()
        );
        if (!result.success) {
            throw new Error('Failed to restart Live Captions.');
        }

        this.initialized = true;
        this.ownership = result.ownership;
        return result;
    }

    async isWindowVisible() {
        if (!this.initialized) {
            await this.initialize();
        }

        const nativeModule = this.nativeLoader();
        if (typeof nativeModule.isLiveCaptionsVisible !== 'function') {
            throw new Error('Live Captions window visibility is not supported by the native addon.');
        }

        return Boolean(nativeModule.isLiveCaptionsVisible());
    }

    async setWindowVisibility(isVisible) {
        if (!this.initialized) {
            await this.initialize();
        }

        const nativeModule = this.nativeLoader();
        if (typeof nativeModule.setLiveCaptionsVisible !== 'function') {
            throw new Error('Live Captions window visibility is not supported by the native addon.');
        }

        const updated = Boolean(nativeModule.setLiveCaptionsVisible(Boolean(isVisible)));
        if (!updated) {
            throw new Error(`Failed to ${isVisible ? 'show' : 'hide'} the Live Captions window.`);
        }

        if (typeof nativeModule.isLiveCaptionsVisible === 'function') {
            return Boolean(nativeModule.isLiveCaptionsVisible());
        }

        return Boolean(isVisible);
    }

    async closeLiveCaptions() {
        let closed = false;

        try {
            const nativeModule = this.nativeLoader();
            if (typeof nativeModule.closeLiveCaptions === 'function') {
                closed = Boolean(nativeModule.closeLiveCaptions());
            } else if (typeof nativeModule.cleanup === 'function') {
                nativeModule.cleanup();
            }
        } catch (error) {
            console.error('[WARNING] Failed to close Live Captions through native addon:', error.message || error);
        } finally {
            this.initialized = false;
            this.ownership = { owned: false, processId: 0 };
        }

        return {
            closed,
            ownership: this.ownership
        };
    }

    async cleanup() {
        try {
            if (this.initialized) {
                this.nativeLoader().cleanup();
            }
        } finally {
            this.initialized = false;
            this.ownership = { owned: false, processId: 0 };
        }

        return { ownership: this.ownership };
    }
}

const liveCaptionsHandler = new LiveCaptionsHandler();

module.exports = liveCaptionsHandler;
module.exports.LiveCaptionsHandler = LiveCaptionsHandler;
