const test = require('node:test');
const assert = require('node:assert/strict');

const { ScreenCapture } = require('../src/screenCapture');

function createDisplay(id, { x = 0, y = 0, width = 1920, height = 1080, scaleFactor = 1 } = {}) {
  return {
    id,
    bounds: { x, y, width, height },
    scaleFactor
  };
}

function createImage(width = 1920, height = 1080) {
  const cropCalls = [];
  return {
    cropCalls,
    isEmpty: () => false,
    getSize: () => ({ width, height }),
    crop: (bounds) => {
      cropCalls.push(bounds);
      return { bounds };
    }
  };
}

function createCapture({ displays = [], primaryDisplay = displays[0], sources = [] } = {}) {
  const calls = [];
  const clipboardWrites = [];
  const capture = new ScreenCapture({
    screen: {
      getAllDisplays: () => displays,
      getPrimaryDisplay: () => primaryDisplay
    },
    desktopCapturer: {
      getSources: async (options) => {
        calls.push(options);
        return sources;
      }
    },
    clipboard: {
      writeImage: (image) => clipboardWrites.push(image)
    },
    logger: { error: () => {} }
  });

  return { capture, calls, clipboardWrites };
}

test('prepareDisplayCapture uses only the source with the exact requested display id', async () => {
  const leftDisplay = createDisplay('left', { x: -1920 });
  const highDpiDisplay = createDisplay('high-dpi', { width: 2560, height: 1440, scaleFactor: 1.5 });
  const wrongImage = createImage(1920, 1080);
  const matchingImage = createImage(3840, 2160);
  const { capture, calls } = createCapture({
    displays: [leftDisplay, highDpiDisplay],
    sources: [
      { display_id: 'left', thumbnail: wrongImage },
      { display_id: 'high-dpi', thumbnail: matchingImage }
    ]
  });

  const prepared = await capture.prepareDisplayCapture('high-dpi');

  assert.equal(prepared.display, highDpiDisplay);
  assert.equal(prepared.sourceDisplayId, 'high-dpi');
  assert.equal(prepared.image, matchingImage);
  assert.deepEqual(calls, [{
    types: ['screen'],
    thumbnailSize: { width: 3840, height: 2160 }
  }]);
});

test('prepareDisplayCapture fails explicitly when no exact display source is available', async () => {
  const targetDisplay = createDisplay('target');
  const { capture } = createCapture({
    displays: [targetDisplay],
    sources: [{ display_id: 'other', thumbnail: createImage() }]
  });

  await assert.rejects(
    capture.prepareDisplayCapture('target'),
    /No screen source found for display "target"\./
  );
});

test('captureArea rejects a mixed-DPI prepared capture for another requested display before cropping', async () => {
  const standardDisplay = createDisplay('standard', { width: 1920, height: 1080, scaleFactor: 1 });
  const highDpiDisplay = createDisplay('high-dpi', { x: 1920, width: 2560, height: 1440, scaleFactor: 1.5 });
  const highDpiImage = createImage(3840, 2160);
  const { capture, clipboardWrites } = createCapture({
    displays: [standardDisplay, highDpiDisplay]
  });

  await assert.rejects(
    capture.captureArea(
      { x: 1920, y: 0, width: 400, height: 300 },
      'standard',
      {
        display: highDpiDisplay,
        sourceDisplayId: 'high-dpi',
        image: highDpiImage
      }
    ),
    /Prepared capture belongs to display "high-dpi", not requested display "standard"\./
  );

  assert.deepEqual(highDpiImage.cropCalls, []);
  assert.deepEqual(clipboardWrites, []);
});
