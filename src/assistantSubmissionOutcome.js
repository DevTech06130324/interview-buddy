const ASSISTANT_SUBMISSION_OUTCOME = Object.freeze({
  NOT_DISPATCHED: 'not-dispatched',
  CONFIRMED_SENT: 'confirmed-sent',
  UNKNOWN_AFTER_DISPATCH: 'unknown-after-dispatch'
});

const KNOWN_OUTCOMES = new Set(Object.values(ASSISTANT_SUBMISSION_OUTCOME));

function isAssistantSubmissionOutcome(value) {
  return KNOWN_OUTCOMES.has(value);
}

function canTryAnotherAssistantSubmissionStrategy(outcome) {
  return outcome === ASSISTANT_SUBMISSION_OUTCOME.NOT_DISPATCHED;
}

function shouldAdvanceAssistantTranscriptCursor(outcome) {
  return outcome === ASSISTANT_SUBMISSION_OUTCOME.CONFIRMED_SENT;
}

function needsAssistantSubmissionRetry(outcome) {
  return outcome === ASSISTANT_SUBMISSION_OUTCOME.UNKNOWN_AFTER_DISPATCH;
}

async function runAssistantSubmissionStrategies(strategies) {
  if (!Array.isArray(strategies)) {
    throw new TypeError('Assistant submission strategies must be an array.');
  }

  for (const strategy of strategies) {
    if (typeof strategy !== 'function') {
      return ASSISTANT_SUBMISSION_OUTCOME.UNKNOWN_AFTER_DISPATCH;
    }

    let outcome;
    try {
      outcome = await strategy();
    } catch (_) {
      // A strategy may throw after it has triggered page-side submission. Do
      // not guess that a fallback is safe in that case.
      return ASSISTANT_SUBMISSION_OUTCOME.UNKNOWN_AFTER_DISPATCH;
    }

    if (!isAssistantSubmissionOutcome(outcome)) {
      return ASSISTANT_SUBMISSION_OUTCOME.UNKNOWN_AFTER_DISPATCH;
    }

    if (!canTryAnotherAssistantSubmissionStrategy(outcome)) {
      return outcome;
    }
  }

  return ASSISTANT_SUBMISSION_OUTCOME.NOT_DISPATCHED;
}

module.exports = {
  ASSISTANT_SUBMISSION_OUTCOME,
  isAssistantSubmissionOutcome,
  canTryAnotherAssistantSubmissionStrategy,
  runAssistantSubmissionStrategies,
  shouldAdvanceAssistantTranscriptCursor,
  needsAssistantSubmissionRetry
};
