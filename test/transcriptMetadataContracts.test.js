const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function readRepoFile(fileName) {
  return fs.readFileSync(path.join(__dirname, '..', fileName), 'utf8');
}

function getAsyncFunctionSource(name) {
  const source = readRepoFile('main.js');
  const startMarker = `async function ${name}(`;
  const startIndex = source.indexOf(startMarker);
  assert.notEqual(startIndex, -1, `Expected to find ${name} in main.js`);

  const nextFunctionIndex = source.indexOf('\nasync function ', startIndex + startMarker.length);
  assert.notEqual(nextFunctionIndex, -1, `Expected to find the end of ${name} in main.js`);
  return source.slice(startIndex, nextFunctionIndex);
}

function getFunctionSource(source, name) {
  const startMarker = `function ${name}(`;
  const startIndex = source.indexOf(startMarker);
  assert.notEqual(startIndex, -1, `Expected to find ${name}`);

  let depth = 0;
  let sawOpeningBrace = false;
  for (let index = startIndex; index < source.length; index += 1) {
    const char = source[index];
    if (char === '{') {
      depth += 1;
      sawOpeningBrace = true;
    } else if (char === '}') {
      depth -= 1;
      if (sawOpeningBrace && depth === 0) {
        return source.slice(startIndex, index + 1);
      }
    }
  }

  assert.fail(`Expected to find the end of ${name}`);
}

test('Ctrl+Enter prompt injection does not stop when there is no pending transcript', () => {
  const source = getAsyncFunctionSource('submitTranscriptToAssistant');

  assert.doesNotMatch(source, /No new transcript is available for Ctrl\+Enter/);
  assert.match(source, /getPendingTranscriptEntriesForCursor/);
  assert.match(source, /getTranscriptPromptText\(\s*pendingTranscriptText,\s*pendingTranscriptEntries/);
});

test('Ctrl+Enter marks submitted transcript text and entries from the same snapshot', () => {
  const source = getAsyncFunctionSource('submitTranscriptToAssistant');

  assert.match(source, /const transcriptEntriesSnapshot = normalizeTranscriptEntriesForPrompt\(latestTranscriptEntries\)/);
  assert.match(source, /transcriptEntries:\s*transcriptEntriesSnapshot/);
  assert.match(source, /markTranscriptSubmitted\(transcriptSnapshot,\s*transcriptEntriesSnapshot\)/);
  assert.doesNotMatch(source, /markTranscriptSubmitted\(transcriptSnapshot\)/);
});

test('caption updates send normalized entries with speaker metadata to the renderer', () => {
  const source = readRepoFile('main.js');

  assert.doesNotMatch(source, /entries:\s*payload\?\.entries\s*\|\|\s*latestTranscriptEntries/);
  assert.match(source, /entries:\s*latestTranscriptEntries/);
});

test('transcript metadata is speaker-only without timestamp state', () => {
  const source = readRepoFile('main.js');
  const normalizerSource = getFunctionSource(source, 'normalizeTranscriptEntryForPrompt');

  assert.doesNotMatch(source, /DEFAULT_TRANSCRIPT_TIMESTAMP_LABEL/);
  assert.doesNotMatch(source, /formatTranscriptElapsedTimestamp/);
  assert.doesNotMatch(source, /normalizeTranscriptTimestampLabel/);
  assert.doesNotMatch(source, /transcriptSessionStartedAtMs/);
  assert.doesNotMatch(source, /transcriptEntryMetadata/);
  assert.doesNotMatch(source, /timestampLabel/);
  assert.doesNotMatch(source, /receivedAtMs/);
  assert.match(normalizerSource, /speakerTag: normalizeTranscriptSpeakerTag\(entry\.speakerTag \|\| TRANSCRIPT_SPEAKER_TAG\)/);
});

test('renderer transcript rows display the speaker marker only on the first row', () => {
  const source = readRepoFile('renderer.js');
  const promptHelpers = readRepoFile('src/transcriptPrompt.js');

  assert.match(source, /formatTranscriptEntryMarker/);
  assert.match(source, /shouldIncludeTranscriptSpeaker/);
  assert.match(promptHelpers, /return `\[\$\{normalizeTranscriptSpeakerTag\(entry\.speakerTag\)\}\]`;/);
  assert.doesNotMatch(promptHelpers, /timestampLabel/);
  assert.match(promptHelpers, /function shouldIncludeTranscriptSpeaker/);
  assert.match(source, /transcript-entry-marker/);
  assert.match(source, /sourceCell\.replaceChildren/);
});
