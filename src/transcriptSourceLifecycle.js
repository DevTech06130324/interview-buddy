const TRANSCRIPT_SOURCES = Object.freeze([
  'live-captions',
  'deepgram'
]);

const TRANSCRIPT_SOURCE_LIFECYCLE_PHASES = Object.freeze([
  'inactive',
  'connecting',
  'active',
  'reconnecting',
  'stopping',
  'error'
]);

const SUPPORTED_SOURCES = new Set(TRANSCRIPT_SOURCES);
const SUPPORTED_PHASES = new Set(TRANSCRIPT_SOURCE_LIFECYCLE_PHASES);

const INTERNAL_PHASE_MAP = Object.freeze({
  'live-captions': Object.freeze({
    inactive: 'inactive',
    starting: 'connecting',
    active: 'active',
    restarting: 'reconnecting',
    stopping: 'stopping',
    closing: 'stopping',
    error: 'error'
  }),
  deepgram: Object.freeze({
    inactive: 'inactive',
    starting: 'connecting',
    connecting: 'connecting',
    'awaiting-renderer': 'connecting',
    active: 'active',
    reconnecting: 'reconnecting',
    stopping: 'stopping',
    error: 'error'
  })
});

function normalizeSource(source, fallbackSource = 'live-captions') {
  if (SUPPORTED_SOURCES.has(source)) {
    return source;
  }

  return SUPPORTED_SOURCES.has(fallbackSource)
    ? fallbackSource
    : 'live-captions';
}

function normalizeSessionId(sessionId, fallbackSessionId = '') {
  if (typeof sessionId === 'string' && sessionId.trim()) {
    return sessionId.trim().slice(0, 128);
  }

  return typeof fallbackSessionId === 'string'
    ? fallbackSessionId.trim().slice(0, 128)
    : '';
}

function normalizeRetryAttempt(retryAttempt) {
  const numericAttempt = Number(retryAttempt);
  if (!Number.isFinite(numericAttempt) || numericAttempt <= 0) {
    return 0;
  }

  return Math.floor(numericAttempt);
}

function mapInternalLifecyclePhase(source, phase, { active = false, error = '' } = {}) {
  if (SUPPORTED_PHASES.has(phase)) {
    return phase;
  }

  const mappedPhase = INTERNAL_PHASE_MAP[normalizeSource(source)]?.[phase];
  if (mappedPhase) {
    return mappedPhase;
  }

  if (typeof error === 'string' && error) {
    return 'error';
  }

  return active ? 'active' : 'inactive';
}

function normalizeTranscriptSourceLifecycle(state = {}, {
  source = 'live-captions',
  sessionId = ''
} = {}) {
  const normalizedSource = normalizeSource(state.source, source);
  const error = typeof state.error === 'string' ? state.error : '';
  const phase = mapInternalLifecyclePhase(normalizedSource, state.phase, {
    active: Boolean(state.active),
    error
  });

  return {
    source: normalizedSource,
    phase,
    active: phase === 'active',
    sessionId: normalizeSessionId(state.sessionId, sessionId),
    retryAttempt: normalizeRetryAttempt(state.retryAttempt),
    reason: typeof state.reason === 'string' ? state.reason : '',
    error
  };
}

module.exports = {
  TRANSCRIPT_SOURCES,
  TRANSCRIPT_SOURCE_LIFECYCLE_PHASES,
  mapInternalLifecyclePhase,
  normalizeTranscriptSourceLifecycle
};
