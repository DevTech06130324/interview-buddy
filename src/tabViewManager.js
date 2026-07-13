'use strict';

function getContentView(window) {
  const contentView = window?.contentView;
  if (!contentView || typeof contentView.addChildView !== 'function' || typeof contentView.removeChildView !== 'function') {
    throw new Error('Electron WebContentsView support is unavailable on this Electron runtime.');
  }

  return contentView;
}

function attachTabView(window, view) {
  if (!window || window.isDestroyed?.() || !view) {
    return false;
  }

  getContentView(window).addChildView(view);
  return true;
}

function detachTabView(window, view) {
  if (!window || window.isDestroyed?.() || !view) {
    return false;
  }

  getContentView(window).removeChildView(view);
  return true;
}

function setTabViewBounds(view, bounds) {
  if (!view || typeof view.setBounds !== 'function') {
    return false;
  }

  view.setBounds({
    x: Math.max(0, Math.round(Number(bounds?.x) || 0)),
    y: Math.max(0, Math.round(Number(bounds?.y) || 0)),
    width: Math.max(0, Math.round(Number(bounds?.width) || 0)),
    height: Math.max(0, Math.round(Number(bounds?.height) || 0))
  });
  return true;
}

function createTabView(WebContentsView, webPreferences = {}) {
  if (typeof WebContentsView !== 'function') {
    throw new Error('WebContentsView is not available. Electron 30 or newer is required.');
  }

  const view = new WebContentsView({ webPreferences });
  if (typeof view.setBackgroundColor === 'function') {
    view.setBackgroundColor('#00000000');
  }
  return view;
}

function destroyTabView(window, view) {
  if (!view) {
    return false;
  }

  try {
    detachTabView(window, view);
  } catch (error) {
    // A detached view is already in the desired state. Cleanup must remain
    // best-effort when a window is closing or Electron has removed the view.
  }

  const webContents = view.webContents;
  if (webContents && !webContents.isDestroyed?.()) {
    webContents.removeAllListeners();
    webContents.destroy();
  }
  return true;
}

module.exports = {
  attachTabView,
  createTabView,
  destroyTabView,
  detachTabView,
  setTabViewBounds
};
