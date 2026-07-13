const test = require('node:test');
const assert = require('node:assert/strict');

const {
  attachTabView,
  createTabView,
  destroyTabView,
  detachTabView,
  setTabViewBounds
} = require('../src/tabViewManager');

function createWindowHarness() {
  const children = [];
  const contentView = {
    addChildView(view) {
      const index = children.indexOf(view);
      if (index !== -1) {
        children.splice(index, 1);
      }
      children.push(view);
    },
    removeChildView(view) {
      const index = children.indexOf(view);
      if (index === -1) {
        throw new Error('View is not a child view');
      }
      children.splice(index, 1);
    },
    children
  };
  return {
    contentView,
    isDestroyed: () => false
  };
}

test('attaching a tab view keeps only active views attached and reorders the active view', () => {
  const window = createWindowHarness();
  const first = {};
  const second = {};

  assert.equal(attachTabView(window, first), true);
  assert.equal(attachTabView(window, second), true);
  assert.deepEqual(window.contentView.children, [first, second]);

  attachTabView(window, first);
  assert.deepEqual(window.contentView.children, [second, first]);
  detachTabView(window, second);
  assert.deepEqual(window.contentView.children, [first]);
});

test('tab bounds are normalized before being passed to the view', () => {
  let received;
  const view = {
    setBounds(bounds) {
      received = bounds;
    }
  };

  assert.equal(setTabViewBounds(view, { x: -10, y: 4.7, width: '800', height: -2 }), true);
  assert.deepEqual(received, { x: 0, y: 5, width: 800, height: 0 });
});

test('new WebContentsViews use a transparent background and supplied preferences', () => {
  let options;
  let background;
  class FakeWebContentsView {
    constructor(value) {
      options = value;
    }

    setBackgroundColor(value) {
      background = value;
    }
  }

  const view = createTabView(FakeWebContentsView, { contextIsolation: true });
  assert.ok(view instanceof FakeWebContentsView);
  assert.deepEqual(options, { webPreferences: { contextIsolation: true } });
  assert.equal(background, '#00000000');
});

test('destroying a detached view is idempotent and still destroys its web contents', () => {
  let destroyed = 0;
  let removedListeners = 0;
  let isDestroyed = false;
  const webContents = {
    isDestroyed: () => isDestroyed,
    removeAllListeners: () => { removedListeners += 1; },
    destroy: () => {
      destroyed += 1;
      isDestroyed = true;
    }
  };
  const window = createWindowHarness();
  const view = { webContents };

  assert.equal(destroyTabView(window, view), true);
  assert.equal(destroyTabView(window, view), true);
  assert.equal(removedListeners, 1);
  assert.equal(destroyed, 1);
});
