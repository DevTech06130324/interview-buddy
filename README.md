# Notepad++

Windows-focused Electron overlay that combines a transcript panel, an embedded browser, and prompt modes for ChatGPT and DeepSeek.

## Overview

The app opens a frameless, always-on-top window with three working areas:

- a left transcript panel fed by Windows Live Captions
- a right tabbed browser area powered by Electron `BrowserView`
- a bottom `Mode` panel for choosing the prompt appended to assistant sends

On startup it opens:

- `https://chatgpt.com/`
- `https://chat.deepseek.com/`

Assistant automation is designed for the active tab when that tab is one of these supported hosts:

- `chatgpt.com`
- `chat.openai.com`
- `chat.deepseek.com`
- `deepseek.com`
- `www.deepseek.com`

## Features

- Frameless transparent overlay window that stays on top and hides from the taskbar
- Transcript title bar doubles as a drag handle for moving the window
- Draggable divider between the left transcript pane and right browser pane
- Transcript controls:
  - eye icon shows or hides the Windows Live Captions window
  - recycle icon clears the transcript panel and restarts Windows Live Captions
- Browser tabs with new tab, close tab, switch tab, reload, back, forward, and address bar navigation
- `Mode` panel at the bottom:
  - starts collapsed by default
  - collapsed state shows the current mode selector and a one-line prompt preview
  - expanded state lets you pick a mode, edit its prompt, and set a per-mode global hotkey
  - prompt changes auto-save
  - dropdown supports add mode, double-click rename, and delete
- Transcript-to-assistant automation for ChatGPT and DeepSeek
- Screenshot-to-assistant attachment automation for ChatGPT and DeepSeek
- Selected-area screen capture to the clipboard
- Global mute toggle for all tabs
- Global window movement and opacity controls

## Prompt Behavior

Each mode stores its own prompt. The currently selected mode controls what is appended when `Ctrl+Enter` is used.

When transcript text exists, the app sends:

```text
Interviewer said like this
"""
<transcript>
"""

<current mode prompt>
```

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
- `Ctrl+Enter`: inject the transcript and current mode prompt into the active ChatGPT or DeepSeek tab and submit it
- `Ctrl+Shift+Enter`: capture the current display and attach the screenshot to the active ChatGPT or DeepSeek tab
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

## Run

```powershell
npm start
```

If your shell has `ELECTRON_RUN_AS_NODE=1`, clear it first:

```powershell
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
```

## Build

Install dependencies:

```powershell
npm install
```

Rebuild the native addon:

```powershell
npm run build-native
```

Create a packaged Windows app:

```powershell
npm run dist-packaged
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
- `src/livecaptions.js`: JavaScript bridge for the native Live Captions addon
- `src/screenCapture.js`: selected-area capture helpers
- `native/`: Windows native addon for Live Captions automation

## Notes

- Live Captions integration is Windows-only.
- If the native addon is missing, the app still runs but transcript syncing will not work.
- `Ctrl+Enter` and `Ctrl+Shift+Enter` require the active tab to be a supported ChatGPT or DeepSeek page.
