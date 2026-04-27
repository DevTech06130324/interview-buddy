const { contextBridge, ipcRenderer } = require('electron');

function subscribe(channel, callback) {
  const handler = (event, data) => callback(data);
  ipcRenderer.on(channel, handler);
  return () => {
    ipcRenderer.removeListener(channel, handler);
  };
}

contextBridge.exposeInMainWorld('electronAPI', {
  createTab: (url) => ipcRenderer.invoke('create-tab', url),
  closeApp: () => ipcRenderer.invoke('close-app'),
  openHotkeySettings: () => ipcRenderer.invoke('open-hotkey-settings'),
  closeTab: (tabId) => ipcRenderer.invoke('close-tab', tabId),
  switchTab: (tabId) => ipcRenderer.invoke('switch-tab', tabId),
  navigate: (url) => ipcRenderer.invoke('navigate', url),
  goBack: () => ipcRenderer.invoke('go-back'),
  goForward: () => ipcRenderer.invoke('go-forward'),
  reload: () => ipcRenderer.invoke('reload'),
  clearTranscript: () => ipcRenderer.invoke('clear-transcript'),
  toggleLiveCaptionsWindow: () => ipcRenderer.invoke('toggle-live-captions-window'),
  getLiveCaptionsWindowVisibility: () => ipcRenderer.invoke('get-live-captions-window-visibility'),
  setPanelSplitRatio: (ratio) => ipcRenderer.invoke('set-panel-split-ratio', ratio),
  setTranscriptPanelCollapsed: (collapsed) => ipcRenderer.invoke('set-transcript-panel-collapsed', collapsed),
  setModePanelCollapsed: (collapsed) => ipcRenderer.invoke('set-mode-panel-collapsed', collapsed),
  addPromptMode: () => ipcRenderer.invoke('add-prompt-mode'),
  selectPromptMode: (modeId) => ipcRenderer.invoke('select-prompt-mode', modeId),
  deletePromptMode: (modeId) => ipcRenderer.invoke('delete-prompt-mode', modeId),
  renamePromptMode: (payload) => ipcRenderer.invoke('rename-prompt-mode', payload),
  savePromptMode: (payload) => ipcRenderer.invoke('save-prompt-mode', payload),
  setPromptModeHotkey: (payload) => ipcRenderer.invoke('set-prompt-mode-hotkey', payload),
  getGlobalHotkeys: () => ipcRenderer.invoke('get-global-hotkeys'),
  setGlobalHotkey: (payload) => ipcRenderer.invoke('set-global-hotkey', payload),
  getActiveTab: () => ipcRenderer.invoke('get-active-tab'),
  getTabs: () => ipcRenderer.invoke('get-tabs'),

  onTabCreated: (callback) => subscribe('tab-created', callback),
  onTabClosed: (callback) => subscribe('tab-closed', callback),
  onTabSwitched: (callback) => subscribe('tab-switched', callback),
  onTabUpdated: (callback) => subscribe('tab-updated', callback),
  onTabTitleUpdated: (callback) => subscribe('tab-title-updated', callback),
  onTabNavigated: (callback) => subscribe('tab-navigated', callback),
  onTabLoading: (callback) => subscribe('tab-loading', callback),
  onPromptModeState: (callback) => subscribe('prompt-mode-state', callback),
  onFocusUrlInput: (callback) => subscribe('focus-url-input', callback),

  onCaptionUpdate: (callback) => subscribe('caption-update', callback),
  onCaptionError: (callback) => subscribe('caption-error', callback)
});
