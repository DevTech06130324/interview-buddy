const EventEmitter = require('events');
const { randomUUID } = require('crypto');

const { TRANSCRIPT_SPEAKER_TAG } = require('./transcriptPrompt');

const DEEPGRAM_ROLE_THEM = TRANSCRIPT_SPEAKER_TAG;
const DEEPGRAM_ROLE_ME = 'Me';
const DEEPGRAM_LISTEN_URL = 'wss://api.deepgram.com/v1/listen?model=nova-2&smart_format=true&punctuate=true&interim_results=true';
const DEEPGRAM_AUDIO_MIME_TYPE = 'audio/webm;codecs=opus';
const DEEPGRAM_CLOSE_MESSAGE = JSON.stringify({ type: 'CloseStream' });
const DEEPGRAM_PENDING_AUDIO_CHUNK_LIMIT = 16;
const DEEPGRAM_OPEN_TIMEOUT_MS = 10_000;
const DEEPGRAM_RETRY_DELAYS_MS = Object.freeze([500, 1000, 2000]);
const DEEPGRAM_CLOSE_GRACE_MS = 1500;

function normalizeDeepgramApiKey(apiKey) {
  return String(apiKey || '').trim();
}

function normalizeDeepgramRole(role) {
  return role === DEEPGRAM_ROLE_ME ? DEEPGRAM_ROLE_ME : DEEPGRAM_ROLE_THEM;
}

function getTranscriptFromDeepgramMessage(message) {
  const alternatives = message?.channel?.alternatives;
  if (!Array.isArray(alternatives) || alternatives.length === 0) {
    return '';
  }

  return String(alternatives[0]?.transcript || '').trim();
}

function isFinalDeepgramMessage(message) {
  return Boolean(message?.is_final || message?.speech_final);
}

function getOpenReadyState(WebSocketImpl) {
  return typeof WebSocketImpl?.OPEN === 'number' ? WebSocketImpl.OPEN : 1;
}

function getClosedReadyState(WebSocketImpl) {
  return typeof WebSocketImpl?.CLOSED === 'number' ? WebSocketImpl.CLOSED : 3;
}

function resolveWebSocketImpl(injectedWebSocketImpl) {
  if (injectedWebSocketImpl) {
    return injectedWebSocketImpl;
  }

  // Loaded lazily so Linux tests can inject a complete socket fake.
  return require('ws');
}

function createRoleCounterMap() {
  return new Map([
    [DEEPGRAM_ROLE_THEM, 0],
    [DEEPGRAM_ROLE_ME, 0]
  ]);
}

function createRoleValueMap(createValue) {
  return new Map([
    [DEEPGRAM_ROLE_THEM, createValue(DEEPGRAM_ROLE_THEM)],
    [DEEPGRAM_ROLE_ME, createValue(DEEPGRAM_ROLE_ME)]
  ]);
}

function takeNextRoleCounter(counterMap, role) {
  const normalizedRole = normalizeDeepgramRole(role);
  const nextCounter = counterMap.get(normalizedRole) || 0;
  counterMap.set(normalizedRole, nextCounter + 1);
  return nextCounter;
}

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject, settled: false };
}

class DeepgramTranscriptionService extends EventEmitter {
  constructor({
    WebSocketImpl = null,
    listenUrl = DEEPGRAM_LISTEN_URL,
    openTimeoutMs = DEEPGRAM_OPEN_TIMEOUT_MS,
    retryDelaysMs = DEEPGRAM_RETRY_DELAYS_MS,
    closeGraceMs = DEEPGRAM_CLOSE_GRACE_MS,
    setTimeoutFn = setTimeout,
    clearTimeoutFn = clearTimeout
  } = {}) {
    super();
    this.injectedWebSocketImpl = WebSocketImpl;
    this.listenUrl = listenUrl;
    this.openTimeoutMs = openTimeoutMs;
    this.retryDelaysMs = [...retryDelaysMs];
    this.closeGraceMs = closeGraceMs;
    this.setTimeoutFn = setTimeoutFn;
    this.clearTimeoutFn = clearTimeoutFn;
    this.sockets = new Map();
    this.roleStates = createRoleValueMap(() => this.createRoleState());
    this.roleReadyWaiters = new Map();
    this.operationId = 0;
    this.sessionId = randomUUID();
    this.entries = [];
    this.partialEntries = new Map();
    this.partialEntryIds = new Map();
    this.partialEntryOrders = new Map();
    this.entryCounters = createRoleCounterMap();
    this.partialEntryCounters = createRoleCounterMap();
    this.entryOrderCounter = 0;
    this.payloadVersion = 0;
    this.active = false;
    this.phase = 'inactive';
    this.apiKey = '';
    this.pendingAudioChunks = createRoleValueMap(() => []);
    this.startPromise = null;
    this.stopPromise = null;
    this.fatalPromise = null;
  }

  createRoleState() {
    return {
      retryAttempt: 0,
      retryTimer: null,
      openTimer: null,
      status: 'inactive'
    };
  }

  clearRoleTimer(state, timerName) {
    if (state?.[timerName] !== null && state?.[timerName] !== undefined) {
      this.clearTimeoutFn(state[timerName]);
      state[timerName] = null;
    }
  }

  cancelRoleTimers() {
    for (const state of this.roleStates.values()) {
      this.clearRoleTimer(state, 'retryTimer');
      this.clearRoleTimer(state, 'openTimer');
    }
  }

  rejectRoleWaiters(error) {
    for (const waiter of this.roleReadyWaiters.values()) {
      if (!waiter.settled) {
        waiter.settled = true;
        waiter.reject(error);
      }
    }
    this.roleReadyWaiters.clear();
  }

  createReadinessPromise(operationId) {
    this.rejectRoleWaiters(new Error('Deepgram connection operation was replaced.'));
    this.roleReadyWaiters = createRoleValueMap(() => createDeferred());
    return Promise.all([...this.roleReadyWaiters.values()].map((waiter) => waiter.promise))
      .then(() => {
        if (!this.active || operationId !== this.operationId) {
          throw new Error('Deepgram connection operation was cancelled.');
        }
        this.phase = 'active';
        this.roleReadyWaiters.clear();
        return true;
      });
  }

  resolveRoleReady(role) {
    const waiter = this.roleReadyWaiters.get(normalizeDeepgramRole(role));
    if (waiter && !waiter.settled) {
      waiter.settled = true;
      waiter.resolve(true);
    }
  }

  rejectRoleReady(role, error) {
    const waiter = this.roleReadyWaiters.get(normalizeDeepgramRole(role));
    if (waiter && !waiter.settled) {
      waiter.settled = true;
      waiter.reject(error);
    }
  }

  resetConnectionState({ clearBuffers = true } = {}) {
    this.cancelRoleTimers();
    this.roleStates = createRoleValueMap(() => this.createRoleState());
    if (clearBuffers) {
      this.pendingAudioChunks = createRoleValueMap(() => []);
    }
  }

  start({ apiKey } = {}) {
    const normalizedApiKey = normalizeDeepgramApiKey(apiKey);
    if (!normalizedApiKey) {
      return Promise.reject(new Error('Deepgram API key is required.'));
    }
    if (this.active) {
      if (normalizedApiKey === this.apiKey) {
        return this.startPromise || Promise.resolve(true);
      }
      return this.rotateApiKey({ apiKey: normalizedApiKey });
    }

    this.active = true;
    this.phase = 'starting';
    this.apiKey = normalizedApiKey;
    this.payloadVersion += 1;
    const operationId = ++this.operationId;
    this.resetConnectionState({ clearBuffers: true });
    const readinessPromise = this.createReadinessPromise(operationId);

    this.connectRole(DEEPGRAM_ROLE_THEM, operationId);
    this.connectRole(DEEPGRAM_ROLE_ME, operationId);
    this.emitSnapshot();

    const trackedStartPromise = readinessPromise
      .catch(async (error) => {
        if (operationId === this.operationId && this.phase !== 'stopping') {
          await this.failClosed(error, { emitFatal: false });
        }
        throw error;
      })
      .finally(() => {
        if (this.startPromise === trackedStartPromise) {
          this.startPromise = null;
        }
      });
    this.startPromise = trackedStartPromise;
    return this.startPromise;
  }

  connectRole(role, operationId) {
    const normalizedRole = normalizeDeepgramRole(role);
    if (!this.active || operationId !== this.operationId || this.phase === 'stopping') {
      return;
    }

    const state = this.roleStates.get(normalizedRole) || this.createRoleState();
    this.roleStates.set(normalizedRole, state);
    this.clearRoleTimer(state, 'retryTimer');
    state.status = 'connecting';
    const socketSessionId = this.sessionId;
    const WebSocketImpl = resolveWebSocketImpl(this.injectedWebSocketImpl);
    let socket;

    try {
      socket = new WebSocketImpl(this.listenUrl, {
        headers: {
          Authorization: `Token ${this.apiKey}`,
          'Content-Type': DEEPGRAM_AUDIO_MIME_TYPE
        },
        role: normalizedRole
      });
    } catch (error) {
      this.handleRoleFailure(normalizedRole, null, socketSessionId, operationId, error);
      return;
    }

    this.sockets.set(normalizedRole, socket);
    state.openTimer = this.setTimeoutFn(() => {
      this.handleRoleFailure(
        normalizedRole,
        socket,
        socketSessionId,
        operationId,
        new Error(`Deepgram ${normalizedRole} socket open timed out after ${this.openTimeoutMs} ms.`)
      );
    }, this.openTimeoutMs);

    socket.on('open', () => {
      if (!this.isCurrentSocket(normalizedRole, socket, socketSessionId, operationId)) {
        return;
      }
      this.clearRoleTimer(state, 'openTimer');
      state.retryAttempt = 0;
      state.status = 'open';
      if (!this.flushPendingAudioChunks(normalizedRole, socket)) {
        return;
      }
      if (!this.isCurrentSocket(normalizedRole, socket, socketSessionId, operationId)) {
        return;
      }
      this.resolveRoleReady(normalizedRole);
      this.emit('roleOpen', { role: normalizedRole });
    });
    socket.on('message', (message) => {
      if (this.isCurrentSocket(normalizedRole, socket, socketSessionId, operationId)) {
        this.handleSocketMessage(normalizedRole, message);
      }
    });
    socket.on('error', (error) => {
      this.handleRoleFailure(normalizedRole, socket, socketSessionId, operationId, error);
    });
    socket.on('close', () => {
      if (this.phase === 'stopping' && this.sockets.get(normalizedRole) === socket) {
        this.sockets.delete(normalizedRole);
        return;
      }
      this.handleRoleFailure(
        normalizedRole,
        socket,
        socketSessionId,
        operationId,
        new Error(`Deepgram ${normalizedRole} socket closed unexpectedly.`)
      );
    });
  }

  handleRoleFailure(role, socket, sessionId, operationId, rawError) {
    const normalizedRole = normalizeDeepgramRole(role);
    if (socket && !this.isCurrentSocket(normalizedRole, socket, sessionId, operationId)) {
      return;
    }
    if (!socket && (!this.active || operationId !== this.operationId || sessionId !== this.sessionId)) {
      return;
    }

    const state = this.roleStates.get(normalizedRole) || this.createRoleState();
    this.roleStates.set(normalizedRole, state);
    this.clearRoleTimer(state, 'openTimer');
    if (socket && this.sockets.get(normalizedRole) === socket) {
      this.sockets.delete(normalizedRole);
      try {
        socket.close?.();
      } catch (_) {
        // The failed socket is already invalidated by identity.
      }
    }

    if (!this.active || this.phase === 'stopping' || operationId !== this.operationId) {
      return;
    }

    if (state.retryAttempt >= this.retryDelaysMs.length) {
      const error = new Error(
        `Deepgram ${normalizedRole} failed after ${this.retryDelaysMs.length} retries: ${rawError?.message || String(rawError)}`
      );
      state.status = 'failed';
      this.rejectRoleReady(normalizedRole, error);
      void this.failClosed(error);
      return;
    }

    const delayMs = this.retryDelaysMs[state.retryAttempt];
    state.retryAttempt += 1;
    state.status = 'reconnecting';
    this.emit('reconnecting', {
      role: normalizedRole,
      attempt: state.retryAttempt,
      delayMs,
      error: rawError
    });
    state.retryTimer = this.setTimeoutFn(() => {
      state.retryTimer = null;
      this.connectRole(normalizedRole, operationId);
    }, delayMs);
  }

  isCurrentSocket(role, socket, sessionId, operationId = this.operationId) {
    return this.phase !== 'inactive'
      && sessionId === this.sessionId
      && operationId === this.operationId
      && this.sockets.get(normalizeDeepgramRole(role)) === socket;
  }

  sendAudioChunk(role, chunk) {
    const normalizedRole = normalizeDeepgramRole(role);
    if (!this.active || this.phase === 'stopping') {
      return false;
    }

    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    if (buffer.length === 0) {
      return false;
    }

    const socket = this.sockets.get(normalizedRole);
    const WebSocketImpl = resolveWebSocketImpl(this.injectedWebSocketImpl);
    if (!socket || socket.readyState !== getOpenReadyState(WebSocketImpl)) {
      return this.bufferAudioChunk(normalizedRole, buffer);
    }

    try {
      socket.send(buffer);
      return true;
    } catch (error) {
      this.handleRoleFailure(normalizedRole, socket, this.sessionId, this.operationId, error);
      return this.bufferAudioChunk(normalizedRole, buffer);
    }
  }

  bufferAudioChunk(role, buffer) {
    const normalizedRole = normalizeDeepgramRole(role);
    const pendingChunks = this.pendingAudioChunks.get(normalizedRole) || [];
    if (pendingChunks.length >= DEEPGRAM_PENDING_AUDIO_CHUNK_LIMIT) {
      void this.failClosed(new Error(`Deepgram ${normalizedRole} audio buffer overflowed.`));
      return false;
    }

    pendingChunks.push(Buffer.from(buffer));
    this.pendingAudioChunks.set(normalizedRole, pendingChunks);
    return true;
  }

  flushPendingAudioChunks(role, socket) {
    const normalizedRole = normalizeDeepgramRole(role);
    const pendingChunks = this.pendingAudioChunks.get(normalizedRole) || [];
    if (pendingChunks.length === 0) {
      return true;
    }

    const WebSocketImpl = resolveWebSocketImpl(this.injectedWebSocketImpl);
    if (!socket || socket.readyState !== getOpenReadyState(WebSocketImpl)) {
      return false;
    }

    while (pendingChunks.length > 0) {
      try {
        const chunk = pendingChunks[0];
        socket.send(chunk);
        pendingChunks.shift();
        this.pendingAudioChunks.set(normalizedRole, pendingChunks);
      } catch (error) {
        this.handleRoleFailure(normalizedRole, socket, this.sessionId, this.operationId, error);
        return false;
      }
    }
    return true;
  }

  waitForSocketClose(socket) {
    const WebSocketImpl = resolveWebSocketImpl(this.injectedWebSocketImpl);
    if (!socket || socket.readyState === getClosedReadyState(WebSocketImpl)) {
      return Promise.resolve();
    }
    return new Promise((resolve) => socket.on('close', resolve));
  }

  waitForDelay(delayMs) {
    return new Promise((resolve) => this.setTimeoutFn(resolve, delayMs));
  }

  waitForSocketDrain(closeWaits) {
    return new Promise((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) {
          return;
        }
        settled = true;
        if (graceTimer !== null) {
          this.clearTimeoutFn(graceTimer);
        }
        resolve();
      };
      const graceTimer = this.setTimeoutFn(finish, this.closeGraceMs);
      Promise.allSettled(closeWaits).then(finish);
    });
  }

  stop({ graceful = true } = {}) {
    if (this.stopPromise) {
      return this.stopPromise;
    }
    if (this.phase === 'inactive' && this.sockets.size === 0) {
      this.active = false;
      this.apiKey = '';
      return Promise.resolve(false);
    }

    this.active = false;
    this.phase = 'stopping';
    this.cancelRoleTimers();
    this.rejectRoleWaiters(new Error('Deepgram transcription stopped.'));
    const operationId = this.operationId;
    const sockets = [...new Set(this.sockets.values())];
    const closeWaits = sockets.map((socket) => this.waitForSocketClose(socket));

    for (const socket of sockets) {
      try {
        socket.send?.(DEEPGRAM_CLOSE_MESSAGE);
      } catch (_) {
        // Force-close below if the graceful close message cannot be sent.
      }
    }

    this.stopPromise = (async () => {
      if (graceful && sockets.length > 0) {
        await this.waitForSocketDrain(closeWaits);
      }

      const WebSocketImpl = resolveWebSocketImpl(this.injectedWebSocketImpl);
      for (const socket of sockets) {
        if (socket.readyState !== getClosedReadyState(WebSocketImpl)) {
          try {
            socket.close?.();
          } catch (_) {
            // Socket identity is invalidated below even if force-close throws.
          }
        }
      }

      if (operationId === this.operationId) {
        this.operationId += 1;
      }
      this.sockets.clear();
      this.phase = 'inactive';
      this.apiKey = '';
      this.partialEntries.clear();
      this.partialEntryIds.clear();
      this.partialEntryOrders.clear();
      this.pendingAudioChunks = createRoleValueMap(() => []);
      return true;
    })().finally(() => {
      this.stopPromise = null;
    });
    return this.stopPromise;
  }

  failClosed(rawError, { emitFatal = true } = {}) {
    if (this.fatalPromise) {
      return this.fatalPromise;
    }
    const error = rawError instanceof Error ? rawError : new Error(String(rawError));
    this.rejectRoleWaiters(error);
    this.fatalPromise = this.stop({ graceful: false })
      .then(() => {
        if (emitFatal) {
          this.emit('fatalError', error);
        }
      })
      .finally(() => {
        this.fatalPromise = null;
      });
    return this.fatalPromise;
  }

  closeReplacedSockets(sockets) {
    const WebSocketImpl = resolveWebSocketImpl(this.injectedWebSocketImpl);
    for (const socket of sockets) {
      try {
        socket.send?.(DEEPGRAM_CLOSE_MESSAGE);
      } catch (_) {
        // Replacement is forceful if the socket cannot drain.
      }
      if (socket.readyState !== getClosedReadyState(WebSocketImpl)) {
        try {
          socket.close?.();
        } catch (_) {
          // Old callbacks are already invalidated by socket identity.
        }
      }
    }
  }

  rotateApiKey({ apiKey } = {}) {
    const normalizedApiKey = normalizeDeepgramApiKey(apiKey);
    if (!normalizedApiKey) {
      return Promise.reject(new Error('Deepgram API key is required.'));
    }
    if (!this.active) {
      return this.start({ apiKey: normalizedApiKey });
    }

    const oldSockets = [...new Set(this.sockets.values())];
    this.cancelRoleTimers();
    this.sockets.clear();
    this.apiKey = normalizedApiKey;
    this.phase = 'reconnecting';
    const operationId = ++this.operationId;
    this.resetConnectionState({ clearBuffers: false });
    const readinessPromise = this.createReadinessPromise(operationId);
    this.closeReplacedSockets(oldSockets);
    this.connectRole(DEEPGRAM_ROLE_THEM, operationId);
    this.connectRole(DEEPGRAM_ROLE_ME, operationId);

    return readinessPromise.catch(async (error) => {
      if (operationId === this.operationId) {
        await this.failClosed(error);
      }
      throw error;
    });
  }

  clear() {
    const shouldResume = this.active;
    const resumeApiKey = this.apiKey;
    const oldSockets = [...new Set(this.sockets.values())];
    this.cancelRoleTimers();
    this.sockets.clear();
    this.rejectRoleWaiters(new Error('Deepgram transcript session was cleared.'));
    this.operationId += 1;
    this.closeReplacedSockets(oldSockets);

    this.sessionId = randomUUID();
    this.entries = [];
    this.partialEntries.clear();
    this.partialEntryIds.clear();
    this.partialEntryOrders.clear();
    this.entryCounters = createRoleCounterMap();
    this.partialEntryCounters = createRoleCounterMap();
    this.entryOrderCounter = 0;
    this.pendingAudioChunks = createRoleValueMap(() => []);
    this.payloadVersion += 1;
    this.emitSnapshot();

    if (!shouldResume || !resumeApiKey) {
      this.active = false;
      this.phase = 'inactive';
      this.apiKey = '';
      return Promise.resolve(false);
    }

    this.active = true;
    this.phase = 'starting';
    this.apiKey = resumeApiKey;
    const operationId = this.operationId;
    this.resetConnectionState({ clearBuffers: true });
    const readinessPromise = this.createReadinessPromise(operationId);
    this.connectRole(DEEPGRAM_ROLE_THEM, operationId);
    this.connectRole(DEEPGRAM_ROLE_ME, operationId);
    return readinessPromise.catch(async (error) => {
      if (operationId === this.operationId) {
        await this.failClosed(error);
      }
      throw error;
    });
  }

  getPartialEntryId(role) {
    const normalizedRole = normalizeDeepgramRole(role);
    const existingId = this.partialEntryIds.get(normalizedRole);
    if (existingId) {
      return existingId;
    }

    const nextId = [
      'deepgram',
      this.sessionId,
      normalizedRole.toLowerCase(),
      'partial',
      takeNextRoleCounter(this.partialEntryCounters, normalizedRole)
    ].join('-');
    this.partialEntryIds.set(normalizedRole, nextId);
    return nextId;
  }

  getFinalEntryId(role) {
    const normalizedRole = normalizeDeepgramRole(role);
    return [
      'deepgram',
      this.sessionId,
      normalizedRole.toLowerCase(),
      takeNextRoleCounter(this.entryCounters, normalizedRole)
    ].join('-');
  }

  getPartialEntryOrder(role) {
    const normalizedRole = normalizeDeepgramRole(role);
    const existingOrder = this.partialEntryOrders.get(normalizedRole);
    if (Number.isFinite(existingOrder)) {
      return existingOrder;
    }

    const nextOrder = this.entryOrderCounter++;
    this.partialEntryOrders.set(normalizedRole, nextOrder);
    return nextOrder;
  }

  handleSocketMessage(role, rawMessage) {
    let message;
    try {
      message = JSON.parse(Buffer.isBuffer(rawMessage) ? rawMessage.toString('utf8') : String(rawMessage));
    } catch (error) {
      this.emit('error', error);
      return;
    }

    const sourceText = getTranscriptFromDeepgramMessage(message);
    if (!sourceText) {
      return;
    }

    const normalizedRole = normalizeDeepgramRole(role);
    const isFinal = isFinalDeepgramMessage(message);
    const order = isFinal
      ? this.partialEntryOrders.get(normalizedRole) ?? this.entryOrderCounter++
      : this.getPartialEntryOrder(normalizedRole);
    const entry = {
      id: isFinal
        ? this.getFinalEntryId(normalizedRole)
        : this.getPartialEntryId(normalizedRole),
      sourceText,
      translatedText: '',
      status: 'disabled',
      isFinal,
      speakerTag: normalizedRole,
      order
    };

    if (isFinal) {
      this.partialEntries.delete(normalizedRole);
      this.partialEntryIds.delete(normalizedRole);
      this.partialEntryOrders.delete(normalizedRole);
      this.entries.push(entry);
    } else {
      this.partialEntries.set(normalizedRole, entry);
    }

    this.payloadVersion += 1;
    this.emitSnapshot();
  }

  getEntriesSnapshot() {
    return [...this.entries, ...this.partialEntries.values()]
      .sort((left, right) => {
        const leftOrder = Number.isFinite(left.order) ? left.order : 0;
        const rightOrder = Number.isFinite(right.order) ? right.order : 0;
        return leftOrder - rightOrder;
      })
      .map(({ order, ...entry }) => ({ ...entry }));
  }

  getPayload() {
    const entries = this.getEntriesSnapshot();
    return {
      payloadVersion: this.payloadVersion,
      fullText: entries.map((entry) => entry.sourceText).join('\n'),
      translationEnabled: false,
      entries
    };
  }

  emitSnapshot() {
    this.emit('captionUpdate', this.getPayload());
  }
}

module.exports = {
  DEEPGRAM_AUDIO_MIME_TYPE,
  DEEPGRAM_CLOSE_GRACE_MS,
  DEEPGRAM_LISTEN_URL,
  DEEPGRAM_OPEN_TIMEOUT_MS,
  DEEPGRAM_PENDING_AUDIO_CHUNK_LIMIT,
  DEEPGRAM_RETRY_DELAYS_MS,
  DEEPGRAM_ROLE_ME,
  DEEPGRAM_ROLE_THEM,
  DeepgramTranscriptionService,
  normalizeDeepgramApiKey,
  normalizeDeepgramRole
};
