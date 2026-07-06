const test = require('node:test');
const assert = require('node:assert/strict');

const {
  TRANSCRIPT_PROMPT_HEADER,
  buildTranscriptPromptText,
  formatTranscriptEntryMarker
} = require('../src/transcriptPrompt');

test('omits transcript entry marker by default', () => {
  assert.equal(
    formatTranscriptEntryMarker({ speakerTag: 'Them' }),
    ''
  );
});

test('formats transcript entry marker with the speaker tag when requested', () => {
  assert.equal(
    formatTranscriptEntryMarker(
      { speakerTag: 'Them' },
      { includeSpeaker: true }
    ),
    '[Them]'
  );
});

test('builds conversation prompt with speaker marker and prompt suffix', () => {
  const text = buildTranscriptPromptText({
    promptText: 'What should I say?',
    transcriptEntries: [
      { sourceText: 'Can you walk me through your last project?', speakerTag: 'Them' },
      { sourceText: 'What tradeoffs did you make?', speakerTag: 'Them' }
    ]
  });

  assert.equal(TRANSCRIPT_PROMPT_HEADER, 'Conversations so far like this');
  assert.equal(text, [
    'Conversations so far like this',
    '"""',
    '[Them] Can you walk me through your last project?',
    'What tradeoffs did you make?',
    '"""',
    '',
    'What should I say?'
  ].join('\n'));
});

test('builds conversation prompt with speaker tags at speaker turn boundaries', () => {
  const text = buildTranscriptPromptText({
    promptText: 'What should I say?',
    transcriptEntries: [
      { sourceText: 'Can you walk me through your last project?', speakerTag: 'Them' },
      { sourceText: 'What tradeoffs did you make?', speakerTag: 'Them' },
      { sourceText: 'I focused on latency first.', speakerTag: 'Me' },
      { sourceText: 'Then I cleaned up reliability.', speakerTag: 'Me' },
      { sourceText: 'What was the result?', speakerTag: 'Them' }
    ]
  });

  assert.equal(text, [
    'Conversations so far like this',
    '"""',
    '[Them] Can you walk me through your last project?',
    'What tradeoffs did you make?',
    '[Me] I focused on latency first.',
    'Then I cleaned up reliability.',
    '[Them] What was the result?',
    '"""',
    '',
    'What should I say?'
  ].join('\n'));
});

test('builds prompt text when there is no transcript', () => {
  assert.equal(buildTranscriptPromptText({ promptText: 'What should I say?' }), 'What should I say?');
});
