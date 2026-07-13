const test = require('node:test');
const assert = require('node:assert/strict');

const {
  TRANSCRIPT_ERROR_SOURCES,
  normalizeTranscriptError
} = require('../src/transcriptError');

test('normalizes structured transcript errors without losing source, code, or recoverability', () => {
  const result = normalizeTranscriptError({
    source: 'deepgram',
    code: 'SOCKET_RETRYING',
    message: 'Reconnecting audio stream.',
    recoverable: true
  });

  assert.deepEqual(result, {
    source: 'deepgram',
    code: 'SOCKET_RETRYING',
    message: 'Reconnecting audio stream.',
    recoverable: true
  });
});

test('normalizes legacy strings for the renderer migration path', () => {
  assert.deepEqual(
    normalizeTranscriptError('Legacy Live Captions error', {
      source: 'live-captions',
      code: 'LIVECAPTIONS_LEGACY_ERROR',
      recoverable: true
    }),
    {
      source: 'live-captions',
      code: 'LIVECAPTIONS_LEGACY_ERROR',
      message: 'Legacy Live Captions error',
      recoverable: true
    }
  );
});

test('untrusted structured values fail closed to the supplied safe defaults', () => {
  const result = normalizeTranscriptError({
    source: 'other',
    code: '',
    message: '',
    recoverable: 'yes'
  }, {
    source: 'live-captions',
    code: 'LIVECAPTIONS_UNKNOWN_ERROR',
    recoverable: false
  });

  assert.deepEqual(result, {
    source: 'live-captions',
    code: 'LIVECAPTIONS_UNKNOWN_ERROR',
    message: 'Transcript source error.',
    recoverable: false
  });
});

test('only supported transcript error sources are exposed to the renderer', () => {
  assert.deepEqual(TRANSCRIPT_ERROR_SOURCES, ['live-captions', 'deepgram']);
});
