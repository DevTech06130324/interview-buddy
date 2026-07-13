const test = require('node:test');
const assert = require('node:assert/strict');

const {
  ASSISTANT_SUBMISSION_OUTCOME,
  isAssistantSubmissionOutcome,
  canTryAnotherAssistantSubmissionStrategy,
  runAssistantSubmissionStrategies,
  shouldAdvanceAssistantTranscriptCursor,
  needsAssistantSubmissionRetry
} = require('../src/assistantSubmissionOutcome');

test('only the three explicit assistant submission outcomes are valid', () => {
  assert.equal(isAssistantSubmissionOutcome(ASSISTANT_SUBMISSION_OUTCOME.NOT_DISPATCHED), true);
  assert.equal(isAssistantSubmissionOutcome(ASSISTANT_SUBMISSION_OUTCOME.CONFIRMED_SENT), true);
  assert.equal(isAssistantSubmissionOutcome(ASSISTANT_SUBMISSION_OUTCOME.UNKNOWN_AFTER_DISPATCH), true);
  assert.equal(isAssistantSubmissionOutcome('sent'), false);
  assert.equal(isAssistantSubmissionOutcome(null), false);
});

test('only a not-dispatched strategy may fall through to another submission strategy', () => {
  assert.equal(
    canTryAnotherAssistantSubmissionStrategy(ASSISTANT_SUBMISSION_OUTCOME.NOT_DISPATCHED),
    true
  );
  assert.equal(
    canTryAnotherAssistantSubmissionStrategy(ASSISTANT_SUBMISSION_OUTCOME.CONFIRMED_SENT),
    false
  );
  assert.equal(
    canTryAnotherAssistantSubmissionStrategy(ASSISTANT_SUBMISSION_OUTCOME.UNKNOWN_AFTER_DISPATCH),
    false
  );
});

test('only a confirmed submission advances the transcript cursor', () => {
  assert.equal(
    shouldAdvanceAssistantTranscriptCursor(ASSISTANT_SUBMISSION_OUTCOME.NOT_DISPATCHED),
    false
  );
  assert.equal(
    shouldAdvanceAssistantTranscriptCursor(ASSISTANT_SUBMISSION_OUTCOME.CONFIRMED_SENT),
    true
  );
  assert.equal(
    shouldAdvanceAssistantTranscriptCursor(ASSISTANT_SUBMISSION_OUTCOME.UNKNOWN_AFTER_DISPATCH),
    false
  );
});

test('an unknown-after-dispatch result requests an explicit retry state', () => {
  assert.equal(needsAssistantSubmissionRetry(ASSISTANT_SUBMISSION_OUTCOME.NOT_DISPATCHED), false);
  assert.equal(needsAssistantSubmissionRetry(ASSISTANT_SUBMISSION_OUTCOME.CONFIRMED_SENT), false);
  assert.equal(needsAssistantSubmissionRetry(ASSISTANT_SUBMISSION_OUTCOME.UNKNOWN_AFTER_DISPATCH), true);
});

test('an uncertain dispatched strategy stops the fallback chain immediately', async () => {
  const calls = [];

  const outcome = await runAssistantSubmissionStrategies([
    async () => {
      calls.push('form');
      return ASSISTANT_SUBMISSION_OUTCOME.UNKNOWN_AFTER_DISPATCH;
    },
    async () => {
      calls.push('click');
      return ASSISTANT_SUBMISSION_OUTCOME.CONFIRMED_SENT;
    }
  ]);

  assert.equal(outcome, ASSISTANT_SUBMISSION_OUTCOME.UNKNOWN_AFTER_DISPATCH);
  assert.deepEqual(calls, ['form']);
});

test('only a provably non-dispatched strategy permits the next fallback', async () => {
  const calls = [];

  const outcome = await runAssistantSubmissionStrategies([
    async () => {
      calls.push('form');
      return ASSISTANT_SUBMISSION_OUTCOME.NOT_DISPATCHED;
    },
    async () => {
      calls.push('click');
      return ASSISTANT_SUBMISSION_OUTCOME.CONFIRMED_SENT;
    }
  ]);

  assert.equal(outcome, ASSISTANT_SUBMISSION_OUTCOME.CONFIRMED_SENT);
  assert.deepEqual(calls, ['form', 'click']);
});
