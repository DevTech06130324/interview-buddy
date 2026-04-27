#include "win32_automation.h"

IUIAutomation* Win32Automation::automation = nullptr;
bool Win32Automation::comInitialized = false;
bool Win32Automation::initialized = false;

HRESULT Win32Automation::Initialize() {
    if (initialized) return S_OK;

    HRESULT hr = CoInitializeEx(NULL, COINIT_APARTMENTTHREADED);
    if (FAILED(hr)) return hr;

    comInitialized = true;

    hr = CoCreateInstance(
        CLSID_CUIAutomation,
        NULL,
        CLSCTX_INPROC_SERVER,
        IID_IUIAutomation,
        (void**)&automation
    );

    if (SUCCEEDED(hr)) {
        initialized = true;
    }

    return hr;
}

void Win32Automation::Cleanup() {
    if (automation) {
        automation->Release();
        automation = nullptr;
    }

    if (comInitialized) {
        CoUninitialize();
        comInitialized = false;
    }

    initialized = false;
}

HRESULT Win32Automation::LaunchLiveCaptions(DWORD* processId, bool* launchedProcess) {
    if (!initialized || !processId || !launchedProcess) return E_INVALIDARG;

    *launchedProcess = false;

    // First, try to find if LiveCaptions is already running
    IUIAutomationElement* root = nullptr;
    HRESULT hr = automation->GetRootElement(&root);
    if (FAILED(hr)) return hr;

    // Search for LiveCaptions window by class name
    VARIANT classNameVar;
    VariantInit(&classNameVar);
    classNameVar.vt = VT_BSTR;
    classNameVar.bstrVal = SysAllocString(L"LiveCaptionsDesktopWindow");

    IUIAutomationCondition* condition = nullptr;
    hr = automation->CreatePropertyCondition(
        UIA_ClassNamePropertyId,
        classNameVar,
        &condition
    );

    IUIAutomationElement* window = nullptr;
    if (SUCCEEDED(hr)) {
        hr = root->FindFirst(TreeScope_Children, condition, &window);
        condition->Release();
    }

    VariantClear(&classNameVar);
    root->Release();

    // If window found, get its process ID
    if (SUCCEEDED(hr) && window) {
        VARIANT processIdVar;
        VariantInit(&processIdVar);
        hr = window->GetCurrentPropertyValue(UIA_ProcessIdPropertyId, &processIdVar);
        if (SUCCEEDED(hr) && processIdVar.vt == VT_I4) {
            *processId = processIdVar.lVal;
            window->Release();
            return S_OK;
        }
        window->Release();
    }

    // If not found, try to launch it
    // Common locations for LiveCaptions on Windows 11
    const wchar_t* paths[] = {
        L"C:\\Windows\\System32\\LiveCaptions.exe",
        L"%LOCALAPPDATA%\\Microsoft\\WindowsApps\\LiveCaptions.exe",
        L"LiveCaptions.exe"
    };

    STARTUPINFOW si = { sizeof(si) };
    PROCESS_INFORMATION pi = { 0 };

    for (int i = 0; i < 3; i++) {
        wchar_t expandedPath[MAX_PATH] = { 0 };

        if (i == 1) {
            // Expand environment variable
            DWORD expanded = ExpandEnvironmentStringsW(paths[i], expandedPath, MAX_PATH);
            if (expanded == 0 || expanded > MAX_PATH) continue;
        } else {
            wcscpy_s(expandedPath, MAX_PATH, paths[i]);
        }

        hr = CreateProcessW(
            expandedPath,
            NULL,
            NULL,
            NULL,
            FALSE,
            0,
            NULL,
            NULL,
            &si,
            &pi
        ) ? S_OK : HRESULT_FROM_WIN32(GetLastError());

        if (SUCCEEDED(hr)) {
            *processId = pi.dwProcessId;
            *launchedProcess = true;
            CloseHandle(pi.hThread);
            CloseHandle(pi.hProcess);
            return S_OK;
        }
    }

    return E_FAIL;
}

HRESULT Win32Automation::FindWindowByProcessId(DWORD processId, IUIAutomationElement** window) {
    if (!initialized || !automation || !window) return E_INVALIDARG;

    *window = nullptr;

    IUIAutomationElement* root = nullptr;
    HRESULT hr = automation->GetRootElement(&root);
    if (FAILED(hr)) return hr;

    VARIANT processIdVar;
    VariantInit(&processIdVar);
    processIdVar.vt = VT_I4;
    processIdVar.lVal = processId;

    VARIANT classNameVar;
    VariantInit(&classNameVar);
    classNameVar.vt = VT_BSTR;
    classNameVar.bstrVal = SysAllocString(L"LiveCaptionsDesktopWindow");

    IUIAutomationCondition* processCondition = nullptr;
    IUIAutomationCondition* classCondition = nullptr;
    IUIAutomationCondition* combinedCondition = nullptr;

    hr = automation->CreatePropertyCondition(
        UIA_ProcessIdPropertyId,
        processIdVar,
        &processCondition
    );

    if (SUCCEEDED(hr)) {
        hr = automation->CreatePropertyCondition(
            UIA_ClassNamePropertyId,
            classNameVar,
            &classCondition
        );
    }

    if (SUCCEEDED(hr)) {
        hr = automation->CreateAndCondition(
            processCondition,
            classCondition,
            &combinedCondition
        );
    }

    if (SUCCEEDED(hr)) {
        hr = root->FindFirst(
            TreeScope_Children,
            combinedCondition,
            window
        );
    }

    if (combinedCondition) {
        combinedCondition->Release();
    }
    if (classCondition) {
        classCondition->Release();
    }
    if (processCondition) {
        processCondition->Release();
    }

    root->Release();
    VariantClear(&classNameVar);
    VariantClear(&processIdVar);
    return hr;
}

HRESULT Win32Automation::FindElementByAutomationId(
    IUIAutomationElement* parent,
    const wchar_t* automationId,
    IUIAutomationElement** element
) {
    if (!initialized || !automation || !parent) return E_FAIL;

    VARIANT idVar;
    VariantInit(&idVar);
    idVar.vt = VT_BSTR;
    idVar.bstrVal = SysAllocString(automationId);

    IUIAutomationCondition* condition = nullptr;
    HRESULT hr = automation->CreatePropertyCondition(
        UIA_AutomationIdPropertyId,
        idVar,
        &condition
    );

    if (SUCCEEDED(hr)) {
        hr = parent->FindFirst(
            TreeScope_Descendants,
            condition,
            element
        );
        condition->Release();
    }

    VariantClear(&idVar);
    return hr;
}

HRESULT Win32Automation::GetElementText(IUIAutomationElement* element, std::wstring& text) {
    if (!element) return E_INVALIDARG;

    BSTR name = nullptr;
    HRESULT hr = element->get_CurrentName(&name);

    if (SUCCEEDED(hr) && name) {
        text = std::wstring(name);
        SysFreeString(name);
    }

    return hr;
}

HRESULT Win32Automation::GetElementWindowHandle(IUIAutomationElement* element, HWND* windowHandle) {
    if (!element || !windowHandle) return E_INVALIDARG;

    *windowHandle = nullptr;

    VARIANT handleVar;
    VariantInit(&handleVar);

    HRESULT hr = element->GetCurrentPropertyValue(UIA_NativeWindowHandlePropertyId, &handleVar);
    if (FAILED(hr)) {
        VariantClear(&handleVar);
        return hr;
    }

    LONG_PTR handleValue = 0;

    switch (handleVar.vt) {
    case VT_I4:
    case VT_INT:
        handleValue = static_cast<LONG_PTR>(handleVar.lVal);
        break;
    case VT_UI4:
    case VT_UINT:
        handleValue = static_cast<LONG_PTR>(handleVar.ulVal);
        break;
    case VT_I8:
        handleValue = static_cast<LONG_PTR>(handleVar.llVal);
        break;
    case VT_UI8:
        handleValue = static_cast<LONG_PTR>(handleVar.ullVal);
        break;
    default:
        hr = E_FAIL;
        break;
    }

    VariantClear(&handleVar);

    if (FAILED(hr) || handleValue == 0) {
        return FAILED(hr) ? hr : E_FAIL;
    }

    *windowHandle = reinterpret_cast<HWND>(handleValue);
    return S_OK;
}

HRESULT Win32Automation::KillProcess(DWORD processId) {
    HANDLE hProcess = OpenProcess(PROCESS_TERMINATE, FALSE, processId);
    if (!hProcess) return HRESULT_FROM_WIN32(GetLastError());

    BOOL result = TerminateProcess(hProcess, 0);
    CloseHandle(hProcess);

    return result ? S_OK : HRESULT_FROM_WIN32(GetLastError());
}
