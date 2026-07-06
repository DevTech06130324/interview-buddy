const EventEmitter = require('events');

const { TRANSCRIPT_SPEAKER_TAG } = require('./transcriptPrompt');

const DEEPGRAM_ROLE_THEM = TRANSCRIPT_SPEAKER_TAG;
const DEEPGRAM_ROLE_ME = 'Me';
const DEEPGRAM_LISTEN_URL = 'wss://api.deepgram.com/v1/listen?model=nova-2&smart_format=true&punctuate=true&interim_results=true';
const DEEPGRAM_AUDIO_MIME_TYPE = 'audio/webm;codecs=opus';
const DEEPGRAM_FINALIZE_MESSAGE = JSON.stringify({ type: 'Finalize' });
const DEEPGRAM_CLOSE_MESSAGE = JSON.stringify({ type: 'CloseStream' });
const DEEPGRAM_PENDING_AUDIO_CHUNK_LIMIT = 16;

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

function getConnectingReadyState(WebSocketImpl) {
  return typeof WebSocketImpl?.CONNECTING === 'number' ? WebSocketImpl.CONNECTING : 0;
}

function resolveWebSocketImpl(injectedWebSocketImpl) {
  if (injectedWebSocketImpl) {
    return injectedWebSocketImpl;
  }

  // Loaded lazily so tests can inject a fake without requiring the runtime package.
  return require('ws');
}

class DeepgramTranscriptionService extends EventEmitter {
  constructor({
    WebSocketImpl = null,
    listenUrl = DEEPGRAM_LISTEN_URL
  } = {}) {
    super();
    this.injectedWebSocketImpl = WebSocketImpl;
    this.listenUrl = listenUrl;
    this.sockets = new Map();
    this.entries = [];
    this.partialEntries = new Map();
    this.partialEntryIds = new Map();
    this.partialEntryOrders = new Map();
    this.entryCounter = 0;
    this.partialEntryCounter = 0;
    this.entryOrderCounter = 0;
    this.payloadVersion = 0;
    this.active = false;
    this.apiKey = '';
    this.pendingAudioChunks = new Map();
  }

  start({ apiKey } = {}) {
    const normalizedApiKey = normalizeDeepgramApiKey(apiKey);
    if (!normalizedApiKey) {
      throw new Error('Deepgram API key is required.');
    }

    this.stop();
    this.active = true;
    this.apiKey = normalizedApiKey;
    this.entries = [];
    this.partialEntries.clear();
    this.partialEntryIds.clear();
    this.partialEntryOrders.clear();
    this.entryCounter = 0;
    this.partialEntryCounter = 0;
    this.entryOrderCounter = 0;
    this.pendingAudioChunks.clear();
    this.payloadVersion += 1;

    this.createRoleSocket(DEEPGRAM_ROLE_THEM);
    this.createRoleSocket(DEEPGRAM_ROLE_ME);
    this.emitSnapshot();
  }

  stop() {
    for (const socket of this.sockets.values()) {
      try {
        if (typeof socket.send === 'function') {
          socket.send(DEEPGRAM_CLOSE_MESSAGE);
        }
      } catch (_) {
        // Ignore close-frame failures; the socket is being torn down anyway.
      }

      try {
        if (typeof socket.close === 'function') {
          socket.close();
        }
      } catch (_) {
        // Ignore close errors during shutdown.
      }
    }

    this.sockets.clear();
    this.active = false;
    this.apiKey = '';
    this.partialEntries.clear();
    this.partialEntryIds.clear();
    this.partialEntryOrders.clear();
    this.pendingAudioChunks.clear();
  }

  clear() {
    this.entries = [];
    this.partialEntries.clear();
    this.partialEntryIds.clear();
    this.partialEntryOrders.clear();
    this.entryCounter = 0;
    this.partialEntryCounter = 0;
    this.entryOrderCounter = 0;
    this.payloadVersion += 1;
    this.emitSnapshot();
  }

  getPartialEntryId(role) {
    const normalizedRole = normalizeDeepgramRole(role);
    const existingId = this.partialEntryIds.get(normalizedRole);
    if (existingId) {
      return existingId;
    }

    const nextId = `deepgram-${normalizedRole.toLowerCase()}-partial-${this.partialEntryCounter++}`;
    this.partialEntryIds.set(normalizedRole, nextId);
    return nextId;
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

  createRoleSocket(role) {
    const normalizedRole = normalizeDeepgramRole(role);
    const WebSocketImpl = resolveWebSocketImpl(this.injectedWebSocketImpl);
    this.pendingAudioChunks.set(normalizedRole, []);
    const socket = new WebSocketImpl(this.listenUrl, {
      headers: {
        Authorization: `Token ${this.apiKey}`,
        'Content-Type': DEEPGRAM_AUDIO_MIME_TYPE
      },
      role: normalizedRole
    });

    socket.on('open', () => {
      this.flushPendingAudioChunks(normalizedRole, socket);
    });
    socket.on('message', (message) => {
      this.handleSocketMessage(normalizedRole, message);
    });
    socket.on('error', (error) => {
      this.emit('error', error);
    });
    socket.on('close', () => {
      if (this.sockets.get(normalizedRole) === socket) {
        this.sockets.delete(normalizedRole);
      }
    });

    this.sockets.set(normalizedRole, socket);
    return socket;
  }

  sendAudioChunk(role, chunk) {
    const normalizedRole = normalizeDeepgramRole(role);
    if (!this.active) {
      return false;
    }

    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    if (buffer.length === 0) {
      return false;
    }

    const socket = this.sockets.get(normalizedRole);
    const WebSocketImpl = resolveWebSocketImpl(this.injectedWebSocketImpl);
    if (!socket || socket.readyState !== getOpenReadyState(WebSocketImpl)) {
      if (socket?.readyState === getConnectingReadyState(WebSocketImpl)) {
        return this.bufferAudioChunk(normalizedRole, buffer);
      }

      return false;
    }

    socket.send(buffer);
    return true;
  }

  bufferAudioChunk(role, buffer) {
    const pendingChunks = this.pendingAudioChunks.get(role) || [];
    if (pendingChunks.length >= DEEPGRAM_PENDING_AUDIO_CHUNK_LIMIT) {
      return false;
    }

    pendingChunks.push(Buffer.from(buffer));
    this.pendingAudioChunks.set(role, pendingChunks);
    return true;
  }

  flushPendingAudioChunks(role, socket) {
    const pendingChunks = this.pendingAudioChunks.get(role) || [];
    if (pendingChunks.length === 0) {
      return;
    }

    const WebSocketImpl = resolveWebSocketImpl(this.injectedWebSocketImpl);
    if (!socket || socket.readyState !== getOpenReadyState(WebSocketImpl)) {
      return;
    }

    for (const chunk of pendingChunks) {
      socket.send(chunk);
    }
    this.pendingAudioChunks.set(role, []);
  }

  finalize() {
    for (const socket of this.sockets.values()) {
      if (typeof socket.send === 'function') {
        socket.send(DEEPGRAM_FINALIZE_MESSAGE);
      }
    }
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
        ? `deepgram-${normalizedRole.toLowerCase()}-${this.entryCounter++}`
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
  DEEPGRAM_ROLE_ME,
  DEEPGRAM_ROLE_THEM,
  DEEPGRAM_LISTEN_URL,
  DeepgramTranscriptionService,
  normalizeDeepgramApiKey,
  normalizeDeepgramRole
};
