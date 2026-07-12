class DeepgramLifecycleCoordinator {
  constructor({
    service,
    requestRendererStart,
    requestRendererStop,
    onState = () => {}
  } = {}) {
    this.service = service;
    this.requestRendererStart = requestRendererStart;
    this.requestRendererStop = requestRendererStop;
    this.onState = onState;
    this.operationId = 0;
    this.active = false;
    this.phase = 'inactive';
    this.reason = '';
    this.error = '';
    this.startPromise = null;
    this.stopPromise = null;
    this.rotationPromise = null;
    this.clearPromise = null;
  }

  getState() {
    return {
      active: this.active,
      phase: this.phase,
      reason: this.reason,
      error: this.error
    };
  }

  publishState({ active = this.active, phase = this.phase, reason = '', error = '' } = {}) {
    this.active = Boolean(active);
    this.phase = phase;
    this.reason = reason;
    this.error = error;
    const state = this.getState();
    this.onState(state);
    return state;
  }

  start({ apiKey } = {}) {
    if (this.clearPromise) {
      return this.clearPromise.then(() => this.start({ apiKey }));
    }
    if (this.stopPromise) {
      return this.stopPromise.then(() => this.start({ apiKey }));
    }
    if (this.active) {
      return Promise.resolve(this.getState());
    }
    if (this.startPromise) {
      return this.startPromise;
    }

    const operationId = ++this.operationId;
    this.publishState({ active: false, phase: 'connecting', reason: 'backend-connecting' });
    const trackedStartPromise = (async () => {
      try {
        await this.service.start({ apiKey });
        if (operationId !== this.operationId) {
          return this.getState();
        }

        this.publishState({ active: false, phase: 'awaiting-renderer', reason: 'capture-required' });
        const rendererStarted = await this.requestRendererStart({ operationId });
        if (operationId !== this.operationId) {
          return this.getState();
        }

        if (!rendererStarted) {
          await this.rollbackStart(operationId);
          return this.publishState({
            active: false,
            phase: 'inactive',
            reason: 'renderer-start-failed'
          });
        }

        return this.publishState({ active: true, phase: 'active', reason: 'started' });
      } catch (error) {
        if (operationId !== this.operationId) {
          return this.getState();
        }
        await this.rollbackStart(operationId);
        return this.publishState({
          active: false,
          phase: 'inactive',
          reason: 'start-failed',
          error: error?.message || String(error)
        });
      }
    })().finally(() => {
      if (this.startPromise === trackedStartPromise) {
        this.startPromise = null;
      }
    });
    this.startPromise = trackedStartPromise;
    return trackedStartPromise;
  }

  async rollbackStart(operationId) {
    try {
      await this.requestRendererStop({ operationId });
    } finally {
      await this.service.stop();
    }
  }

  stop({ reason = 'stopped', bypassClear = false } = {}) {
    if (this.clearPromise && !bypassClear) {
      // A user stop or app shutdown must not wait for clear() to reconnect.
      // Advancing operationId below makes the abandoned clear transaction stale;
      // dropping the tracked promise also prevents a later start from waiting on it.
      this.clearPromise = null;
    }
    if (this.stopPromise) {
      return this.stopPromise;
    }
    if (!this.active && this.phase === 'inactive' && !this.startPromise) {
      return Promise.resolve(this.publishState({ active: false, phase: 'inactive', reason }));
    }

    const operationId = ++this.operationId;
    this.publishState({ active: false, phase: 'stopping', reason });
    const trackedStopPromise = (async () => {
      let rendererStopError = null;
      try {
        await this.requestRendererStop({ operationId });
      } catch (error) {
        rendererStopError = error;
      }

      try {
        await this.service.stop();
      } catch (error) {
        return this.publishState({
          active: false,
          phase: 'inactive',
          reason,
          error: error?.message || String(error)
        });
      }

      return this.publishState({
        active: false,
        phase: 'inactive',
        reason,
        error: rendererStopError?.message || ''
      });
    })().finally(() => {
      if (this.stopPromise === trackedStopPromise) {
        this.stopPromise = null;
      }
    });
    this.stopPromise = trackedStopPromise;
    return trackedStopPromise;
  }

  rotateApiKey({ apiKey } = {}) {
    return this.rotateApiKeyForOperation(apiKey, this.operationId);
  }

  rotateApiKeyForOperation(apiKey, requestedOperationId) {
    if (this.clearPromise) {
      return this.clearPromise.then(() => this.rotateApiKeyForOperation(apiKey, requestedOperationId));
    }
    if (this.rotationPromise) {
      return this.rotationPromise.then(() => this.rotateApiKeyForOperation(apiKey, requestedOperationId));
    }
    if (requestedOperationId !== this.operationId) {
      return Promise.resolve(this.getState());
    }
    if (!this.active) {
      return this.start({ apiKey });
    }

    const trackedRotationPromise = (async () => {
      const operationId = this.operationId;
      this.publishState({ active: true, phase: 'reconnecting', reason: 'api-key-rotation' });
      try {
        await this.service.rotateApiKey({ apiKey });
        if (operationId !== this.operationId) {
          return this.getState();
        }
        return this.publishState({ active: true, phase: 'active', reason: 'api-key-rotated' });
      } catch (error) {
        if (operationId !== this.operationId) {
          return this.getState();
        }
        await this.stop({ reason: 'api-key-rotation-failed' });
        return this.publishState({
          active: false,
          phase: 'inactive',
          reason: 'api-key-rotation-failed',
          error: error?.message || String(error)
        });
      }
    })().finally(() => {
      if (this.rotationPromise === trackedRotationPromise) {
        this.rotationPromise = null;
      }
    });
    this.rotationPromise = trackedRotationPromise;
    return trackedRotationPromise;
  }

  clear() {
    return this.clearForOperation(this.operationId);
  }

  clearForOperation(requestedOperationId) {
    if (this.clearPromise) {
      return this.clearPromise;
    }
    if (this.startPromise) {
      return this.startPromise.then(() => this.clearForOperation(requestedOperationId));
    }
    if (this.rotationPromise) {
      return this.rotationPromise.then(() => this.clearForOperation(requestedOperationId));
    }
    if (this.stopPromise) {
      return this.stopPromise.then(() => this.clearForOperation(requestedOperationId));
    }
    if (requestedOperationId !== this.operationId) {
      return Promise.resolve(this.getState());
    }

    const operationId = requestedOperationId;
    const trackedClearPromise = Promise.resolve(this.service.clear())
      .then(() => {
        if (operationId !== this.operationId) {
          return this.getState();
        }
        return this.publishState({
          active: this.active,
          phase: this.active ? 'active' : 'inactive',
          reason: 'cleared'
        });
      })
      .catch(async (error) => {
        if (operationId !== this.operationId) {
          return this.getState();
        }
        await this.failClosed(error);
        return this.getState();
      })
      .finally(() => {
        if (this.clearPromise === trackedClearPromise) {
          this.clearPromise = null;
        }
      });
    this.clearPromise = trackedClearPromise;
    return trackedClearPromise;
  }

  async failClosed(error) {
    const state = await this.stop({ reason: 'backend-failed', bypassClear: true });
    return this.publishState({
      ...state,
      active: false,
      phase: 'inactive',
      reason: 'backend-failed',
      error: error?.message || String(error)
    });
  }
}

module.exports = {
  DeepgramLifecycleCoordinator
};
