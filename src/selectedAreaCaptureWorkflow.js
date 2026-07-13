function requireFunction(value, name) {
  if (typeof value !== 'function') {
    throw new TypeError(`Selected-area capture requires ${name}().`);
  }
  return value;
}

function getDisplayId(display) {
  if (!display || display.id === null || display.id === undefined) {
    throw new Error('Selected-area capture requires a display id.');
  }
  return String(display.id);
}

async function runSelectedAreaCaptureWorkflow({
  displayId = null,
  getTargetDisplay,
  openSelectionOverlay,
  prepareDisplayCapture,
  captureArea
} = {}) {
  const targetDisplay = requireFunction(getTargetDisplay, 'getTargetDisplay')(displayId);
  const targetDisplayId = getDisplayId(targetDisplay);
  const selectionBounds = await requireFunction(openSelectionOverlay, 'openSelectionOverlay')(targetDisplay);

  if (!selectionBounds) {
    return { success: false, canceled: true };
  }

  // The overlay promise settles only after its window has closed. Capture now
  // so the image cannot include the overlay and always belongs to this display.
  const preparedCapture = await requireFunction(
    prepareDisplayCapture,
    'prepareDisplayCapture'
  )(targetDisplayId);
  if (getDisplayId(preparedCapture?.display) !== targetDisplayId) {
    throw new Error('Fresh screen capture does not match the selected display.');
  }

  const result = await requireFunction(captureArea, 'captureArea')(
    selectionBounds,
    targetDisplayId,
    preparedCapture
  );
  return {
    success: result?.success !== false,
    canceled: false
  };
}

module.exports = {
  runSelectedAreaCaptureWorkflow
};
