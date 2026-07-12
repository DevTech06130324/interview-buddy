const { randomUUID } = require('crypto');

const DEEPGRAM_RENDERER_START_ACK_TIMEOUT_MS = 30_000;
const DEEPGRAM_RENDERER_STOP_ACK_TIMEOUT_MS = 1500;

class DeepgramRendererCommandBroker {
  constructor({
    sendCommand,
    createRequestId = randomUUID,
    startAckTimeoutMs = DEEPGRAM_RENDERER_START_ACK_TIMEOUT_MS,
    stopAckTimeoutMs = DEEPGRAM_RENDERER_STOP_ACK_TIMEOUT_MS,
    setTimeoutFn = setTimeout,
    clearTimeoutFn = clearTimeout
  } = {}) {
    this.sendCommand = sendCommand;
    this.createRequestId = createRequestId;
    this.startAckTimeoutMs = startAckTimeoutMs;
    this.stopAckTimeoutMs = stopAckTimeoutMs;
    this.setTimeoutFn = setTimeoutFn;
    this.clearTimeoutFn = clearTimeoutFn;
    this.pending = new Map();
  }

  pendingCount() {
    return this.pending.size;
  }

  settle(requestId, result) {
    const pending = this.pending.get(requestId);
    if (!pending) {
      return false;
    }

    this.pending.delete(requestId);
    if (pending.timeoutId !== null) {
      this.clearTimeoutFn(pending.timeoutId);
    }
    pending.resolve(Boolean(result));
    return true;
  }

  request(action, { operationId } = {}) {
    const requestId = `${Number.isFinite(operationId) ? operationId : 0}:${this.createRequestId()}`;
    const timeoutMs = action === 'stop'
      ? this.stopAckTimeoutMs
      : this.startAckTimeoutMs;

    return new Promise((resolve) => {
      const pending = {
        action,
        resolve,
        timeoutId: null
      };
      this.pending.set(requestId, pending);
      pending.timeoutId = this.setTimeoutFn(() => {
        this.settle(requestId, false);
      }, timeoutMs);

      try {
        const sent = this.sendCommand({ requestId, action });
        if (sent === false) {
          this.settle(requestId, false);
        }
      } catch (_) {
        this.settle(requestId, false);
      }
    });
  }

  acknowledge(payload = {}) {
    const requestId = typeof payload?.requestId === 'string' ? payload.requestId : '';
    const pending = this.pending.get(requestId);
    if (!pending || pending.action !== payload?.action) {
      return false;
    }
    return this.settle(requestId, payload?.success);
  }

  cancelAll() {
    for (const requestId of [...this.pending.keys()]) {
      this.settle(requestId, false);
    }
  }
}

module.exports = {
  DEEPGRAM_RENDERER_START_ACK_TIMEOUT_MS,
  DEEPGRAM_RENDERER_STOP_ACK_TIMEOUT_MS,
  DeepgramRendererCommandBroker
};
