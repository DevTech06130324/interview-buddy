const test = require('node:test');
const assert = require('node:assert/strict');

const { LiveCaptionsHandler } = require('../src/livecaptions');

function createNative(overrides = {}) {
    return {
        initialize() {
            return true;
        },
        launchLiveCaptions() {
            return {
                success: true,
                processId: 73,
                owned: true
            };
        },
        getCaptions() {
            return { status: 'ok', text: '' };
        },
        restartLiveCaptions() {
            return {
                success: true,
                processId: 74,
                owned: true
            };
        },
        cleanup() {},
        ...overrides
    };
}

test('caption reads preserve the exact ok and unavailable snapshot shapes', () => {
    const snapshots = [
        { status: 'ok', text: '' },
        {
            status: 'unavailable',
            code: 'CAPTIONS_ELEMENT_UNAVAILABLE',
            message: 'The Live Captions text element is unavailable.'
        }
    ];
    const handler = new LiveCaptionsHandler({
        nativeLoader: () => createNative({
            getCaptions() {
                return snapshots.shift();
            }
        })
    });

    assert.deepEqual(handler.getCaptions(), { status: 'ok', text: '' });
    assert.deepEqual(handler.getCaptions(), {
        status: 'unavailable',
        code: 'CAPTIONS_ELEMENT_UNAVAILABLE',
        message: 'The Live Captions text element is unavailable.'
    });
});

test('caption read exceptions become unavailable snapshots instead of empty success', () => {
    const handler = new LiveCaptionsHandler({
        nativeLoader: () => createNative({
            getCaptions() {
                const error = new Error('native read exploded');
                error.code = 'NATIVE_READ_EXPLODED';
                throw error;
            }
        })
    });

    assert.deepEqual(handler.getCaptions(), {
        status: 'unavailable',
        code: 'NATIVE_READ_EXPLODED',
        message: 'native read exploded'
    });
});

test('launch ignores client-carried ownership and trusts only the native result', async () => {
    const launchArguments = [];
    const handler = new LiveCaptionsHandler({
        nativeLoader: () => createNative({
            launchLiveCaptions(...args) {
                launchArguments.push(args);
                return {
                    success: true,
                    processId: 73,
                    owned: true
                };
            }
        })
    });

    const result = await handler.launchLiveCaptions({
        ownership: { owned: true, processId: 73 }
    });

    assert.deepEqual(launchArguments, [[]]);
    assert.deepEqual(result, {
        success: true,
        ownership: { owned: true, processId: 73 }
    });
});

test('a new handler can recover native-registered ownership after a lost start response', async () => {
    let appOwnedProcessRegistered = false;
    let firstLaunch = true;
    const nativeModule = createNative({
        launchLiveCaptions(...args) {
            assert.deepEqual(args, []);
            if (firstLaunch) {
                firstLaunch = false;
                appOwnedProcessRegistered = true;
                return { success: true, processId: 120, owned: true };
            }
            return {
                success: true,
                processId: 120,
                owned: appOwnedProcessRegistered
            };
        }
    });
    const firstWorkerHandler = new LiveCaptionsHandler({ nativeLoader: () => nativeModule });
    const replacementWorkerHandler = new LiveCaptionsHandler({ nativeLoader: () => nativeModule });

    await firstWorkerHandler.launchLiveCaptions();
    const recovered = await replacementWorkerHandler.launchLiveCaptions({
        ownership: { owned: false, processId: 0 }
    });

    assert.deepEqual(recovered.ownership, { owned: true, processId: 120 });
});

test('launch fails immediately when native UI Automation initialization fails', async () => {
    let launchCalled = false;
    const handler = new LiveCaptionsHandler({
        nativeLoader: () => createNative({
            initialize() {
                return false;
            },
            launchLiveCaptions() {
                launchCalled = true;
                return { success: true, processId: 130, owned: true };
            }
        })
    });

    await assert.rejects(handler.launchLiveCaptions(), {
        code: 'LIVECAPTIONS_NATIVE_INITIALIZATION_FAILED'
    });
    assert.equal(launchCalled, false);
});
