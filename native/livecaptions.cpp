#include <napi.h>
#include "win32_automation.h"
#include <thread>
#include <chrono>
#include <string>

// Global references
static IUIAutomationElement* g_window = nullptr;
static IUIAutomationElement* g_textBlock = nullptr;
static DWORD g_processId = 0;
static bool g_ownsProcess = false;

bool GetLiveCaptionsWindowHandle(HWND* windowHandle, bool allowLaunch);

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
    HWND windowHandle = nullptr;
    bool closed = false;

    if (GetLiveCaptionsWindowHandle(&windowHandle, false) && windowHandle && IsWindow(windowHandle)) {
        PostMessageW(windowHandle, WM_CLOSE, 0, 0);
        closed = WaitForWindowToClose(windowHandle, 2000);
    }

    if (!closed && allowOwnedProcessTerminate && g_ownsProcess && g_processId) {
        HRESULT killHr = Win32Automation::KillProcess(g_processId);
        if (SUCCEEDED(killHr)) {
            std::this_thread::sleep_for(std::chrono::milliseconds(250));
            closed = true;
        }
    }

    ReleaseCachedLiveCaptionsElements();
    g_processId = 0;
    g_ownsProcess = false;

    return closed;
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
    HRESULT hr = Win32Automation::LaunchLiveCaptions(&processId, &launchedProcess);
    if (FAILED(hr)) {
        return false;
    }

    g_processId = processId;
    g_ownsProcess = launchedProcess;
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

    DWORD processId = 0;
    bool launchedProcess = false;
    HRESULT hr = Win32Automation::LaunchLiveCaptions(&processId, &launchedProcess);

    if (FAILED(hr)) {
        return Napi::Boolean::New(env, false);
    }

    g_processId = processId;
    g_ownsProcess = launchedProcess;

    return Napi::Boolean::New(env, AttachToLiveCaptionsWindow(processId));
}

// Get captions text
Napi::Value GetCaptions(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (!g_window) {
        return Napi::String::New(env, "");
    }

    // Find text block if not cached
    if (!g_textBlock) {
        HRESULT hr = Win32Automation::FindElementByAutomationId(
            g_window,
            L"CaptionsTextBlock",
            &g_textBlock
        );
        if (FAILED(hr) || !g_textBlock) {
            return Napi::String::New(env, "");
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
        return Napi::String::New(env, "");
    }

    // Convert wstring to UTF-8 string
    int size_needed = WideCharToMultiByte(CP_UTF8, 0, text.c_str(), -1, NULL, 0, NULL, NULL);
    if (size_needed <= 0) {
        return Napi::String::New(env, "");
    }

    std::string utf8_text(size_needed, 0);
    WideCharToMultiByte(CP_UTF8, 0, text.c_str(), -1, &utf8_text[0], size_needed, NULL, NULL);
    if (!utf8_text.empty() && utf8_text.back() == '\0') {
        utf8_text.pop_back();
    }

    return Napi::String::New(env, utf8_text);
}

// Restart LiveCaptions and reattach to its window
Napi::Value RestartLiveCaptions(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (g_processId || g_window) {
        if (!CloseTrackedLiveCaptions(true)) {
            return Napi::Boolean::New(env, false);
        }
    }

    g_processId = 0;
    g_ownsProcess = false;

    DWORD processId = 0;
    bool launchedProcess = false;
    HRESULT hr = Win32Automation::LaunchLiveCaptions(&processId, &launchedProcess);
    if (FAILED(hr)) {
        return Napi::Boolean::New(env, false);
    }

    g_processId = processId;
    g_ownsProcess = launchedProcess;

    return Napi::Boolean::New(env, AttachToLiveCaptionsWindow(processId));
}

Napi::Value CloseLiveCaptions(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
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

    if (!GetLiveCaptionsWindowHandle(&windowHandle, shouldShow)) {
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
    ReleaseCachedLiveCaptionsElements();
    if (g_ownsProcess && g_processId) {
        Win32Automation::KillProcess(g_processId);
    }
    g_processId = 0;
    g_ownsProcess = false;
    Win32Automation::Cleanup();
    return info.Env().Undefined();
}

// Module initialization
Napi::Object Init(Napi::Env env, Napi::Object exports) {
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
