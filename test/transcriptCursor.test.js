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

test('cursor can accept a disjoint Live Captions rolling-window snapshot when explicitly allowed', () => {
  const currentEntry = {
    id: 'caption-1-1',
    sourceText: 'We have like Python.',
    speakerTag: 'Them',
    isFinal: true
  };

  assert.deepEqual(resolvePendingTranscriptCursor({
    transcriptText: currentEntry.sourceText,
    transcriptEntries: [currentEntry],
    cursorText: 'While you were joining which language do you want to use?',
    cursorEntries: [{
      id: 'caption-1-0',
      sourceText: 'While you were joining which language do you want to use?',
      speakerTag: 'Them',
      isFinal: true
    }],
    allowDisjointCurrentTranscript: true
  }), {
    status: 'matched',
    pendingText: currentEntry.sourceText,
    pendingEntries: [currentEntry]
  });
});

test('cursor does not resend a Live Captions rolling-window suffix that is already submitted', () => {
  const currentEntry = {
    id: 'caption-1-0',
    sourceText: 'which language do you want to use?',
    speakerTag: 'Them',
    isFinal: true
  };

  assert.deepEqual(resolvePendingTranscriptCursor({
    transcriptText: currentEntry.sourceText,
    transcriptEntries: [currentEntry],
    cursorText: 'While you were joining which language do you want to use?',
    cursorEntries: [{
      id: 'caption-1-0',
      sourceText: 'While you were joining which language do you want to use?',
      speakerTag: 'Them',
      isFinal: true
    }],
    allowDisjointCurrentTranscript: true
  }), {
    status: 'matched',
    pendingText: '',
    pendingEntries: []
  });
});

test('cursor skips the submitted prefix of a partially overlapping Live Captions rolling window', () => {
  const currentEntry = {
    id: 'caption-0-0',
    sourceText: 'a difficult project you completed. What did you learn from it?',
    speakerTag: 'Them',
    isFinal: true
  };

  assert.deepEqual(resolvePendingTranscriptCursor({
    transcriptText: currentEntry.sourceText,
    transcriptEntries: [currentEntry],
    cursorText: 'Tell me about a difficult project you completed.',
    cursorEntries: [{
      id: 'caption-0-0',
      sourceText: 'Tell me about a difficult project you completed.',
      speakerTag: 'Them',
      isFinal: true
    }],
    allowDisjointCurrentTranscript: true
  }), {
    status: 'matched',
    pendingText: 'What did you learn from it?',
    pendingEntries: [{
      ...currentEntry,
      sourceText: 'What did you learn from it?'
    }]
  });
});

test('cursor skips a Live Captions prefix that was revised with punctuation after submission', () => {
  const currentEntry = {
    id: 'caption-0-0',
    sourceText: "Just run Claude with resume and you can pick up exactly where you left off in any of your conversations. Right now I want to run the this video will teach you client code. I'll go over everything and assume no prior knowledge. I'll walk you through the setup and installation step by step. I'll show you how to utilize the tool, the best practices, multiple features, and by the end of the video you'll be comfortable using this tool to generate some pretty insane outputs and awesome coding projects.",
    speakerTag: 'Them',
    isFinal: true
  };

  assert.deepEqual(resolvePendingTranscriptCursor({
    transcriptText: currentEntry.sourceText,
    transcriptEntries: [currentEntry],
    cursorText: "Just run Claude with resume and you can pick up exactly where you left off in any of your conversations. Right now I want to run the this video will teach you client code. I'll go over everything and assume no prior knowledge. I'll walk you through the setup and installation step by step. I'll show you how to utilize the tool the best practices multiple",
    cursorEntries: [{
      ...currentEntry,
      sourceText: "Just run Claude with resume and you can pick up exactly where you left off in any of your conversations. Right now I want to run the this video will teach you client code. I'll go over everything and assume no prior knowledge. I'll walk you through the setup and installation step by step. I'll show you how to utilize the tool the best practices multiple"
    }],
    allowDisjointCurrentTranscript: true
  }), {
    status: 'matched',
    pendingText: "features, and by the end of the video you'll be comfortable using this tool to generate some pretty insane outputs and awesome coding projects.",
    pendingEntries: [{
      ...currentEntry,
      sourceText: "features, and by the end of the video you'll be comfortable using this tool to generate some pretty insane outputs and awesome coding projects."
    }]
  });
});

test('cursor skips a Live Captions prefix that was revised with a word correction after submission', () => {
  const currentEntry = {
    id: 'caption-0-0',
    sourceText: 'This video will teach you Claude code and setup the tool, best practices, multiple features are next.',
    speakerTag: 'Them',
    isFinal: true
  };

  assert.deepEqual(resolvePendingTranscriptCursor({
    transcriptText: currentEntry.sourceText,
    transcriptEntries: [currentEntry],
    cursorText: 'This video will teach you client code and setup the tool best practices multiple',
    cursorEntries: [{
      ...currentEntry,
      sourceText: 'This video will teach you client code and setup the tool best practices multiple'
    }],
    allowDisjointCurrentTranscript: true
  }), {
    status: 'matched',
    pendingText: 'features are next.',
    pendingEntries: [{
      ...currentEntry,
      sourceText: 'features are next.'
    }]
  });
});

test('cursor skips a Live Captions prefix when the final submitted word was corrected', () => {
  const currentEntry = {
    id: 'caption-0-0',
    sourceText: 'one two three four five six Claude genuinely new words',
    speakerTag: 'Them',
    isFinal: true
  };

  assert.deepEqual(resolvePendingTranscriptCursor({
    transcriptText: currentEntry.sourceText,
    transcriptEntries: [currentEntry],
    cursorText: 'one two three four five six client',
    cursorEntries: [{
      ...currentEntry,
      sourceText: 'one two three four five six client'
    }],
    allowDisjointCurrentTranscript: true
  }), {
    status: 'matched',
    pendingText: 'genuinely new words',
    pendingEntries: [{
      ...currentEntry,
      sourceText: 'genuinely new words'
    }]
  });
});

test('cursor does not trim a revised Live Captions boundary with too many word changes', () => {
  const currentEntry = {
    id: 'caption-0-0',
    sourceText: 'one two maybe four five seven Claude genuinely new words',
    speakerTag: 'Them',
    isFinal: true
  };

  assert.deepEqual(resolvePendingTranscriptCursor({
    transcriptText: currentEntry.sourceText,
    transcriptEntries: [currentEntry],
    cursorText: 'one two three four five six client',
    cursorEntries: [{
      ...currentEntry,
      sourceText: 'one two three four five six client'
    }],
    allowDisjointCurrentTranscript: true
  }), {
    status: 'matched',
    pendingText: currentEntry.sourceText,
    pendingEntries: [currentEntry]
  });
});

test('cursor rejects a changed-entry overlap when disjoint Live Captions recovery is not allowed', () => {
  const currentEntry = {
    id: 'caption-0-0',
    sourceText: 'a difficult project you completed. What did you learn from it?',
    speakerTag: 'Them',
    isFinal: true
  };

  assert.deepEqual(resolvePendingTranscriptCursor({
    transcriptText: currentEntry.sourceText,
    transcriptEntries: [currentEntry],
    cursorText: 'Tell me about a difficult project you completed.',
    cursorEntries: [{
      id: 'caption-0-0',
      sourceText: 'Tell me about a difficult project you completed.',
      speakerTag: 'Them',
      isFinal: true
    }]
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
