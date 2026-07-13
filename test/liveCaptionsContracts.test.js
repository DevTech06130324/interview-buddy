const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

function read(relativePath) {
    return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function functionSource(source, functionName, nextFunctionName) {
    const start = source.indexOf(`${functionName}(`);
    const end = source.indexOf(`${nextFunctionName}(`, start + functionName.length);
    assert.notEqual(start, -1, `${functionName} should exist`);
    assert.notEqual(end, -1, `${nextFunctionName} should follow ${functionName}`);
    return source.slice(start, end);
}

test('native caption boundary returns explicit ok and unavailable snapshots', () => {
    const source = read('native/livecaptions.cpp');
    const getCaptions = functionSource(source, 'Napi::Value GetCaptions', 'Napi::Value RestartLiveCaptions');

    assert.match(source, /CreateCaptionOkSnapshot[\s\S]*"status"[\s\S]*"ok"[\s\S]*"text"/);
    assert.match(source, /CreateCaptionUnavailableSnapshot[\s\S]*"status"[\s\S]*"unavailable"[\s\S]*"code"[\s\S]*"message"/);
    assert.match(getCaptions, /CreateCaptionOkSnapshot\(env, utf8_text\)/);
    assert.match(getCaptions, /CreateCaptionUnavailableSnapshot/);
    assert.match(getCaptions, /CAPTIONS_TEXT_ELEMENT_RETRY_ATTEMPTS/);
    assert.match(getCaptions, /CAPTIONS_TEXT_ELEMENT_RETRY_DELAY_MS/);
    assert.doesNotMatch(getCaptions, /return Napi::String::New/);
});

test('native close validates exact registered handle ownership before WM_CLOSE', () => {
    const source = read('native/livecaptions.cpp');
    const closeTracked = functionSource(source, 'bool CloseTrackedLiveCaptions', 'bool AttachToLiveCaptionsWindow');
    const ownershipGuardIndex = closeTracked.indexOf('IsRegisteredOwnedProcess');
    const windowOwnerLookupIndex = closeTracked.indexOf('GetWindowThreadProcessId');
    const windowOwnerGuardIndex = closeTracked.indexOf('windowProcessId == trackedProcessId');
    const closeMessageIndex = closeTracked.indexOf('PostMessageW');

    assert.notEqual(ownershipGuardIndex, -1, 'close should validate the retained handle');
    assert.ok(
        ownershipGuardIndex < closeMessageIndex,
        'ownership must be checked before sending WM_CLOSE'
    );
    assert.ok(
        windowOwnerLookupIndex > ownershipGuardIndex
        && windowOwnerLookupIndex < windowOwnerGuardIndex
        && windowOwnerGuardIndex < closeMessageIndex,
        'the HWND must still belong to the exact tracked PID immediately before WM_CLOSE'
    );
});

test('native launch never derives ownership from client-carried lifecycle data', () => {
    const source = read('native/livecaptions.cpp');
    const launch = functionSource(source, 'Napi::Value LaunchLiveCaptions', 'Napi::Value GetCaptions');
    const handler = read('src/livecaptions.js');
    const worker = read('src/liveCaptionsWorker.js');
    const client = read('src/liveCaptionsWorkerClient.js');
    const handlerLaunch = functionSource(handler, 'async launchLiveCaptions', 'getCaptions');
    const workerStart = functionSource(worker, 'async start', 'async restart');
    const clientStart = functionSource(client, 'async startForRevision', 'async restart');
    const clientRecovery = functionSource(client, 'async restartAfterCrash', 'failForManualRetry');

    assert.doesNotMatch(launch, /previouslyOwnedProcessId|requestedProcessId|info\[0\]/);
    assert.doesNotMatch(handlerLaunch, /launchLiveCaptions\([^)]/);
    assert.doesNotMatch(workerStart, /launchLiveCaptions\([^)]/);
    for (const clientStartPath of [clientStart, clientRecovery]) {
        assert.match(
            clientStartPath,
            /sendCommand\(worker, 'start',\s*\{\s*checkpoint:\s*this\.getClearCheckpoint\(\)\s*\}\)/
        );
        assert.doesNotMatch(
            clientStartPath,
            /sendCommand\(worker, 'start',\s*\{[^}]*\b(?:ownership|processId)\b/
        );
    }
    assert.match(launch, /IsRegisteredOwnedProcess\(processId\)/);
    assert.match(launch, /CreateLifecycleResult[\s\S]*g_ownsProcess/);
});

test('native restart never closes an unowned process and reattaches it in place', () => {
    const source = read('native/livecaptions.cpp');
    const restart = functionSource(
        source,
        'Napi::Value RestartLiveCaptions',
        'Napi::Value CloseLiveCaptions'
    );

    assert.match(restart, /IsRegisteredOwnedProcess\(g_processId\)/);
    assert.match(restart, /ReinitializeAndReattachTrackedProcess\(g_processId\)/);
    assert.doesNotMatch(restart, /CloseTrackedLiveCaptions\(true, true\)/);
});

test('native visibility commands cannot implicitly launch an untracked process', () => {
    const source = read('native/livecaptions.cpp');
    const setVisibility = functionSource(
        source,
        'Napi::Value SetLiveCaptionsVisible',
        'Napi::Value IsLiveCaptionsVisible'
    );

    assert.match(setVisibility, /GetLiveCaptionsWindowHandle\(&windowHandle, false\)/);
    assert.doesNotMatch(setVisibility, /GetLiveCaptionsWindowHandle\(&windowHandle, shouldShow\)/);
});

test('native UI Automation and ownership state is isolated per worker thread', () => {
    const binding = read('native/livecaptions.cpp');
    const automationHeader = read('native/win32_automation.h');
    const automationSource = read('native/win32_automation.cpp');

    assert.match(binding, /static thread_local IUIAutomationElement\* g_window/);
    assert.match(binding, /static thread_local IUIAutomationElement\* g_textBlock/);
    assert.match(binding, /static thread_local DWORD g_processId/);
    assert.match(binding, /static thread_local bool g_ownsProcess/);
    assert.match(automationHeader, /static thread_local IUIAutomation\* automation/);
    assert.match(automationHeader, /static thread_local bool comInitialized/);
    assert.match(automationHeader, /static thread_local bool initialized/);
    assert.match(automationSource, /thread_local IUIAutomation\* Win32Automation::automation/);
});

test('native environment cleanup releases worker COM state without killing Live Captions', () => {
    const source = read('native/livecaptions.cpp');
    const cleanup = functionSource(
        source,
        'void CleanupWorkerEnvironment',
        'bool WaitForWindowToClose'
    );

    assert.match(source, /env\.AddCleanupHook\(CleanupWorkerEnvironment\)/);
    assert.match(cleanup, /ReleaseCachedLiveCaptionsElements/);
    assert.match(cleanup, /Win32Automation::Cleanup/);
    assert.doesNotMatch(cleanup, /TerminateProcess/);
});

test('worker Stop detaches native state without terminating an app-owned caption process', () => {
    const source = read('native/livecaptions.cpp');
    const cleanup = functionSource(
        source,
        'Napi::Value Cleanup',
        'Napi::Object Init'
    );

    assert.match(cleanup, /CleanupWorkerEnvironment\(\)/);
    assert.doesNotMatch(cleanup, /TerminateRegisteredOwnedProcess/);
    assert.doesNotMatch(cleanup, /CloseTrackedLiveCaptions/);
});

test('native process-handle registry preserves ownership without PID-reuse termination risk', () => {
    const source = read('native/livecaptions.cpp');
    const automationHeader = read('native/win32_automation.h');
    const automationSource = read('native/win32_automation.cpp');
    const launch = functionSource(source, 'Napi::Value LaunchLiveCaptions', 'Napi::Value GetCaptions');
    const nativeLaunch = functionSource(
        automationSource,
        'HRESULT Win32Automation::LaunchLiveCaptions',
        'HRESULT Win32Automation::FindWindowByProcessId'
    );

    assert.match(source, /static std::mutex g_ownedProcessMutex/);
    assert.match(source, /static HANDLE g_appOwnedProcessHandle/);
    assert.match(source, /static DWORD g_appOwnedProcessId/);
    assert.match(automationHeader, /HANDLE\* launchedProcessHandle/);
    assert.match(nativeLaunch, /\*launchedProcessHandle\s*=\s*pi\.hProcess/);
    assert.doesNotMatch(nativeLaunch, /CloseHandle\(pi\.hProcess\)/);
    assert.match(launch, /RegisterAppOwnedProcess\(processId, launchedProcessHandle\)/);
    assert.match(launch, /IsRegisteredOwnedProcess\(processId\)/);
    assert.match(source, /TerminateRegisteredOwnedProcess[\s\S]*TerminateProcess\(g_appOwnedProcessHandle/);
    assert.match(source, /WaitForRegisteredOwnedProcessExit\(DWORD trackedProcessId/);
    assert.doesNotMatch(source, /void ClearRegisteredOwnership\(/);
    assert.match(source, /CloseLiveCaptions[\s\S]*GetRegisteredOwnedProcessId\(\)/);
    assert.doesNotMatch(source, /static std::atomic<DWORD> g_appOwnedProcessId/);
});

test('replacement attaches to a live registered process before any new CreateProcess path', () => {
    const source = read('native/livecaptions.cpp');
    const launch = functionSource(source, 'Napi::Value LaunchLiveCaptions', 'Napi::Value GetCaptions');
    const registeredLookupIndex = launch.indexOf('GetRegisteredOwnedProcessId()');
    const nativeLaunchIndex = launch.indexOf('Win32Automation::LaunchLiveCaptions');

    assert.notEqual(registeredLookupIndex, -1);
    assert.notEqual(nativeLaunchIndex, -1);
    assert.ok(
        registeredLookupIndex < nativeLaunchIndex,
        'registered process must be attached before find-or-create runs'
    );
    assert.match(
        launch,
        /registeredProcessId[\s\S]*AttachToLiveCaptionsWindow\(registeredProcessId\)[\s\S]*CreateLifecycleResult/
    );
    assert.match(
        source,
        /RegisterAppOwnedProcess[\s\S]*IsRegisteredProcessAliveLocked[\s\S]*TerminateProcess\(processHandle/
    );
});

test('native initialization unwinds failed COM setup and verifies UTF-8 conversion', () => {
    const binding = read('native/livecaptions.cpp');
    const automationSource = read('native/win32_automation.cpp');
    const initialize = functionSource(
        automationSource,
        'HRESULT Win32Automation::Initialize',
        'void Win32Automation::Cleanup'
    );
    const getCaptions = functionSource(
        binding,
        'Napi::Value GetCaptions',
        'Napi::Value RestartLiveCaptions'
    );

    assert.match(initialize, /if \(FAILED\(hr\)\)[\s\S]*CoUninitialize\(\)/);
    assert.match(getCaptions, /const int convertedCount = WideCharToMultiByte/);
    assert.match(getCaptions, /if \(convertedCount <= 0\)[\s\S]*LIVECAPTIONS_TEXT_CONVERSION_FAILED/);
});

test('owned close waits for exact process-handle exit before clearing ownership', () => {
    const source = read('native/livecaptions.cpp');
    const closeTracked = functionSource(
        source,
        'bool CloseTrackedLiveCaptions',
        'bool AttachToLiveCaptionsWindow'
    );
    const terminate = functionSource(
        source,
        'HRESULT TerminateRegisteredOwnedProcess',
        'Napi::Object CreateCaptionOkSnapshot'
    );

    assert.match(closeTracked, /WaitForRegisteredOwnedProcessExit\(\s*trackedProcessId/);
    assert.match(terminate, /TerminateProcess\(g_appOwnedProcessHandle/);
    assert.match(terminate, /WaitForSingleObject\(g_appOwnedProcessHandle/);
    assert.match(terminate, /WAIT_OBJECT_0[\s\S]*ClearRegisteredOwnershipLocked/);
    const terminateIndex = terminate.indexOf('TerminateProcess(g_appOwnedProcessHandle');
    const exitWaitIndex = terminate.indexOf('WaitForSingleObject(g_appOwnedProcessHandle', terminateIndex);
    const clearIndex = terminate.indexOf('ClearRegisteredOwnershipLocked()', exitWaitIndex);
    assert.ok(terminateIndex < exitWaitIndex, 'termination must be followed by an exact handle wait');
    assert.ok(exitWaitIndex < clearIndex, 'ownership clears only after the post-termination wait');
});

test('only the worker loads the Live Captions native handler and main has no direct native operations', () => {
    const main = read('main.js');
    const captionSync = read('src/captionSync.js');
    const worker = read('src/liveCaptionsWorker.js');

    assert.doesNotMatch(main, /require\(['"]\.\/src\/livecaptions['"]\)/);
    assert.doesNotMatch(captionSync, /require\(['"]\.\/livecaptions['"]\)/);
    assert.match(worker, /require\(['"]\.\/livecaptions['"]\)/);
    assert.doesNotMatch(main, /\.(?:getCaptions|launchLiveCaptions|restartLiveCaptions|closeLiveCaptions)\s*\(/);
});

test('main caption source errors do not clear accumulated transcript state', () => {
    const main = read('main.js');
    const listenerStart = main.indexOf("captionSync.on('error'");
    const listenerEnd = main.indexOf('\n  });', listenerStart);
    assert.notEqual(listenerStart, -1);
    assert.notEqual(listenerEnd, -1);
    const listener = main.slice(listenerStart, listenerEnd);

    assert.doesNotMatch(listener, /latestTranscriptText\s*=\s*['"]{2}/);
    assert.doesNotMatch(listener, /latestTranscriptEntries\s*=\s*\[\]/);
    assert.doesNotMatch(listener, /translationManager\.reset/);
    assert.doesNotMatch(listener, /resetTranscriptCursors/);
});
