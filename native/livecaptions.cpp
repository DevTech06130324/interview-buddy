#include <napi.h>
#include "win32_automation.h"
#include <thread>
#include <chrono>
#include <mutex>
#include <string>

// COM/UI Automation references stay on the worker thread that created them.
static thread_local IUIAutomationElement* g_window = nullptr;
static thread_local IUIAutomationElement* g_textBlock = nullptr;
static thread_local DWORD g_processId = 0;
static thread_local bool g_ownsProcess = false;

// Process ownership must survive a worker crash that occurs after CreateProcess
// but before the worker can send its start response to Electron main.
static std::mutex g_ownedProcessMutex;
static HANDLE g_appOwnedProcessHandle = nullptr;
static DWORD g_appOwnedProcessId = 0;
static constexpr DWORD PROCESS_EXIT_GRACE_MS = 2000;
static constexpr DWORD PROCESS_TERMINATE_WAIT_MS = 2000;

bool GetLiveCaptionsWindowHandle(HWND* windowHandle, bool allowLaunch);
bool AttachToLiveCaptionsWindow(DWORD processId);

void ClearRegisteredOwnershipLocked() {
    if (g_appOwnedProcessHandle) {
        CloseHandle(g_appOwnedProcessHandle);
        g_appOwnedProcessHandle = nullptr;
    }
    g_appOwnedProcessId = 0;
}

bool IsRegisteredProcessAliveLocked() {
    if (!g_appOwnedProcessHandle || !g_appOwnedProcessId) {
        return false;
    }

    const DWORD waitResult = WaitForSingleObject(g_appOwnedProcessHandle, 0);
    if (waitResult == WAIT_TIMEOUT) {
        return true;
    }
    if (waitResult == WAIT_OBJECT_0) {
        ClearRegisteredOwnershipLocked();
    }
    return false;
}

bool RegisterAppOwnedProcess(DWORD processId, HANDLE processHandle) {
    if (!processId || !processHandle) {
        return false;
    }

    std::lock_guard<std::mutex> lock(g_ownedProcessMutex);
    if (IsRegisteredProcessAliveLocked()) {
        if (g_appOwnedProcessId == processId) {
            CloseHandle(processHandle);
            return true;
        }

        TerminateProcess(processHandle, 0);
        CloseHandle(processHandle);
        return false;
    }

    // An invalid retained handle is not proof that the registered process
    // exited. Keep the record instead of replacing its ownership authority.
    if (g_appOwnedProcessHandle || g_appOwnedProcessId) {
        TerminateProcess(processHandle, 0);
        CloseHandle(processHandle);
        return false;
    }

    g_appOwnedProcessId = processId;
    g_appOwnedProcessHandle = processHandle;
    return true;
}

bool IsRegisteredOwnedProcess(DWORD processId) {
    std::lock_guard<std::mutex> lock(g_ownedProcessMutex);
    return IsRegisteredProcessAliveLocked() && g_appOwnedProcessId == processId;
}

DWORD GetRegisteredOwnedProcessId() {
    std::lock_guard<std::mutex> lock(g_ownedProcessMutex);
    return IsRegisteredProcessAliveLocked() ? g_appOwnedProcessId : 0;
}

bool WaitForRegisteredOwnedProcessExit(DWORD trackedProcessId, DWORD timeoutMs) {
    std::lock_guard<std::mutex> lock(g_ownedProcessMutex);
    if (
        !trackedProcessId
        || trackedProcessId != g_appOwnedProcessId
        || !g_appOwnedProcessHandle
    ) {
        return false;
    }

    const DWORD waitResult = WaitForSingleObject(g_appOwnedProcessHandle, timeoutMs);
    if (waitResult == WAIT_OBJECT_0) {
        ClearRegisteredOwnershipLocked();
        return true;
    }
    return false;
}

HRESULT TerminateRegisteredOwnedProcess(
    DWORD trackedProcessId,
    DWORD timeoutMs = PROCESS_TERMINATE_WAIT_MS
) {
    std::lock_guard<std::mutex> lock(g_ownedProcessMutex);
    if (
        !trackedProcessId
        || trackedProcessId != g_appOwnedProcessId
        || !g_appOwnedProcessHandle
    ) {
        return E_FAIL;
    }

    const DWORD waitResult = WaitForSingleObject(g_appOwnedProcessHandle, 0);
    if (waitResult == WAIT_OBJECT_0) {
        ClearRegisteredOwnershipLocked();
        return S_OK;
    }
    if (waitResult == WAIT_FAILED) {
        return HRESULT_FROM_WIN32(GetLastError());
    }

    if (!TerminateProcess(g_appOwnedProcessHandle, 0)) {
        return HRESULT_FROM_WIN32(GetLastError());
    }

    const DWORD exitWaitResult = WaitForSingleObject(g_appOwnedProcessHandle, timeoutMs);
    if (exitWaitResult == WAIT_OBJECT_0) {
        ClearRegisteredOwnershipLocked();
        return S_OK;
    }
    if (exitWaitResult == WAIT_TIMEOUT) {
        return HRESULT_FROM_WIN32(ERROR_TIMEOUT);
    }
    return HRESULT_FROM_WIN32(GetLastError());
}

Napi::Object CreateCaptionOkSnapshot(Napi::Env env, const std::string& text) {
    Napi::Object snapshot = Napi::Object::New(env);
    snapshot.Set("status", Napi::String::New(env, "ok"));
    snapshot.Set("text", Napi::String::New(env, text));
    return snapshot;
}

Napi::Object CreateCaptionUnavailableSnapshot(
    Napi::Env env,
    const char* code,
    const char* message
) {
    Napi::Object snapshot = Napi::Object::New(env);
    snapshot.Set("status", Napi::String::New(env, "unavailable"));
    snapshot.Set("code", Napi::String::New(env, code));
    snapshot.Set("message", Napi::String::New(env, message));
    return snapshot;
}

Napi::Object CreateLifecycleResult(
    Napi::Env env,
    bool success,
    DWORD processId,
    bool owned
) {
    Napi::Object result = Napi::Object::New(env);
    result.Set("success", Napi::Boolean::New(env, success));
    result.Set("processId", Napi::Number::New(env, static_cast<double>(processId)));
    result.Set("owned", Napi::Boolean::New(env, owned));
    return result;
}

void ReleaseCachedLiveCaptionsElements() {
    if (g_textBlock) {
        g_textBlock->Release();
        g_textBlock = nullptr;
    }
    if (g_window) {
        g_window->Release();
        g_window = nullptr;
    }
}

void CleanupWorkerEnvironment() {
    ReleaseCachedLiveCaptionsElements();
    g_processId = 0;
    g_ownsProcess = false;
    Win32Automation::Cleanup();
}

bool WaitForWindowToClose(HWND windowHandle, int timeoutMs) {
    const auto deadline = std::chrono::steady_clock::now() + std::chrono::milliseconds(timeoutMs);

    while (std::chrono::steady_clock::now() < deadline) {
        if (!IsWindow(windowHandle)) {
            return true;
        }

        std::this_thread::sleep_for(std::chrono::milliseconds(50));
    }

    return !IsWindow(windowHandle);
}

bool CloseTrackedLiveCaptions(bool allowOwnedProcessTerminate) {
    const DWORD trackedProcessId = g_processId;
    const bool trackedProcessOwned = IsRegisteredOwnedProcess(trackedProcessId);
    if (!trackedProcessOwned) {
        ReleaseCachedLiveCaptionsElements();
        g_processId = 0;
        g_ownsProcess = false;
        return true;
    }

    HWND windowHandle = nullptr;
    if (GetLiveCaptionsWindowHandle(&windowHandle, false) && windowHandle && IsWindow(windowHandle)) {
        DWORD windowProcessId = 0;
        GetWindowThreadProcessId(windowHandle, &windowProcessId);
        if (windowProcessId == trackedProcessId) {
            PostMessageW(windowHandle, WM_CLOSE, 0, 0);
            WaitForWindowToClose(windowHandle, 2000);
        }
    }

    bool exited = WaitForRegisteredOwnedProcessExit(
        trackedProcessId,
        PROCESS_EXIT_GRACE_MS
    );
    if (!exited && allowOwnedProcessTerminate) {
        exited = SUCCEEDED(TerminateRegisteredOwnedProcess(trackedProcessId));
    }

    ReleaseCachedLiveCaptionsElements();
    g_processId = 0;
    g_ownsProcess = false;
    return exited;
}

bool AttachToLiveCaptionsWindow(DWORD processId) {
    IUIAutomationElement* window = nullptr;
    int attempts = 0;
    const int maxAttempts = 500; // 5 seconds max wait (500 * 10ms)

    while (attempts < maxAttempts) {
        const HRESULT hr = Win32Automation::FindWindowByProcessId(processId, &window);
        if (SUCCEEDED(hr) && window) {
            BSTR className = nullptr;
            window->get_CurrentClassName(&className);
            if (className) {
                std::wstring clsName(className);
                SysFreeString(className);
                if (clsName == L"LiveCaptionsDesktopWindow") {
                    if (g_textBlock) {
                        g_textBlock->Release();
                        g_textBlock = nullptr;
                    }
                    if (g_window) {
                        g_window->Release();
                    }
                    g_window = window;
                    return true;
                }
            }

            window->Release();
            window = nullptr;
        }

        std::this_thread::sleep_for(std::chrono::milliseconds(10));
        attempts++;
    }

    return false;
}

bool ReinitializeAndReattachTrackedProcess(DWORD processId) {
    if (!processId) {
        return false;
    }

    ReleaseCachedLiveCaptionsElements();
    Win32Automation::Cleanup();
    g_processId = processId;
    g_ownsProcess = false;

    const HRESULT initializeHr = Win32Automation::Initialize();
    if (FAILED(initializeHr)) {
        return false;
    }
    return AttachToLiveCaptionsWindow(processId);
}

bool EnsureLiveCaptionsWindowReady(bool allowLaunch) {
    if (g_window) {
        return true;
    }

    if (g_processId && AttachToLiveCaptionsWindow(g_processId)) {
        return true;
    }

    if (!allowLaunch) {
        return false;
    }

    DWORD processId = 0;
    bool launchedProcess = false;
    HANDLE launchedProcessHandle = nullptr;
    HRESULT hr = Win32Automation::LaunchLiveCaptions(
        &processId,
        &launchedProcess,
        &launchedProcessHandle
    );
    if (FAILED(hr)) {
        return false;
    }

    g_processId = processId;
    g_ownsProcess = false;
    if (
        launchedProcess
        && !RegisterAppOwnedProcess(processId, launchedProcessHandle)
    ) {
        g_processId = 0;
        g_ownsProcess = false;
        return false;
    }
    g_ownsProcess = IsRegisteredOwnedProcess(processId);
    return AttachToLiveCaptionsWindow(processId);
}

bool GetLiveCaptionsWindowHandle(HWND* windowHandle, bool allowLaunch) {
    if (!windowHandle) {
        return false;
    }

    *windowHandle = nullptr;

    if (!EnsureLiveCaptionsWindowReady(allowLaunch)) {
        return false;
    }

    HRESULT hr = Win32Automation::GetElementWindowHandle(g_window, windowHandle);
    if (SUCCEEDED(hr) && *windowHandle) {
        return true;
    }

    if (g_window) {
        g_window->Release();
        g_window = nullptr;
    }

    if (!EnsureLiveCaptionsWindowReady(allowLaunch)) {
        return false;
    }

    hr = Win32Automation::GetElementWindowHandle(g_window, windowHandle);
    return SUCCEEDED(hr) && *windowHandle != nullptr;
}

// Initialize UI Automation
Napi::Value Initialize(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    HRESULT hr = Win32Automation::Initialize();
    return Napi::Boolean::New(env, SUCCEEDED(hr));
}

// Launch LiveCaptions
Napi::Value LaunchLiveCaptions(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    const DWORD registeredProcessId = GetRegisteredOwnedProcessId();
    if (registeredProcessId) {
        g_processId = registeredProcessId;
        g_ownsProcess = true;
        return CreateLifecycleResult(
            env,
            AttachToLiveCaptionsWindow(registeredProcessId),
            registeredProcessId,
            true
        );
    }

    DWORD processId = 0;
    bool launchedProcess = false;
    HANDLE launchedProcessHandle = nullptr;
    HRESULT hr = Win32Automation::LaunchLiveCaptions(
        &processId,
        &launchedProcess,
        &launchedProcessHandle
    );

    if (FAILED(hr)) {
        return CreateLifecycleResult(env, false, 0, false);
    }

    g_processId = processId;
    if (
        launchedProcess
        && !RegisterAppOwnedProcess(processId, launchedProcessHandle)
    ) {
        g_processId = 0;
        g_ownsProcess = false;
        return CreateLifecycleResult(env, false, 0, false);
    }
    g_ownsProcess = IsRegisteredOwnedProcess(processId);

    return CreateLifecycleResult(
        env,
        AttachToLiveCaptionsWindow(processId),
        processId,
        g_ownsProcess
    );
}

// Get captions text
Napi::Value GetCaptions(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (!g_window) {
        return CreateCaptionUnavailableSnapshot(
            env,
            "LIVECAPTIONS_WINDOW_UNAVAILABLE",
            "The Live Captions window is unavailable."
        );
    }

    // Find text block if not cached
    if (!g_textBlock) {
        HRESULT hr = Win32Automation::FindElementByAutomationId(
            g_window,
            L"CaptionsTextBlock",
            &g_textBlock
        );
        if (FAILED(hr) || !g_textBlock) {
            return CreateCaptionUnavailableSnapshot(
                env,
                "LIVECAPTIONS_ELEMENT_UNAVAILABLE",
                "The Live Captions text element is unavailable."
            );
        }
    }

    std::wstring text;
    HRESULT hr = Win32Automation::GetElementText(g_textBlock, text);

    if (FAILED(hr)) {
        // Element might be invalid, reset cache
        if (g_textBlock) {
            g_textBlock->Release();
            g_textBlock = nullptr;
        }
        return CreateCaptionUnavailableSnapshot(
            env,
            "LIVECAPTIONS_READ_FAILED",
            "The Live Captions text could not be read."
        );
    }

    // Convert wstring to UTF-8 string
    int size_needed = WideCharToMultiByte(CP_UTF8, 0, text.c_str(), -1, NULL, 0, NULL, NULL);
    if (size_needed <= 0) {
        return CreateCaptionUnavailableSnapshot(
            env,
            "LIVECAPTIONS_TEXT_CONVERSION_FAILED",
            "The Live Captions text could not be converted to UTF-8."
        );
    }

    std::string utf8_text(size_needed, 0);
    const int convertedCount = WideCharToMultiByte(
        CP_UTF8,
        0,
        text.c_str(),
        -1,
        &utf8_text[0],
        size_needed,
        NULL,
        NULL
    );
    if (convertedCount <= 0) {
        return CreateCaptionUnavailableSnapshot(
            env,
            "LIVECAPTIONS_TEXT_CONVERSION_FAILED",
            "The Live Captions text could not be converted to UTF-8."
        );
    }
    if (!utf8_text.empty() && utf8_text.back() == '\0') {
        utf8_text.pop_back();
    }

    return CreateCaptionOkSnapshot(env, utf8_text);
}

// Restart LiveCaptions and reattach to its window
Napi::Value RestartLiveCaptions(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (g_processId || g_window) {
        if (!IsRegisteredOwnedProcess(g_processId)) {
            const DWORD unownedProcessId = g_processId;
            const bool reattached = ReinitializeAndReattachTrackedProcess(g_processId);
            return CreateLifecycleResult(env, reattached, unownedProcessId, false);
        }

        const DWORD ownedProcessId = g_processId;
        if (!CloseTrackedLiveCaptions(true)) {
            return CreateLifecycleResult(
                env,
                false,
                ownedProcessId,
                IsRegisteredOwnedProcess(ownedProcessId)
            );
        }
    }

    g_processId = 0;
    g_ownsProcess = false;

    DWORD processId = 0;
    bool launchedProcess = false;
    HANDLE launchedProcessHandle = nullptr;
    HRESULT hr = Win32Automation::LaunchLiveCaptions(
        &processId,
        &launchedProcess,
        &launchedProcessHandle
    );
    if (FAILED(hr)) {
        return CreateLifecycleResult(env, false, 0, false);
    }

    g_processId = processId;
    g_ownsProcess = false;
    if (
        launchedProcess
        && !RegisterAppOwnedProcess(processId, launchedProcessHandle)
    ) {
        g_processId = 0;
        g_ownsProcess = false;
        return CreateLifecycleResult(env, false, 0, false);
    }
    g_ownsProcess = IsRegisteredOwnedProcess(processId);

    return CreateLifecycleResult(
        env,
        AttachToLiveCaptionsWindow(processId),
        processId,
        g_ownsProcess
    );
}

Napi::Value CloseLiveCaptions(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (!g_ownsProcess && !g_processId) {
        const DWORD registeredProcessId = GetRegisteredOwnedProcessId();
        if (registeredProcessId) {
            g_processId = registeredProcessId;
            g_ownsProcess = true;
        }
    }
    return Napi::Boolean::New(env, CloseTrackedLiveCaptions(true));
}

Napi::Value SetLiveCaptionsVisible(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (info.Length() < 1 || !info[0].IsBoolean()) {
        Napi::TypeError::New(env, "Expected a boolean visibility argument").ThrowAsJavaScriptException();
        return env.Null();
    }

    const bool shouldShow = info[0].As<Napi::Boolean>().Value();
    HWND windowHandle = nullptr;

    if (!GetLiveCaptionsWindowHandle(&windowHandle, false)) {
        return Napi::Boolean::New(env, false);
    }

    if (shouldShow) {
        ShowWindow(windowHandle, SW_SHOWNOACTIVATE);
        SetWindowPos(
            windowHandle,
            HWND_TOPMOST,
            0,
            0,
            0,
            0,
            SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_SHOWWINDOW
        );
    } else {
        ShowWindow(windowHandle, SW_HIDE);
    }

    return Napi::Boolean::New(env, true);
}

Napi::Value IsLiveCaptionsVisible(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    HWND windowHandle = nullptr;
    if (!GetLiveCaptionsWindowHandle(&windowHandle, false)) {
        return Napi::Boolean::New(env, false);
    }

    return Napi::Boolean::New(env, IsWindowVisible(windowHandle) != FALSE);
}

// Cleanup
Napi::Value Cleanup(const Napi::CallbackInfo& info) {
    // Worker stop is a detach/pause operation. Process termination is reserved
    // for CloseLiveCaptions during explicit app shutdown/restart.
    CleanupWorkerEnvironment();
    return info.Env().Undefined();
}

// Module initialization
Napi::Object Init(Napi::Env env, Napi::Object exports) {
    env.AddCleanupHook(CleanupWorkerEnvironment);
    exports.Set(
        Napi::String::New(env, "initialize"),
        Napi::Function::New(env, Initialize)
    );
    exports.Set(
        Napi::String::New(env, "launchLiveCaptions"),
        Napi::Function::New(env, LaunchLiveCaptions)
    );
    exports.Set(
        Napi::String::New(env, "getCaptions"),
        Napi::Function::New(env, GetCaptions)
    );
    exports.Set(
        Napi::String::New(env, "restartLiveCaptions"),
        Napi::Function::New(env, RestartLiveCaptions)
    );
    exports.Set(
        Napi::String::New(env, "setLiveCaptionsVisible"),
        Napi::Function::New(env, SetLiveCaptionsVisible)
    );
    exports.Set(
        Napi::String::New(env, "isLiveCaptionsVisible"),
        Napi::Function::New(env, IsLiveCaptionsVisible)
    );
    exports.Set(
        Napi::String::New(env, "closeLiveCaptions"),
        Napi::Function::New(env, CloseLiveCaptions)
    );
    exports.Set(
        Napi::String::New(env, "cleanup"),
        Napi::Function::New(env, Cleanup)
    );
    return exports;
}

NODE_API_MODULE(livecaptions_native, Init)
