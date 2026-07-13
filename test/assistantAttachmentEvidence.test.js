const test = require('node:test');
const assert = require('node:assert/strict');

const {
  attachmentStateShowsNewImage,
  waitForAssistantImageAttachmentEvidence
} = require('../src/assistantAttachmentEvidence');

test('attachment evidence requires a new file, preview, or attachment indicator', () => {
  const previous = {
    markedFileCount: 0,
    fileCount: 1,
    previewCount: 1,
    attachmentIndicatorCount: 2
  };

  assert.equal(attachmentStateShowsNewImage(previous, { ...previous }), false);
  assert.equal(attachmentStateShowsNewImage(previous, {
    ...previous,
    previewCount: 2
  }), true);
  assert.equal(attachmentStateShowsNewImage(previous, {
    ...previous,
    markedFileCount: 1
  }), true);
});

test('an upload that never produces attachment evidence fails closed', async () => {
  let reads = 0;
  const result = await waitForAssistantImageAttachmentEvidence({
    previousState: { fileCount: 0, previewCount: 0, attachmentIndicatorCount: 0 },
    getCurrentState: async () => {
      reads += 1;
      return { fileCount: 0, previewCount: 0, attachmentIndicatorCount: 0 };
    },
    sleep: async () => {},
    attempts: 3,
    delayMs: 0
  });

  assert.equal(result, false);
  assert.equal(reads, 3);
});

test('attachment evidence succeeds only after a later observed change', async () => {
  const states = [
    { fileCount: 0, previewCount: 0, attachmentIndicatorCount: 0 },
    { fileCount: 0, previewCount: 1, attachmentIndicatorCount: 1 }
  ];

  const result = await waitForAssistantImageAttachmentEvidence({
    previousState: states[0],
    getCurrentState: async () => states.shift(),
    sleep: async () => {},
    attempts: 2,
    delayMs: 0
  });

  assert.equal(result, true);
});
