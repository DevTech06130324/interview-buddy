# Interview Buddy / Notepadd++

Windows x64-only Electron overlay that combines a transcript panel, an embedded browser, and prompt modes for ChatGPT, DeepSeek, and Claude. The packaged executable identity remains `Notepadd++`.

## Overview

The app opens a frameless, always-on-top window with three working areas:

- a left transcript panel fed by Windows Live Captions or Deepgram
- a right tabbed browser area powered by Electron `BrowserView`
- a bottom `Mode` panel for choosing the prompt appended to assistant sends

On startup it opens:

- `https://chatgpt.com/`
- `https://chat.deepseek.com/`
- `https://claude.ai/`

Assistant automation is designed for the active tab when that tab is one of these supported hosts:

- `chatgpt.com`
- `chat.openai.com`
- `chat.deepseek.com`
- `deepseek.com`
- `www.deepseek.com`
- `claude.ai`
- `www.claude.ai`

## Features

- Frameless transparent overlay window that stays on top and hides from the taskbar
- Transcript title bar doubles as a drag handle for moving the window
- Draggable divider between the left transcript pane and right browser pane
- Transcript controls:
  - eye/play/stop icon controls the active transcript source
  - recycle icon starts a new transcript session
  - source errors are shown in a live status message without deleting the transcript already on screen
- Transcript sources:
  - **Windows Live Captions** attaches to or launches the Windows caption window in a worker process
  - **Deepgram** captures system/speaker audio as `Them` and microphone audio as `Me`; it retries a failed role socket briefly, then stops safely if capture cannot recover
  - `Stop` pauses the current session. `Clear` and source switching create a new session, so late source events cannot contaminate the new transcript.
  - Deepgram keys use Electron secure storage when available. If it is unavailable, the key remains in memory for the current session only.
- Browser tabs with new tab, close tab, switch tab, reload, back, forward, and address bar navigation
- Hardened supported-assistant and OAuth popups, including Google OAuth flows
- `Mode` panel at the bottom:
  - starts collapsed by default
  - collapsed state shows the current mode selector and a one-line prompt preview
  - expanded state lets you pick a mode, edit its prompt, and set a per-mode global hotkey
  - prompt changes auto-save
  - dropdown supports add mode, double-click rename, and delete
- Transcript-to-assistant automation for ChatGPT, DeepSeek, and Claude
- Screenshot-to-assistant attachment automation for ChatGPT, DeepSeek, and Claude
- Selected-area screen capture to the clipboard with exact display matching for mixed-DPI, multi-monitor setups
- Global mute toggle for all tabs
- Global window movement and opacity controls

## Prompt Behavior

Each mode stores its own prompt. The currently selected mode controls what is appended when `Ctrl+Enter` is used.

When transcript text exists, the app sends:

```text
Conversations so far like this
"""
[Them] Can you walk me through your last project?
I wanted to understand the reliability tradeoffs.
[Me] I started by measuring the slowest path.
"""

<current mode prompt>
```

`Them` always means system/speaker output. `Me` always means microphone input. Speaker tags appear at turn boundaries, not on every line.

When transcript text is empty, the app sends only:

```text
<current mode prompt>
```

## Global Hotkeys

These work while the app is running.

- `` ` ``: hide or show the app window
- `Ctrl+Shift+Alt+Up`: increase window opacity
- `Ctrl+Shift+Alt+Down`: decrease window opacity
- `Ctrl+Shift+Up`: move window up
- `Ctrl+Shift+Down`: move window down
- `Ctrl+Shift+Left`: move window left
- `Ctrl+Shift+Right`: move window right
- `Alt+Z`: capture a user-selected area on the current display to the clipboard
- `Alt+M`: mute or unmute all browser tabs
- `Ctrl+Enter`: inject the transcript and current mode prompt into the active assistant tab and submit it
- `Ctrl+Shift+Enter`: capture the current display and attach the screenshot to the active assistant tab; the transcript cursor advances only after a confirmed send or attachment
- each mode can also have its own global hotkey that switches the current mode immediately

## In-App Shortcuts

These work while the app window or the active embedded browser tab is focused.

- `Ctrl+T`: open a new tab
- `Ctrl+R`: reload the active tab
- `Ctrl+W`: close the active tab
- `Ctrl+L`: focus the address bar
- `Alt+Left`: go back
- `Alt+Right`: go forward
- `Enter` in the address bar: navigate to the typed URL or run a Google search
- Focus the panel divider and use `Left`/`Right` to resize by 10 px, or `Home`/`End` to jump to its limits

## Run

```powershell
npm start
```

If your shell has `ELECTRON_RUN_AS_NODE=1`, clear it first:

```powershell
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
```

## Build

Install dependencies from a clean checkout:

```powershell
npm ci
```

Rebuild the native addon:

```powershell
npm run build-native
```

Create a packaged Windows app:

```powershell
npm run dist-packaged
```

Run the automated checks before packaging:

```powershell
npm test
git ls-files '*.js' -z | xargs -0 -n1 node --check
git diff --check
```

The packaged app is written to:

```text
dist-packaged\Notepadd++-win32-x64
```

## Project Layout

- `main.js`: main Electron process, window layout, tabs, shortcuts, and assistant automation
- `preload.js`: IPC bridge exposed to the renderer
- `renderer.js`: transcript panel, tab UI, mode UI, and renderer-side interactions
- `src/captionSync.js`: transcript polling and synchronization
- `src/liveCaptionsWorker.js`: worker-owned bridge for the native Live Captions addon
- `src/liveCaptionsWorkerClient.js`: main-process lifecycle and recovery controller for that worker
- `src/deepgramTranscriptionService.js`: role-isolated Deepgram WebSocket service
- `src/deepgramCaptureController.js`: renderer-owned capture-resource controller
- `src/screenCapture.js`: selected-area capture helpers
- `native/`: Windows native addon for Live Captions automation

## Windows prerequisites and notes

- This app is supported on Windows x64 only. Live Captions requires a Windows installation that provides the Live Captions feature; press `Win + Ctrl + L` to open it manually.
- Building the native addon requires the Windows C++ build tools, a Windows SDK, Python, and the toolchain required by `node-gyp`.
- If the native addon is missing, the app still runs but Live Captions transcript syncing will not work. Rebuild it with `npm run build-native` before packaging.
- `Ctrl+Enter` and `Ctrl+Shift+Enter` require the active tab to be a supported ChatGPT, DeepSeek, or Claude page.
- While an assistant send or upload is in progress, additional assistant hotkeys report a busy state rather than issuing a duplicate request. If a submission becomes uncertain after dispatch, it is not retried automatically.
