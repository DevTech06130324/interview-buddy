function attachmentStateShowsNewImage(previousState, nextState) {
  if (!nextState) {
    return false;
  }

  if ((nextState.markedFileCount || 0) > 0) {
    return true;
  }

  if (!previousState) {
    return (nextState.fileCount || 0) > 0 || (nextState.previewCount || 0) > 0;
  }

  return (nextState.fileCount || 0) > (previousState.fileCount || 0)
    || (nextState.previewCount || 0) > (previousState.previewCount || 0)
    || (nextState.attachmentIndicatorCount || 0) > (previousState.attachmentIndicatorCount || 0);
}

async function waitForAssistantImageAttachmentEvidence({
  previousState,
  getCurrentState,
  sleep,
  attempts = 20,
  delayMs = 150
} = {}) {
  if (typeof getCurrentState !== 'function') {
    throw new TypeError('Attachment evidence requires getCurrentState().');
  }
  if (typeof sleep !== 'function') {
    throw new TypeError('Attachment evidence requires sleep().');
  }

  const normalizedAttempts = Math.max(0, Math.floor(Number(attempts) || 0));
  for (let attempt = 0; attempt < normalizedAttempts; attempt += 1) {
    const currentState = await getCurrentState();
    if (attachmentStateShowsNewImage(previousState, currentState)) {
      return true;
    }

    if (attempt + 1 < normalizedAttempts) {
      await sleep(delayMs);
    }
  }

  return false;
}

module.exports = {
  attachmentStateShowsNewImage,
  waitForAssistantImageAttachmentEvidence
};
