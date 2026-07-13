const TRANSCRIPT_ERROR_SOURCES = Object.freeze([
  'live-captions',
  'deepgram'
]);

const SUPPORTED_SOURCES = new Set(TRANSCRIPT_ERROR_SOURCES);

function normalizeTranscriptError(error, {
  source = 'live-captions',
  code = 'TRANSCRIPT_ERROR',
  recoverable = true
} = {}) {
  const fallbackSource = SUPPORTED_SOURCES.has(source) ? source : 'live-captions';
  const fallbackCode = typeof code === 'string' && code ? code : 'TRANSCRIPT_ERROR';
  const fallbackRecoverable = Boolean(recoverable);

  if (error && typeof error === 'object' && !Array.isArray(error)) {
    return {
      source: SUPPORTED_SOURCES.has(error.source) ? error.source : fallbackSource,
      code: typeof error.code === 'string' && error.code ? error.code : fallbackCode,
      message: typeof error.message === 'string' && error.message
        ? error.message
        : 'Transcript source error.',
      recoverable: typeof error.recoverable === 'boolean'
        ? error.recoverable
        : fallbackRecoverable
    };
  }

  return {
    source: fallbackSource,
    code: fallbackCode,
    message: typeof error === 'string' && error
      ? error
      : (error?.message || 'Transcript source error.'),
    recoverable: fallbackRecoverable
  };
}

module.exports = {
  TRANSCRIPT_ERROR_SOURCES,
  normalizeTranscriptError
};
