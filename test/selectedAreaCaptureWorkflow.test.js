const test = require('node:test');
const assert = require('node:assert/strict');

const {
  runSelectedAreaCaptureWorkflow
} = require('../src/selectedAreaCaptureWorkflow');

test('selected-area capture closes selection before taking a fresh exact-display capture', async () => {
  const events = [];
  const display = { id: 'high-dpi', bounds: { x: 1920, y: 0, width: 2560, height: 1440 } };
  const selection = { x: 2000, y: 100, width: 300, height: 200 };

  const result = await runSelectedAreaCaptureWorkflow({
    displayId: 'high-dpi',
    getTargetDisplay(id) {
      events.push(['display', id]);
      return display;
    },
    async openSelectionOverlay(target) {
      events.push(['overlay-closed', target.id]);
      return selection;
    },
    async prepareDisplayCapture(id) {
      events.push(['fresh-capture', id]);
      return { display, sourceDisplayId: 'high-dpi', image: {} };
    },
    async captureArea(bounds, id, preparedCapture) {
      events.push(['crop-and-copy', bounds, id, preparedCapture.display.id]);
      return { success: true };
    }
  });

  assert.deepEqual(result, { success: true, canceled: false });
  assert.deepEqual(events, [
    ['display', 'high-dpi'],
    ['overlay-closed', 'high-dpi'],
    ['fresh-capture', 'high-dpi'],
    ['crop-and-copy', selection, 'high-dpi', 'high-dpi']
  ]);
});

test('canceling the overlay takes no screenshot', async () => {
  let captureAttempts = 0;
  const display = { id: 'primary' };

  const result = await runSelectedAreaCaptureWorkflow({
    getTargetDisplay: () => display,
    openSelectionOverlay: async () => null,
    prepareDisplayCapture: async () => {
      captureAttempts += 1;
      return { display };
    },
    captureArea: async () => {
      captureAttempts += 1;
    }
  });

  assert.deepEqual(result, { success: false, canceled: true });
  assert.equal(captureAttempts, 0);
});

test('a fresh capture for another display is rejected before crop or clipboard write', async () => {
  const requestedDisplay = { id: 'left' };
  let captureAreaCalled = false;

  await assert.rejects(
    runSelectedAreaCaptureWorkflow({
      displayId: 'left',
      getTargetDisplay: () => requestedDisplay,
      openSelectionOverlay: async () => ({ x: 0, y: 0, width: 100, height: 100 }),
      prepareDisplayCapture: async () => ({ display: { id: 'right' }, sourceDisplayId: 'right' }),
      captureArea: async () => {
        captureAreaCalled = true;
      }
    }),
    /does not match the selected display/
  );

  assert.equal(captureAreaCalled, false);
});
