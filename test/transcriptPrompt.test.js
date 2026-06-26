const test = require('node:test');
const assert = require('node:assert/strict');

const {
  TRANSCRIPT_PROMPT_HEADER,
  TRANSCRIPT_SPEAKER_TAG,
  buildTranscriptPromptText,
  formatTranscriptElapsedTimestamp,
  formatTranscriptEntryMarker
} = require('../src/transcriptPrompt');

test('formats transcript timestamps as elapsed HH:MM:SS values', () => {
  assert.equal(formatTranscriptElapsedTimestamp(0), '00:00:00');
  assert.equal(formatTranscriptElapsedTimestamp(754000), '00:12:34');
  assert.equal(formatTranscriptElapsedTimestamp(3723000), '01:02:03');
});

test('formats transcript entry marker with timestamp and Them tag', () => {
  assert.equal(TRANSCRIPT_SPEAKER_TAG, 'Them');
  assert.equal(
    formatTranscriptEntryMarker({ timestampLabel: '00:12:34', speakerTag: 'Them' }),
    '[00:12:34 | Them]'
  );
});

test('builds conversation prompt with bracketed metadata and prompt suffix', () => {
  const text = buildTranscriptPromptText({
    promptText: 'What should I say?',
    transcriptEntries: [
      { sourceText: 'Can you walk me through your last project?', timestampLabel: '00:12:34', speakerTag: 'Them' },
      { sourceText: 'What tradeoffs did you make?', timestampLabel: '00:13:02', speakerTag: 'Them' }
    ]
  });

  assert.equal(TRANSCRIPT_PROMPT_HEADER, 'Conversations so far like this');
  assert.equal(text, [
    'Conversations so far like this',
    '"""',
    '[00:12:34 | Them] Can you walk me through your last project?',
    '[00:13:02 | Them] What tradeoffs did you make?',
    '"""',
    '',
    'What should I say?'
  ].join('\n'));
});

test('builds prompt text when there is no transcript', () => {
  assert.equal(buildTranscriptPromptText({ promptText: 'What should I say?' }), 'What should I say?');
});
