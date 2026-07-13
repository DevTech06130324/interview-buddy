const DEEPGRAM_OPERATION_SUPERSEDED = 'DEEPGRAM_OPERATION_SUPERSEDED';

function normalizeApiKey(apiKey) {
  return typeof apiKey === 'string' ? apiKey.trim() : '';
}

function getErrorMessage(error) {
  return error?.message || String(error || '');
}

function createSupersededError() {
  const error = new Error('Deepgram lifecycle operation was superseded.');
  error.code = DEEPGRAM_OPERATION_SUPERSEDED;
  return error;
}

function isSupersededError(error) {
  return error?.code === DEEPGRAM_OPERATION_SUPERSEDED;
}

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

    this.revision = 0;
    this.desired = {
      shouldRun: false,
      apiKey: '',
      sessionRevision: 0,
      shutdownRequested: false,
      reason: 'inactive',
      error: '',
      revision: 0
    };
    this.applied = {
      backendReady: false,
      rendererActive: false,
      apiKey: '',
      sessionRevision: 0
    };
    this.state = {
      active: false,
      phase: 'inactive',
      reason: '',
      error: ''
    };

    this.reconcilePromise = null;
    this.reconcileRequested = false;
    this.supersedableEffect = null;
    this.rendererCleanupRequired = false;
  }

  getState() {
    return {
      ...this.state,
      revision: this.desired.revision
    };
  }

  publishState({
    active = this.state.active,
    phase = this.state.phase,
    reason = '',
    error = ''
  } = {}) {
    this.state = {
      active: Boolean(active),
      phase,
      reason,
      error
    };
    const snapshot = this.getState();
    this.onState(snapshot);
    return snapshot;
  }

  start({ apiKey } = {}) {
    if (this.desired.shutdownRequested) {
      return this.getTerminalPromise();
    }

    const nextApiKey = typeof apiKey === 'string'
      ? normalizeApiKey(apiKey)
      : this.desired.apiKey;
    if (this.desired.shouldRun && nextApiKey === this.desired.apiKey) {
      return this.getTerminalPromise();
    }
    return this.updateDesired({
      shouldRun: true,
      apiKey: nextApiKey,
      reason: 'started',
      error: ''
    });
  }

  stop({ reason = 'stopped' } = {}) {
    if (this.desired.shutdownRequested) {
      return this.getTerminalPromise();
    }
    if (!this.desired.shouldRun && this.desired.reason === reason) {
      return this.getTerminalPromise();
    }

    return this.updateDesired({
      shouldRun: false,
      sessionRevision: this.applied.sessionRevision,
      reason,
      error: ''
    });
  }

  clear() {
    if (this.desired.shutdownRequested) {
      return this.getTerminalPromise();
    }

    return this.updateDesired({
      sessionRevision: this.desired.sessionRevision + 1,
      reason: this.desired.shouldRun ? 'cleared' : this.desired.reason,
      error: this.desired.shouldRun ? '' : this.desired.error
    });
  }

  setApiKey({ apiKey } = {}) {
    if (this.desired.shutdownRequested) {
      return this.getTerminalPromise();
    }

    const nextApiKey = normalizeApiKey(apiKey);
    if (nextApiKey === this.desired.apiKey) {
      return this.getTerminalPromise();
    }

    return this.updateDesired({
      apiKey: nextApiKey,
      reason: this.desired.shouldRun ? 'api-key-rotated' : this.desired.reason,
      error: this.desired.shouldRun ? '' : this.desired.error
    });
  }

  shutdown() {
    if (this.desired.shutdownRequested) {
      return this.getTerminalPromise();
    }

    return this.updateDesired({
      shouldRun: false,
      sessionRevision: this.applied.sessionRevision,
      shutdownRequested: true,
      reason: 'app-exit',
      error: ''
    });
  }

  failClosed(error, { revision } = {}) {
    if (
      this.desired.shutdownRequested
      || !this.desired.shouldRun
      || (revision !== undefined && revision !== this.desired.revision)
    ) {
      return this.reconcilePromise || Promise.resolve(this.getState());
    }

    return this.updateDesired({
      shouldRun: false,
      sessionRevision: this.applied.sessionRevision,
      reason: 'backend-failed',
      error: getErrorMessage(error)
    });
  }

  getTerminalPromise() {
    return this.reconcilePromise || Promise.resolve(this.getState());
  }

  updateDesired(patch) {
    this.revision += 1;
    this.desired = {
      ...this.desired,
      ...patch,
      revision: this.revision
    };
    this.cancelSupersedableEffect();
    return this.scheduleReconcile();
  }

  cancelSupersedableEffect() {
    const controller = this.supersedableEffect?.controller;
    if (controller && !controller.signal.aborted) {
      controller.abort(createSupersededError());
    }
  }

  scheduleReconcile() {
    this.reconcileRequested = true;
    if (this.reconcilePromise) {
      return this.reconcilePromise;
    }

    let resolveReconcile;
    let rejectReconcile;
    const reconciliation = new Promise((resolve, reject) => {
      resolveReconcile = resolve;
      rejectReconcile = reject;
    });
    this.reconcilePromise = reconciliation;

    this.runReconciliationLoop().then(
      (state) => {
        if (this.reconcilePromise === reconciliation) {
          this.reconcilePromise = null;
        }
        resolveReconcile(state);
      },
      (error) => {
        if (this.reconcilePromise === reconciliation) {
          this.reconcilePromise = null;
        }
        rejectReconcile(error);
      }
    );

    return reconciliation;
  }

  async runReconciliationLoop() {
    while (true) {
      this.reconcileRequested = false;
      await this.reconcileLatestDesiredState();

      if (this.reconcileRequested || !this.stateMatchesDesired()) {
        continue;
      }

      await Promise.resolve();
      if (!this.reconcileRequested && this.stateMatchesDesired()) {
        return this.getState();
      }
    }
  }

  stateMatchesDesired() {
    if (!this.desired.shouldRun) {
      return !this.applied.backendReady
        && !this.applied.rendererActive
        && this.applied.sessionRevision === this.desired.sessionRevision
        && !this.state.active
        && this.state.phase === 'inactive'
        && this.state.reason === this.desired.reason;
    }

    return this.applied.backendReady
      && this.applied.rendererActive
      && this.applied.apiKey === this.desired.apiKey
      && this.applied.sessionRevision === this.desired.sessionRevision
      && this.state.active
      && this.state.phase === 'active'
      && this.state.reason === this.desired.reason;
  }

  isCurrent(snapshot) {
    return snapshot.revision === this.desired.revision;
  }

  async reconcileLatestDesiredState() {
    const snapshot = { ...this.desired };

    if (!snapshot.shouldRun) {
      const cleanupRequired = this.applied.backendReady
        || this.applied.rendererActive
        || (
          this.rendererCleanupRequired
          && snapshot.reason !== 'renderer-stop-failed'
        )
        || this.state.phase !== 'inactive';
      if (!cleanupRequired && this.applied.sessionRevision !== snapshot.sessionRevision) {
        await this.reconcileSession(snapshot);
        return;
      }
      await this.reconcileStoppedState(snapshot);
      return;
    }

    if (this.applied.sessionRevision !== snapshot.sessionRevision) {
      await this.reconcileSession(snapshot);
      return;
    }

    if (!this.applied.backendReady) {
      await this.reconcileBackendStart(snapshot);
      return;
    }

    if (this.applied.apiKey !== snapshot.apiKey) {
      await this.reconcileApiKey(snapshot);
      return;
    }

    if (!this.applied.rendererActive) {
      await this.reconcileRendererStart(snapshot);
      return;
    }

    if (this.isCurrent(snapshot)) {
      this.publishState({
        active: true,
        phase: 'active',
        reason: snapshot.reason,
        error: snapshot.error
      });
    }
  }

  async reconcileStoppedState(snapshot) {
    const rendererNeedsCleanup = this.applied.rendererActive
      || (
        this.rendererCleanupRequired
        && snapshot.reason !== 'renderer-stop-failed'
      );
    const backendNeedsCleanup = this.applied.backendReady
      || this.state.phase !== 'inactive';

    if (!rendererNeedsCleanup && !backendNeedsCleanup) {
      const latest = this.desired;
      if (!latest.shouldRun) {
        this.publishState({
          active: false,
          phase: 'inactive',
          reason: latest.reason,
          error: latest.error
        });
      }
      return;
    }

    this.publishState({
      active: false,
      phase: 'stopping',
      reason: snapshot.reason,
      error: snapshot.error
    });

    let cleanupError = '';
    if (rendererNeedsCleanup) {
      try {
        await this.cleanupRenderer(snapshot);
      } catch (error) {
        cleanupError = getErrorMessage(error);
        this.applied.rendererActive = false;
        this.rendererCleanupRequired = true;
        this.failRendererCleanup(error);
      }
    }

    if (backendNeedsCleanup) {
      try {
        await this.service.stop();
      } catch (error) {
        cleanupError = cleanupError || getErrorMessage(error);
      }
      this.applied.backendReady = false;
      this.applied.apiKey = '';
    }

    const latest = this.desired;
    if (!latest.shouldRun) {
      this.applied.sessionRevision = snapshot.sessionRevision;
      this.publishState({
        active: false,
        phase: 'inactive',
        reason: latest.reason,
        error: latest.error || cleanupError
      });
      return;
    }

    this.publishState({
      active: false,
      phase: 'inactive',
      reason: 'stopped',
      error: cleanupError
    });
  }

  async reconcileSession(snapshot) {
    this.publishState({
      active: false,
      phase: this.applied.rendererActive ? 'reconnecting' : this.state.phase,
      reason: 'clearing',
      error: ''
    });
    if (!this.isCurrent(snapshot)) {
      return;
    }
    const outcome = await this.executeSupersedableEffect(
      'clear',
      snapshot,
      (signal) => this.service.clear({
        apiKey: snapshot.apiKey,
        signal,
        revision: snapshot.revision,
        sessionRevision: snapshot.sessionRevision
      })
    );

    if (outcome.ok) {
      this.applied.sessionRevision = snapshot.sessionRevision;
      if (outcome.value === false) {
        this.applied.backendReady = false;
        this.applied.apiKey = '';
      } else if (outcome.value === true) {
        this.applied.backendReady = true;
        this.applied.apiKey = snapshot.apiKey;
      }
      return;
    }

    if (isSupersededError(outcome.error) || !this.isCurrent(snapshot)) {
      return;
    }

    this.failCurrentEffect(snapshot, 'backend-failed', outcome.error);
  }

  async reconcileBackendStart(snapshot) {
    this.publishState({
      active: false,
      phase: 'connecting',
      reason: 'backend-connecting',
      error: ''
    });
    if (!this.isCurrent(snapshot)) {
      return;
    }
    const outcome = await this.executeSupersedableEffect(
      'connect',
      snapshot,
      (signal) => this.service.start({
        apiKey: snapshot.apiKey,
        signal,
        revision: snapshot.revision
      })
    );

    if (outcome.ok) {
      this.applied.backendReady = true;
      this.applied.apiKey = snapshot.apiKey;
      return;
    }

    if (isSupersededError(outcome.error) || !this.isCurrent(snapshot)) {
      return;
    }

    this.failCurrentEffect(snapshot, 'start-failed', outcome.error);
  }

  async reconcileApiKey(snapshot) {
    this.publishState({
      active: false,
      phase: 'reconnecting',
      reason: 'api-key-rotation',
      error: ''
    });
    if (!this.isCurrent(snapshot)) {
      return;
    }
    const outcome = await this.executeSupersedableEffect(
      'rotate',
      snapshot,
      (signal) => this.service.rotateApiKey({
        apiKey: snapshot.apiKey,
        signal,
        revision: snapshot.revision
      })
    );

    if (outcome.ok) {
      this.applied.backendReady = true;
      this.applied.apiKey = snapshot.apiKey;
      return;
    }

    if (isSupersededError(outcome.error) || !this.isCurrent(snapshot)) {
      return;
    }

    this.failCurrentEffect(snapshot, 'api-key-rotation-failed', outcome.error);
  }

  async reconcileRendererStart(snapshot) {
    if (this.rendererCleanupRequired) {
      this.publishState({
        active: false,
        phase: 'stopping',
        reason: 'renderer-cleanup',
        error: ''
      });
      try {
        await this.cleanupRenderer(snapshot);
      } catch (error) {
        this.failRendererCleanup(error);
        return;
      }
      if (!this.isCurrent(snapshot)) {
        return;
      }
    }

    this.publishState({
      active: false,
      phase: 'awaiting-renderer',
      reason: 'capture-required',
      error: ''
    });
    if (!this.isCurrent(snapshot)) {
      return;
    }

    let rendererStarted = false;
    let rendererError = null;
    try {
      rendererStarted = await this.requestRendererStart({
        operationId: snapshot.revision,
        revision: snapshot.revision
      });
    } catch (error) {
      rendererError = error;
    }

    if (rendererStarted) {
      this.applied.rendererActive = true;
      this.rendererCleanupRequired = false;
      return;
    }

    this.rendererCleanupRequired = true;

    if (!this.isCurrent(snapshot)) {
      return;
    }

    this.failCurrentEffect(
      snapshot,
      'renderer-start-failed',
      rendererError,
      { includeError: Boolean(rendererError) }
    );
  }

  failCurrentEffect(snapshot, reason, error, { includeError = true } = {}) {
    if (!this.isCurrent(snapshot)) {
      return false;
    }

    this.revision += 1;
    this.desired = {
      ...this.desired,
      shouldRun: false,
      sessionRevision: this.applied.sessionRevision,
      reason,
      error: includeError ? getErrorMessage(error) : '',
      revision: this.revision
    };
    this.reconcileRequested = true;
    return true;
  }

  async cleanupRenderer(snapshot) {
    const acknowledged = await this.requestRendererStop({
      operationId: snapshot.revision,
      revision: snapshot.revision
    });
    if (acknowledged !== true) {
      throw new Error('Renderer capture cleanup was not acknowledged.');
    }
    this.applied.rendererActive = false;
    this.rendererCleanupRequired = false;
  }

  failRendererCleanup(error) {
    this.revision += 1;
    this.desired = {
      ...this.desired,
      shouldRun: false,
      sessionRevision: this.applied.sessionRevision,
      reason: 'renderer-stop-failed',
      error: getErrorMessage(error),
      revision: this.revision
    };
    this.reconcileRequested = true;
  }

  async executeSupersedableEffect(kind, snapshot, effect) {
    const controller = new AbortController();
    const token = {
      kind,
      revision: snapshot.revision,
      controller
    };
    this.supersedableEffect = token;

    try {
      return {
        ok: true,
        value: await effect(controller.signal)
      };
    } catch (error) {
      return { ok: false, error };
    } finally {
      if (this.supersedableEffect === token) {
        this.supersedableEffect = null;
      }
    }
  }
}

module.exports = {
  DeepgramLifecycleCoordinator
};
