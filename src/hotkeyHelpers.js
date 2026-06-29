(function initHotkeyHelpers(root, factory) {
  const helpers = factory();

  if (typeof module === 'object' && module.exports) {
    module.exports = helpers;
  }

  if (root) {
    root.hotkeyHelpers = Object.freeze(helpers);
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, function createHotkeyHelpers() {
  function formatHotkeyPartForDisplay(part) {
    switch (part) {
      case 'CommandOrControl':
        return 'Ctrl';
      case 'Super':
        return 'Win';
      case 'Escape':
        return 'Esc';
      case 'PageUp':
        return 'PgUp';
      case 'PageDown':
        return 'PgDn';
      default:
        return part;
    }
  }

  function formatHotkeyForDisplay(hotkey, options = {}) {
    if (typeof hotkey !== 'string' || !hotkey.trim()) {
      return '';
    }

    const separator = typeof options.separator === 'string' ? options.separator : '+';
    const parts = options.trimParts
      ? hotkey.split('+').map((part) => part.trim()).filter(Boolean)
      : hotkey.split('+');

    return parts
      .map((part) => formatHotkeyPartForDisplay(part))
      .join(separator);
  }

  function getHotkeyKeyFromEvent(event) {
    const code = typeof event.code === 'string' ? event.code : '';
    const key = typeof event.key === 'string' ? event.key : '';
    const upperKey = key.toUpperCase();

    if (/^Key[A-Z]$/.test(code)) {
      return code.slice(3);
    }

    if (/^Digit[0-9]$/.test(code)) {
      return code.slice(5);
    }

    if (/^Numpad[0-9]$/.test(code)) {
      return `num${code.slice(6)}`;
    }

    if (code === 'Backquote' || key === '`') {
      return '`';
    }

    if (/^F([1-9]|1[0-9]|2[0-4])$/.test(upperKey)) {
      return upperKey;
    }

    switch (key) {
      case 'ArrowUp':
        return 'Up';
      case 'ArrowDown':
        return 'Down';
      case 'ArrowLeft':
        return 'Left';
      case 'ArrowRight':
        return 'Right';
      case ' ':
      case 'Spacebar':
        return 'Space';
      case 'Enter':
        return 'Enter';
      case 'Tab':
        return 'Tab';
      case 'Escape':
      case 'Esc':
        return 'Escape';
      case 'Backspace':
        return 'Backspace';
      case 'Delete':
      case 'Del':
        return 'Delete';
      case 'Insert':
        return 'Insert';
      case 'Home':
        return 'Home';
      case 'End':
        return 'End';
      case 'PageUp':
        return 'PageUp';
      case 'PageDown':
        return 'PageDown';
      default:
        return '';
    }
  }

  function getHotkeyCaptureFromEvent(event) {
    const key = getHotkeyKeyFromEvent(event);
    if (!key) {
      return null;
    }

    const acceleratorParts = [];
    const displayParts = [];

    if (event.ctrlKey) {
      acceleratorParts.push('CommandOrControl');
      displayParts.push('Ctrl');
    }

    if (event.altKey) {
      acceleratorParts.push('Alt');
      displayParts.push('Alt');
    }

    if (event.shiftKey) {
      acceleratorParts.push('Shift');
      displayParts.push('Shift');
    }

    if (event.metaKey) {
      acceleratorParts.push('Super');
      displayParts.push('Win');
    }

    acceleratorParts.push(key);
    displayParts.push(formatHotkeyPartForDisplay(key));

    return {
      accelerator: acceleratorParts.join('+'),
      displayValue: displayParts.join('+'),
      isValid: displayParts.length > 1 || /^F([1-9]|1[0-9]|2[0-4])$/.test(key)
    };
  }

  return {
    formatHotkeyForDisplay,
    getHotkeyCaptureFromEvent
  };
}));
