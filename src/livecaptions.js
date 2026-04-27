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

class LiveCaptionsHandler {
    constructor() {
        this.initialized = false;
    }

    async initialize() {
        if (this.initialized) return true;
        const nativeModule = loadNativeModule();
        this.initialized = nativeModule.initialize();
        return this.initialized;
    }

    async launchLiveCaptions() {
        if (!this.initialized) {
            await this.initialize();
        }
        const nativeModule = loadNativeModule();
        const launched = nativeModule.launchLiveCaptions();
        if (!launched) {
            throw new Error('Failed to launch or find LiveCaptions. Please ensure Windows LiveCaptions is running or installed.');
        }
        return launched;
    }

    getCaptions() {
        try {
            const nativeModule = loadNativeModule();
            return nativeModule.getCaptions() || '';
        } catch (error) {
            console.error('[ERROR] Failed to get captions:', error);
            return '';
        }
    }

    async restartLiveCaptions() {
        if (!this.initialized) {
            await this.initialize();
        }

        try {
            const nativeModule = loadNativeModule();
            const restarted = Boolean(nativeModule.restartLiveCaptions && nativeModule.restartLiveCaptions());
            if (!restarted) {
                throw new Error('Failed to restart LiveCaptions.');
            }

            this.initialized = true;
            return restarted;
        } catch (error) {
            console.error('[ERROR] Failed to restart Live Captions:', error);
            throw error;
        }
    }

    async isWindowVisible() {
        if (!this.initialized) {
            await this.initialize();
        }

        try {
            const nativeModule = loadNativeModule();
            if (typeof nativeModule.isLiveCaptionsVisible !== 'function') {
                throw new Error('Live Captions window visibility is not supported by the native addon.');
            }

            return Boolean(nativeModule.isLiveCaptionsVisible());
        } catch (error) {
            console.error('[ERROR] Failed to get Live Captions window visibility:', error);
            throw error;
        }
    }

    async setWindowVisibility(isVisible) {
        if (!this.initialized) {
            await this.initialize();
        }

        try {
            const nativeModule = loadNativeModule();
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
        } catch (error) {
            console.error('[ERROR] Failed to set Live Captions window visibility:', error);
            throw error;
        }
    }

    async toggleWindowVisibility() {
        const isVisible = await this.isWindowVisible();
        return this.setWindowVisibility(!isVisible);
    }

    cleanup() {
        try {
            const nativeModule = loadNativeModule();
            nativeModule.cleanup();
        } catch (error) {
            console.error('[ERROR] Failed to cleanup:', error);
        } finally {
            this.initialized = false;
        }
    }
}

module.exports = new LiveCaptionsHandler();
