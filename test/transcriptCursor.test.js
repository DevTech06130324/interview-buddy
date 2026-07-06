const test = require('node:test');
const assert = require('node:assert/strict');

const {
  getPendingTranscriptEntriesForCursor,
  getPendingTranscriptTextForCursor
} = require('../src/transcriptCursor');

test('pending cursor keeps speaker metadata when the pending text starts mid-turn', () => {
  const currentEntry = {
    id: 'deepgram-me-final',
    sourceText: 'I started answering and this is the new part.',
    speakerTag: 'Me',
    isFinal: false
  };
  const cursor = {
    transcriptText: currentEntry.sourceText,
    transcriptEntries: [currentEntry],
    cursorText: 'I started answering',
    cursorEntries: []
  };

  assert.equal(
    getPendingTranscriptTextForCursor(cursor),
    'and this is the new part.'
  );
  assert.deepEqual(
    getPendingTranscriptEntriesForCursor(cursor),
    [{
      ...currentEntry,
      sourceText: 'and this is the new part.'
    }]
  );
});

test('pending cursor keeps in-progress partial transcript entries', () => {
  const partialEntry = {
    id: 'deepgram-them-partial-0',
    sourceText: 'The interview question is still being spoken',
    speakerTag: 'Them',
    isFinal: false
  };

  assert.deepEqual(
    getPendingTranscriptEntriesForCursor({
      transcriptText: partialEntry.sourceText,
      transcriptEntries: [partialEntry],
      cursorText: '',
      cursorEntries: []
    }),
    [partialEntry]
  );
});
