(() => {
  const TOOLTIP_ATTRIBUTE = 'data-protected-tooltip';
  const STYLE_ID = 'protected-tooltip-styles';
  const OFFSET = 8;

  let tooltipElement = null;
  let activeTarget = null;

  function ensureTooltipStyles() {
    if (document.getElementById(STYLE_ID)) {
      return;
    }

    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      .protected-tooltip {
        position: fixed;
        z-index: 2147483647;
        max-width: min(280px, calc(100vw - 16px));
        padding: 7px 9px;
        border: 1px solid var(--border, var(--border-strong, rgba(255, 255, 255, 0.18)));
        border-radius: 7px;
        background: var(--panel-bg, var(--dialog-bg, rgba(24, 24, 24, 0.96)));
        box-shadow: var(--overlay-shadow, 0 12px 30px rgba(0, 0, 0, 0.38));
        color: var(--text, #ffffff);
        font: 12px/1.35 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        pointer-events: none;
        opacity: 0;
        transform: translateY(2px);
        transition: opacity 0.12s ease, transform 0.12s ease;
        overflow-wrap: break-word;
      }

      .protected-tooltip.is-visible {
        opacity: 1;
        transform: translateY(0);
      }
    `;
    document.head.appendChild(style);
  }

  function ensureTooltipElement() {
    if (tooltipElement) {
      return tooltipElement;
    }

    ensureTooltipStyles();
    tooltipElement = document.createElement('div');
    tooltipElement.className = 'protected-tooltip';
    tooltipElement.setAttribute('role', 'tooltip');
    tooltipElement.hidden = true;
    document.body.appendChild(tooltipElement);
    return tooltipElement;
  }

  function protectElementTooltip(element) {
    if (!element || element.nodeType !== Node.ELEMENT_NODE) {
      return;
    }

    const nativeTitle = element.getAttribute('title');
    if (nativeTitle !== null) {
      if (nativeTitle.trim() && !element.getAttribute(TOOLTIP_ATTRIBUTE)) {
        element.setAttribute(TOOLTIP_ATTRIBUTE, nativeTitle);
      }
      element.removeAttribute('title');
    }
  }

  function protectTooltips(root = document) {
    if (!root || typeof root.querySelectorAll !== 'function') {
      return;
    }

    if (root.nodeType === Node.ELEMENT_NODE) {
      protectElementTooltip(root);
    }

    for (const element of root.querySelectorAll('[title]')) {
      protectElementTooltip(element);
    }
  }

  function getTooltipTarget(startElement) {
    if (!startElement || typeof startElement.closest !== 'function') {
      return null;
    }

    const target = startElement.closest(`[${TOOLTIP_ATTRIBUTE}], [title]`);
    protectElementTooltip(target);
    return target && target.getAttribute(TOOLTIP_ATTRIBUTE) ? target : null;
  }

  function positionTooltip(target) {
    if (!tooltipElement || !target) {
      return;
    }

    const targetRect = target.getBoundingClientRect();
    const tooltipRect = tooltipElement.getBoundingClientRect();
    const viewportWidth = document.documentElement.clientWidth || window.innerWidth;
    const viewportHeight = document.documentElement.clientHeight || window.innerHeight;
    const x = Math.min(
      viewportWidth - tooltipRect.width - OFFSET,
      Math.max(OFFSET, targetRect.left + (targetRect.width - tooltipRect.width) / 2)
    );
    const aboveY = targetRect.top - tooltipRect.height - OFFSET;
    const belowY = targetRect.bottom + OFFSET;
    const y = aboveY >= OFFSET
      ? aboveY
      : Math.min(viewportHeight - tooltipRect.height - OFFSET, belowY);

    tooltipElement.style.left = `${Math.round(x)}px`;
    tooltipElement.style.top = `${Math.round(Math.max(OFFSET, y))}px`;
  }

  function showTooltip(target) {
    const text = target?.getAttribute(TOOLTIP_ATTRIBUTE)?.trim();
    if (!text) {
      hideTooltip();
      return;
    }

    const tooltip = ensureTooltipElement();
    activeTarget = target;
    tooltip.textContent = text;
    tooltip.hidden = false;
    tooltip.classList.remove('is-visible');
    positionTooltip(target);
    window.requestAnimationFrame(() => {
      if (activeTarget === target) {
        positionTooltip(target);
        tooltip.classList.add('is-visible');
      }
    });
  }

  function hideTooltip() {
    activeTarget = null;
    if (!tooltipElement) {
      return;
    }

    tooltipElement.classList.remove('is-visible');
    tooltipElement.hidden = true;
  }

  function setTooltip(element, text) {
    if (!element) {
      return;
    }

    protectElementTooltip(element);
    const tooltipText = String(text || '').trim();
    if (tooltipText) {
      element.setAttribute(TOOLTIP_ATTRIBUTE, tooltipText);
    } else {
      element.removeAttribute(TOOLTIP_ATTRIBUTE);
    }

    if (activeTarget === element) {
      if (tooltipText) {
        showTooltip(element);
      } else {
        hideTooltip();
      }
    }
  }

  function handlePointerOver(event) {
    const target = getTooltipTarget(event.target);
    if (target) {
      showTooltip(target);
    }
  }

  function handlePointerOut(event) {
    if (!activeTarget) {
      return;
    }

    if (event.relatedTarget && activeTarget.contains(event.relatedTarget)) {
      return;
    }

    hideTooltip();
  }

  function handleFocusIn(event) {
    const target = getTooltipTarget(event.target);
    if (target) {
      showTooltip(target);
    }
  }

  function initProtectedTooltips() {
    protectTooltips();

    document.addEventListener('pointerover', handlePointerOver, true);
    document.addEventListener('pointerout', handlePointerOut, true);
    document.addEventListener('focusin', handleFocusIn, true);
    document.addEventListener('focusout', hideTooltip, true);
    document.addEventListener('scroll', () => positionTooltip(activeTarget), true);
    window.addEventListener('resize', hideTooltip);

    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === 'attributes') {
          protectElementTooltip(mutation.target);
        } else {
          for (const node of mutation.addedNodes) {
            protectTooltips(node);
          }
        }
      }
    });
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['title']
    });
  }

  window.protectedTooltips = {
    refresh: protectTooltips,
    setTooltip
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initProtectedTooltips, { once: true });
  } else {
    initProtectedTooltips();
  }
})();
