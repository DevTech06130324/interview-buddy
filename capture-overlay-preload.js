const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('captureOverlay', {
  select: (selectionRect) => ipcRenderer.send('screen-capture-overlay-select', selectionRect),
  cancel: () => ipcRenderer.send('screen-capture-overlay-cancel')
});
