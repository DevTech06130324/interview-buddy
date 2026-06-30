const test = require('node:test');
const assert = require('node:assert/strict');

const {
  TRANSCRIPT_PROMPT_HEADER,
  buildTranscriptPromptText,
  formatTranscriptElapsedTimestamp,
  formatTranscriptEntryMarker
} = require('../src/transcriptPrompt');

test('formats transcript timestamps as elapsed HH:MM:SS values', () => {
  assert.equal(formatTranscriptElapsedTimestamp(0), '00:00:00');
  assert.equal(formatTranscriptElapsedTimestamp(754000), '00:12:34');
  assert.equal(formatTranscriptElapsedTimestamp(3723000), '01:02:03');
});

test('formats transcript entry marker with timestamp only by default', () => {
  assert.equal(
    formatTranscriptEntryMarker({ timestampLabel: '00:12:34', speakerTag: 'Them' }),
    '[00:12:34]'
  );
});

test('formats the first transcript entry marker with the speaker tag', () => {
  assert.equal(
    formatTranscriptEntryMarker(
      { timestampLabel: '00:12:34', speakerTag: 'Them' },
      { includeSpeaker: true }
    ),
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
    '[00:13:02] What tradeoffs did you make?',
    '"""',
    '',
    'What should I say?'
  ].join('\n'));
});

test('builds conversation prompt with speaker tags at speaker turn boundaries', () => {
  const text = buildTranscriptPromptText({
    promptText: 'What should I say?',
    transcriptEntries: [
      { sourceText: 'Can you walk me through your last project?', timestampLabel: '00:12:34', speakerTag: 'Them' },
      { sourceText: 'What tradeoffs did you make?', timestampLabel: '00:13:02', speakerTag: 'Them' },
      { sourceText: 'I focused on latency first.', timestampLabel: '00:13:15', speakerTag: 'Me' },
      { sourceText: 'Then I cleaned up reliability.', timestampLabel: '00:13:26', speakerTag: 'Me' },
      { sourceText: 'What was the result?', timestampLabel: '00:13:40', speakerTag: 'Them' }
    ]
  });

  assert.equal(text, [
    'Conversations so far like this',
    '"""',
    '[00:12:34 | Them] Can you walk me through your last project?',
    '[00:13:02] What tradeoffs did you make?',
    '[00:13:15 | Me] I focused on latency first.',
    '[00:13:26] Then I cleaned up reliability.',
    '[00:13:40 | Them] What was the result?',
    '"""',
    '',
    'What should I say?'
  ].join('\n'));
});

test('builds prompt text when there is no transcript', () => {
  assert.equal(buildTranscriptPromptText({ promptText: 'What should I say?' }), 'What should I say?');
});
