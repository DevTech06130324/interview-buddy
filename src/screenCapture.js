const { clipboard, desktopCapturer, screen } = require('electron');

class ScreenCapture {
  getTargetDisplay(displayId = null) {
    const displays = screen.getAllDisplays();

    if (displayId !== null && displayId !== undefined) {
      const matchedDisplay = displays.find((display) => String(display.id) === String(displayId));
      if (matchedDisplay) {
        return matchedDisplay;
      }
    }

    return screen.getPrimaryDisplay();
  }

  getCaptureSize(targetDisplay) {
    const { bounds, scaleFactor = 1 } = targetDisplay;
    return {
      width: Math.max(1, Math.round(bounds.width * scaleFactor)),
      height: Math.max(1, Math.round(bounds.height * scaleFactor))
    };
  }

  async getScreenSource(targetDisplay) {
    const captureSize = this.getCaptureSize(targetDisplay);
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: captureSize
    });

    return sources.find((item) => item.display_id === String(targetDisplay.id)) || sources[0] || null;
  }

  async prepareDisplayCapture(displayId = null) {
    const targetDisplay = this.getTargetDisplay(displayId);
    const source = await this.getScreenSource(targetDisplay);

    if (!source) {
      throw new Error('No screen source found');
    }

    if (!source.thumbnail || source.thumbnail.isEmpty()) {
      throw new Error('Captured screen image is empty');
    }

    return {
      display: targetDisplay,
      image: source.thumbnail
    };
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
      const capture = preparedCapture || await this.prepareDisplayCapture(displayId);
      const image = this.cropImageToBounds(capture.image, capture.display, selectionBounds);
      clipboard.writeImage(image);
      return { success: true, image, display: capture.display };
    } catch (error) {
      console.error('[ERROR] Area capture failed:', error);
      throw error;
    }
  }
}

module.exports = new ScreenCapture();
