#ifndef WIN32_AUTOMATION_H
#define WIN32_AUTOMATION_H

#include <windows.h>
#include <UIAutomation.h>
#include <string>

#pragma comment(lib, "UIAutomationCore.lib")
#pragma comment(lib, "Ole32.lib")
#pragma comment(lib, "OleAut32.lib")

class Win32Automation {
public:
    static HRESULT Initialize();
    static void Cleanup();

    // Launch LiveCaptions process if needed, or attach to the existing one.
    static HRESULT LaunchLiveCaptions(DWORD* processId, bool* launchedProcess);

    // Find the Live Captions top-level window for a process ID.
    static HRESULT FindWindowByProcessId(DWORD processId, IUIAutomationElement** window);

    // Find element by AutomationId
    static HRESULT FindElementByAutomationId(
        IUIAutomationElement* parent,
        const wchar_t* automationId,
        IUIAutomationElement** element
    );

    // Get text from element
    static HRESULT GetElementText(IUIAutomationElement* element, std::wstring& text);
    static HRESULT GetElementWindowHandle(IUIAutomationElement* element, HWND* windowHandle);

    static HRESULT KillProcess(DWORD processId);

private:
    static IUIAutomation* automation;
    static bool comInitialized;
    static bool initialized;
};

#endif
