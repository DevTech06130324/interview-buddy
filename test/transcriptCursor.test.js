const test = require('node:test');
const assert = require('node:assert/strict');

const {
  resolvePendingTranscriptCursor
} = require('../src/transcriptCursor');

const CURSOR_MISMATCH = {
  status: 'mismatch',
  reason: 'unverified-boundary',
  pendingText: '',
  pendingEntries: []
};

test('cursor preserves speaker metadata when an exact raw boundary ends mid-entry', () => {
  const currentEntry = {
    id: 'deepgram-session-me-0',
    sourceText: 'I started answering and this is the new part.',
    speakerTag: 'Me',
    isFinal: false
  };

  assert.deepEqual(resolvePendingTranscriptCursor({
    transcriptText: currentEntry.sourceText,
    transcriptEntries: [currentEntry],
    cursorText: 'I started answering',
    cursorEntries: []
  }), {
    status: 'matched',
    pendingText: 'and this is the new part.',
    pendingEntries: [{
      ...currentEntry,
      sourceText: 'and this is the new part.'
    }]
  });
});

test('cursor returns all in-progress entries when no prior cursor exists', () => {
  const partialEntry = {
    id: 'deepgram-session-them-partial-0',
    sourceText: 'The interview question is still being spoken',
    speakerTag: 'Them',
    isFinal: false
  };

  assert.deepEqual(resolvePendingTranscriptCursor({
    transcriptText: partialEntry.sourceText,
    transcriptEntries: [partialEntry],
    cursorText: '',
    cursorEntries: []
  }), {
    status: 'matched',
    pendingText: partialEntry.sourceText,
    pendingEntries: [partialEntry]
  });
});

test('cursor fails closed when punctuation removal changes the raw boundary length', () => {
  assert.deepEqual(resolvePendingTranscriptCursor({
    transcriptText: 'Please explain, the tradeoff and continue.',
    transcriptEntries: [{
      id: 'caption-0',
      sourceText: 'Please explain, the tradeoff and continue.',
      speakerTag: 'Them'
    }],
    cursorText: 'Please explain the tradeoff',
    cursorEntries: []
  }), CURSOR_MISMATCH);
});

test('cursor fails closed for unrelated current and cursor text', () => {
  assert.deepEqual(resolvePendingTranscriptCursor({
    transcriptText: 'Completely unrelated current transcript that happens to be longer.',
    transcriptEntries: [],
    cursorText: 'Previously submitted words.',
    cursorEntries: []
  }), CURSOR_MISMATCH);
});

test('cursor fails closed when an exact cursor string has unverified leading text', () => {
  assert.deepEqual(resolvePendingTranscriptCursor({
    transcriptText: 'New unsent text before.\nPreviously submitted snapshot.\nNew unsent text after.',
    transcriptEntries: [],
    cursorText: 'Previously submitted snapshot.',
    cursorEntries: []
  }), CURSOR_MISMATCH);
});

test('cursor fails closed when an entry ID is reused with changed non-prefix content', () => {
  assert.deepEqual(resolvePendingTranscriptCursor({
    transcriptText: 'Replacement content from a different utterance.',
    transcriptEntries: [{
      id: 'deepgram-session-them-0',
      sourceText: 'Replacement content from a different utterance.',
      speakerTag: 'Them'
    }],
    cursorText: 'Original submitted utterance.',
    cursorEntries: [{
      id: 'deepgram-session-them-0',
      sourceText: 'Original submitted utterance.',
      speakerTag: 'Them'
    }]
  }), CURSOR_MISMATCH);
});

test('cursor does not resend from an earlier identity when the latest cursor entry is missing', () => {
  assert.deepEqual(resolvePendingTranscriptCursor({
    transcriptText: 'Already submitted first entry.\nUnrelated replacement entry.',
    transcriptEntries: [{
      id: 'deepgram-session-them-0',
      sourceText: 'Already submitted first entry.',
      speakerTag: 'Them'
    }, {
      id: 'deepgram-session-them-2',
      sourceText: 'Unrelated replacement entry.',
      speakerTag: 'Them'
    }],
    cursorText: 'Already submitted first entry.\nAlready submitted second entry.',
    cursorEntries: [{
      id: 'deepgram-session-them-0',
      sourceText: 'Already submitted first entry.',
      speakerTag: 'Them'
    }, {
      id: 'deepgram-session-them-1',
      sourceText: 'Already submitted second entry.',
      speakerTag: 'Them'
    }]
  }), CURSOR_MISMATCH);
});

test('cursor fails closed when unverified entries appear before the latest cursor identity', () => {
  assert.deepEqual(resolvePendingTranscriptCursor({
    transcriptText: 'New unsent leading entry.\nSubmitted boundary.\nNew trailing entry.',
    transcriptEntries: [{
      id: 'deepgram-session-me-99',
      sourceText: 'New unsent leading entry.',
      speakerTag: 'Me'
    }, {
      id: 'deepgram-session-them-0',
      sourceText: 'Submitted boundary.',
      speakerTag: 'Them'
    }, {
      id: 'deepgram-session-them-1',
      sourceText: 'New trailing entry.',
      speakerTag: 'Them'
    }],
    cursorText: 'Submitted boundary.',
    cursorEntries: [{
      id: 'deepgram-session-them-0',
      sourceText: 'Submitted boundary.',
      speakerTag: 'Them'
    }]
  }), CURSOR_MISMATCH);
});

test('cursor accepts an exact same-ID content extension', () => {
  const currentEntry = {
    id: 'deepgram-session-me-partial-0',
    sourceText: 'An exact partial grows with new words.',
    speakerTag: 'Me',
    isFinal: false
  };

  assert.deepEqual(resolvePendingTranscriptCursor({
    transcriptText: currentEntry.sourceText,
    transcriptEntries: [currentEntry],
    cursorText: 'An exact partial grows',
    cursorEntries: [{
      ...currentEntry,
      sourceText: 'An exact partial grows'
    }]
  }), {
    status: 'matched',
    pendingText: 'with new words.',
    pendingEntries: [{
      ...currentEntry,
      sourceText: 'with new words.'
    }]
  });
});

test('cursor accepts a same-entry Live Captions revision that drops terminal punctuation while extending', () => {
  const currentEntry = {
    id: 'caption-0-0',
    sourceText: 'While you were joining which language do you want to use?',
    speakerTag: 'Them',
    isFinal: true
  };

  assert.deepEqual(resolvePendingTranscriptCursor({
    transcriptText: currentEntry.sourceText,
    transcriptEntries: [currentEntry],
    cursorText: 'While you were joining.',
    cursorEntries: [{
      ...currentEntry,
      sourceText: 'While you were joining.'
    }]
  }), {
    status: 'matched',
    pendingText: 'which language do you want to use?',
    pendingEntries: [{
      ...currentEntry,
      sourceText: 'which language do you want to use?'
    }]
  });
});

test('cursor rejects same-entry punctuation fallback inside a word', () => {
  assert.deepEqual(resolvePendingTranscriptCursor({
    transcriptText: 'High confidence answer continues.',
    transcriptEntries: [{
      id: 'caption-0-0',
      sourceText: 'High confidence answer continues.',
      speakerTag: 'Them'
    }],
    cursorText: 'Hi.',
    cursorEntries: [{
      id: 'caption-0-0',
      sourceText: 'Hi.',
      speakerTag: 'Them'
    }]
  }), CURSOR_MISMATCH);
});

test('cursor accepts a latest entry extension after a fully verified entry sequence', () => {
  const firstEntry = {
    id: 'deepgram-session-them-0',
    sourceText: 'Verified first entry.',
    speakerTag: 'Them'
  };
  const extendedEntry = {
    id: 'deepgram-session-me-partial-0',
    sourceText: 'Verified partial boundary with new words.',
    speakerTag: 'Me',
    isFinal: false
  };
  const trailingEntry = {
    id: 'deepgram-session-them-1',
    sourceText: 'New trailing entry.',
    speakerTag: 'Them'
  };

  assert.deepEqual(resolvePendingTranscriptCursor({
    transcriptText: [firstEntry.sourceText, extendedEntry.sourceText, trailingEntry.sourceText].join('\n'),
    transcriptEntries: [firstEntry, extendedEntry, trailingEntry],
    cursorText: `${firstEntry.sourceText}\nVerified partial boundary`,
    cursorEntries: [firstEntry, {
      ...extendedEntry,
      sourceText: 'Verified partial boundary'
    }]
  }), {
    status: 'matched',
    pendingText: 'with new words.\nNew trailing entry.',
    pendingEntries: [{
      ...extendedEntry,
      sourceText: 'with new words.'
    }, trailingEntry]
  });
});

test('cursor preserves an exact raw suffix-to-prefix overlap boundary', () => {
  const currentEntry = {
    id: 'caption-0',
    sourceText: 'ending with a precise shared boundary.\nFresh sentence.',
    speakerTag: 'Them'
  };

  assert.deepEqual(resolvePendingTranscriptCursor({
    transcriptText: currentEntry.sourceText,
    transcriptEntries: [currentEntry],
    cursorText: 'Earlier transcript ending with a precise shared boundary.',
    cursorEntries: []
  }), {
    status: 'matched',
    pendingText: 'Fresh sentence.',
    pendingEntries: [{
      ...currentEntry,
      sourceText: 'Fresh sentence.'
    }]
  });
});
