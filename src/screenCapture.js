const { clipboard, desktopCapturer, screen } = require('electron');

class ScreenCapture {
  constructor({
    clipboard: clipboardApi = clipboard,
    desktopCapturer: desktopCapturerApi = desktopCapturer,
    screen: screenApi = screen,
    logger = console
  } = {}) {
    this.clipboard = clipboardApi;
    this.desktopCapturer = desktopCapturerApi;
    this.screen = screenApi;
    this.logger = logger;
  }

  getDisplayId(display) {
    if (!display || display.id === null || display.id === undefined) {
      throw new Error('Screen capture requires a display with an id.');
    }

    return String(display.id);
  }

  getRequiredScreen() {
    if (!this.screen?.getAllDisplays || !this.screen?.getPrimaryDisplay) {
      throw new Error('Screen capture display APIs are unavailable.');
    }

    return this.screen;
  }

  getRequiredDesktopCapturer() {
    if (!this.desktopCapturer?.getSources) {
      throw new Error('Screen capture source APIs are unavailable.');
    }

    return this.desktopCapturer;
  }

  getRequiredClipboard() {
    if (!this.clipboard?.writeImage) {
      throw new Error('Screen capture clipboard APIs are unavailable.');
    }

    return this.clipboard;
  }

  getTargetDisplay(displayId = null) {
    const screenApi = this.getRequiredScreen();
    const displays = screenApi.getAllDisplays();

    if (displayId !== null && displayId !== undefined) {
      const matchedDisplay = displays.find((display) => String(display.id) === String(displayId));
      if (matchedDisplay) {
        return matchedDisplay;
      }

      throw new Error(`Screen capture display "${String(displayId)}" is unavailable.`);
    }

    const primaryDisplay = screenApi.getPrimaryDisplay();
    if (!primaryDisplay) {
      throw new Error('Screen capture primary display is unavailable.');
    }

    return primaryDisplay;
  }

  getCaptureSize(targetDisplay) {
    const { bounds, scaleFactor = 1 } = targetDisplay;
    return {
      width: Math.max(1, Math.round(bounds.width * scaleFactor)),
      height: Math.max(1, Math.round(bounds.height * scaleFactor))
    };
  }

  async getScreenSource(targetDisplay) {
    const targetDisplayId = this.getDisplayId(targetDisplay);
    const captureSize = this.getCaptureSize(targetDisplay);
    const sources = await this.getRequiredDesktopCapturer().getSources({
      types: ['screen'],
      thumbnailSize: captureSize
    });

    const source = sources.find((item) => String(item?.display_id) === targetDisplayId);
    if (!source) {
      throw new Error(`No screen source found for display "${targetDisplayId}".`);
    }

    return source;
  }

  async prepareDisplayCapture(displayId = null) {
    const targetDisplay = this.getTargetDisplay(displayId);
    const source = await this.getScreenSource(targetDisplay);

    if (!source.thumbnail || source.thumbnail.isEmpty()) {
      throw new Error('Captured screen image is empty');
    }

    return {
      display: targetDisplay,
      sourceDisplayId: this.getDisplayId({ id: source.display_id }),
      image: source.thumbnail
    };
  }

  validatePreparedCapture(preparedCapture, requestedDisplayId = null) {
    if (!preparedCapture?.image) {
      throw new Error('Prepared screen capture image is unavailable.');
    }

    const preparedDisplayId = this.getDisplayId(preparedCapture.display);
    if (preparedCapture.sourceDisplayId === null || preparedCapture.sourceDisplayId === undefined) {
      throw new Error('Prepared screen capture source display identity is unavailable.');
    }

    const sourceDisplayId = String(preparedCapture.sourceDisplayId);
    if (sourceDisplayId !== preparedDisplayId) {
      throw new Error(
        `Prepared capture source display "${sourceDisplayId}" does not match geometry display "${preparedDisplayId}".`
      );
    }

    if (requestedDisplayId !== null && requestedDisplayId !== undefined
      && String(requestedDisplayId) !== preparedDisplayId) {
      throw new Error(
        `Prepared capture belongs to display "${preparedDisplayId}", not requested display "${String(requestedDisplayId)}".`
      );
    }

    return preparedCapture;
  }

  cropImageToBounds(image, display, selectionBounds) {
    const imageSize = image.getSize();
    const displayBounds = display.bounds;
    const scaleX = imageSize.width / Math.max(displayBounds.width, 1);
    const scaleY = imageSize.height / Math.max(displayBounds.height, 1);

    const left = Math.max(0, Math.min(displayBounds.width, selectionBounds.x - displayBounds.x));
    const top = Math.max(0, Math.min(displayBounds.height, selectionBounds.y - displayBounds.y));
    const right = Math.max(left, Math.min(displayBounds.width, selectionBounds.x + selectionBounds.width - displayBounds.x));
    const bottom = Math.max(top, Math.min(displayBounds.height, selectionBounds.y + selectionBounds.height - displayBounds.y));

    const cropLeft = Math.max(0, Math.floor(left * scaleX));
    const cropTop = Math.max(0, Math.floor(top * scaleY));
    const cropRight = Math.min(imageSize.width, Math.ceil(right * scaleX));
    const cropBottom = Math.min(imageSize.height, Math.ceil(bottom * scaleY));
    const cropWidth = Math.max(1, cropRight - cropLeft);
    const cropHeight = Math.max(1, cropBottom - cropTop);

    return image.crop({
      x: cropLeft,
      y: cropTop,
      width: cropWidth,
      height: cropHeight
    });
  }

  async captureArea(selectionBounds, displayId = null, preparedCapture = null) {
    try {
      const capture = this.validatePreparedCapture(
        preparedCapture || await this.prepareDisplayCapture(displayId),
        displayId
      );
      const image = this.cropImageToBounds(capture.image, capture.display, selectionBounds);
      this.getRequiredClipboard().writeImage(image);
      return { success: true, image, display: capture.display };
    } catch (error) {
      this.logger?.error?.('[ERROR] Area capture failed:', error);
      throw error;
    }
  }
}

const defaultScreenCapture = new ScreenCapture();

module.exports = defaultScreenCapture;
module.exports.ScreenCapture = ScreenCapture;
