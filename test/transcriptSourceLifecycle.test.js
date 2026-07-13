const test = require('node:test');
const assert = require('node:assert/strict');

const {
  TRANSCRIPT_SOURCES,
  TRANSCRIPT_SOURCE_LIFECYCLE_PHASES,
  mapInternalLifecyclePhase,
  normalizeTranscriptSourceLifecycle
} = require('../src/transcriptSourceLifecycle');

test('exposes only the supported source and lifecycle contracts', () => {
  assert.deepEqual(TRANSCRIPT_SOURCES, ['live-captions', 'deepgram']);
  assert.deepEqual(TRANSCRIPT_SOURCE_LIFECYCLE_PHASES, [
    'inactive',
    'connecting',
    'active',
    'reconnecting',
    'stopping',
    'error'
  ]);
});

test('maps implementation-specific Deepgram phases to the public lifecycle', () => {
  assert.equal(mapInternalLifecyclePhase('deepgram', 'awaiting-renderer'), 'connecting');
  assert.equal(mapInternalLifecyclePhase('deepgram', 'connecting'), 'connecting');
  assert.equal(mapInternalLifecyclePhase('deepgram', 'reconnecting'), 'reconnecting');
  assert.equal(mapInternalLifecyclePhase('deepgram', 'stopping'), 'stopping');
});

test('maps implementation-specific Live Captions phases to the public lifecycle', () => {
  assert.equal(mapInternalLifecyclePhase('live-captions', 'starting'), 'connecting');
  assert.equal(mapInternalLifecyclePhase('live-captions', 'restarting'), 'reconnecting');
  assert.equal(mapInternalLifecyclePhase('live-captions', 'closing'), 'stopping');
});

test('normalizes lifecycle payloads with session identity and retry attempt', () => {
  assert.deepEqual(
    normalizeTranscriptSourceLifecycle({
      source: 'deepgram',
      phase: 'awaiting-renderer',
      sessionId: 'deepgram-session-1',
      retryAttempt: 1.9,
      reason: 'capture-required'
    }),
    {
      source: 'deepgram',
      phase: 'connecting',
      active: false,
      sessionId: 'deepgram-session-1',
      retryAttempt: 1,
      reason: 'capture-required',
      error: ''
    }
  );
});

test('fails closed to valid lifecycle values for malformed input', () => {
  assert.deepEqual(
    normalizeTranscriptSourceLifecycle({
      source: 'untrusted',
      phase: 'not-a-phase',
      active: false,
      retryAttempt: -3,
      reason: null,
      error: null
    }, {
      source: 'live-captions',
      sessionId: 'fallback-session'
    }),
    {
      source: 'live-captions',
      phase: 'inactive',
      active: false,
      sessionId: 'fallback-session',
      retryAttempt: 0,
      reason: '',
      error: ''
    }
  );
});
