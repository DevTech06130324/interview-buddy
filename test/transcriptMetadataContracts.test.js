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

  const parameterStartIndex = source.indexOf('(', startIndex);
  let parameterDepth = 0;
  let bodyStartIndex = -1;
  for (let index = parameterStartIndex; index < source.length; index += 1) {
    const char = source[index];
    if (char === '(') {
      parameterDepth += 1;
    } else if (char === ')') {
      parameterDepth -= 1;
      if (parameterDepth === 0) {
        bodyStartIndex = source.indexOf('{', index);
        break;
      }
    }
  }
  assert.notEqual(bodyStartIndex, -1, `Expected to find the body of ${name}`);

  let depth = 0;
  for (let index = bodyStartIndex; index < source.length; index += 1) {
    const char = source[index];
    if (char === '{') {
      depth += 1;
    } else if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        return source.slice(startIndex, index + 1);
      }
    }
  }

  assert.fail(`Expected to find the end of ${name}`);
}

test('Ctrl+Enter prompt injection does not stop when there is no pending transcript', () => {
  const source = getAsyncFunctionSource('submitTranscriptToAssistant');

  assert.doesNotMatch(source, /No new transcript is available for Ctrl\+Enter/);
  assert.match(source, /resolvePendingTranscriptCursor/);
  assert.match(source, /getTranscriptPromptText\(\s*cursorResult\.pendingText,\s*cursorResult\.pendingEntries/);
});

test('Ctrl+Enter resolves the cursor once and surfaces mismatch before any composer mutation', () => {
  const source = getAsyncFunctionSource('submitTranscriptToAssistant');
  const resolverCalls = source.match(/resolvePendingTranscriptCursor\(/g) || [];

  assert.equal(resolverCalls.length, 1);
  assert.match(source, /if \(cursorResult\.status === 'mismatch'\) \{\s*sendCaptionError\(TRANSCRIPT_CURSOR_MISMATCH_ERROR\);\s*return ASSISTANT_SUBMISSION_OUTCOME\.NOT_DISPATCHED;/);
  assert.ok(source.indexOf("cursorResult.status === 'mismatch'") < source.indexOf('capturePageFocusState('));
  assert.ok(source.indexOf("cursorResult.status === 'mismatch'") < source.indexOf('markTranscriptSubmitted('));
});

test('Ctrl+Enter allows disjoint rolling snapshots only for Live Captions cursor recovery', () => {
  const source = getAsyncFunctionSource('submitTranscriptToAssistant');

  assert.match(source, /allowDisjointCurrentTranscript:\s*transcriptSource === TRANSCRIPT_SOURCE_LIVE_CAPTIONS/);
});

test('Alt+Enter resolves the cursor once and surfaces mismatch before clipboard mutation', () => {
  const source = getAsyncFunctionSource('copyTranscriptPromptToClipboard');
  const resolverCalls = source.match(/resolvePendingTranscriptCursor\(/g) || [];

  assert.equal(resolverCalls.length, 1);
  assert.match(source, /if \(cursorResult\.status === 'mismatch'\) \{\s*sendCaptionError\(TRANSCRIPT_CURSOR_MISMATCH_ERROR\);\s*return;/);
  assert.ok(source.indexOf("cursorResult.status === 'mismatch'") < source.indexOf('clipboard.writeText('));
  assert.ok(source.indexOf("cursorResult.status === 'mismatch'") < source.indexOf('markTranscriptCopiedToClipboard('));
});

test('Alt+Enter allows disjoint rolling snapshots only for Live Captions cursor recovery', () => {
  const source = getAsyncFunctionSource('copyTranscriptPromptToClipboard');

  assert.match(source, /allowDisjointCurrentTranscript:\s*transcriptSource === TRANSCRIPT_SOURCE_LIVE_CAPTIONS/);
});

test('cursor mismatch message tells the user to retry or clear to reset', () => {
  const source = readRepoFile('main.js');

  assert.match(source, /const TRANSCRIPT_CURSOR_MISMATCH_ERROR = '[^']*[Rr]etry[^']*[Cc]lear[^']*reset[^']*';/);
});

test('clear transcript resets submitted and clipboard cursors before coordinator-managed Deepgram clear', () => {
  const source = readRepoFile('main.js');
  const resetSource = getFunctionSource(source, 'resetTranscriptStateForSource');
  const clearHandlerStart = source.indexOf("ipcMain.handle('clear-transcript'");
  const nextHandlerStart = source.indexOf('\nipcMain.handle(', clearHandlerStart + 1);
  const clearHandlerSource = source.slice(clearHandlerStart, nextHandlerStart);

  assert.match(resetSource, /resetTranscriptCursors\(\)/);
  assert.match(clearHandlerSource, /resetTranscriptStateForSource\(\)/);
  const coordinatorClearIndex = clearHandlerSource.indexOf('getDeepgramLifecycleCoordinator().clear()');
  assert.ok(coordinatorClearIndex >= 0);
  assert.ok(clearHandlerSource.indexOf('resetTranscriptStateForSource()') < coordinatorClearIndex);
  assert.doesNotMatch(clearHandlerSource, /deepgramTranscriptionService\.clear\(\)/);
});

test('source switching with transcript reset rotates the stopped Deepgram session through the coordinator', () => {
  const source = readRepoFile('main.js');
  const sourceChange = getFunctionSource(source, 'applyTranscriptSourceChange');
  const stopIndex = sourceChange.indexOf("stopDeepgramTranscriptSource('source-switched')");
  const clearIndex = sourceChange.indexOf('getDeepgramLifecycleCoordinator().clear()');
  const resetIndex = sourceChange.indexOf('resetTranscriptStateForSource()');

  assert.match(sourceChange, /if \(\s*resetTranscript\s*&& \(\s*transcriptSource === TRANSCRIPT_SOURCE_DEEPGRAM\s*\|\| normalizedSource === TRANSCRIPT_SOURCE_DEEPGRAM\s*\)\s*\) \{\s*(?:await\s+)?getDeepgramLifecycleCoordinator\(\)\.clear\(\);\s*\}/);
  assert.ok(stopIndex >= 0);
  assert.ok(clearIndex > stopIndex);
  assert.ok(resetIndex > clearIndex);
  assert.doesNotMatch(sourceChange, /deepgramTranscriptionService\.clear\(\)/);
});

test('Ctrl+Enter marks submitted transcript text and entries from the same snapshot', () => {
  const source = getAsyncFunctionSource('submitTranscriptToAssistant');

  assert.match(source, /const transcriptEntriesSnapshot = normalizeTranscriptEntriesForPrompt\(latestTranscriptEntries\)/);
  assert.match(source, /transcriptEntries:\s*transcriptEntriesSnapshot/);
  assert.match(source, /markTranscriptSubmitted\(transcriptSnapshot,\s*transcriptEntriesSnapshot\)/);
  assert.doesNotMatch(source, /markTranscriptSubmitted\(transcriptSnapshot\)/);
});

test('submitted transcript cursor refreshes renderer row styling without reusing payload version', () => {
  const source = readRepoFile('main.js');
  const markerSource = getFunctionSource(source, 'markTranscriptSubmitted');
  const refreshSource = getFunctionSource(source, 'refreshTranscriptSubmittedState');

  assert.match(markerSource, /refreshTranscriptSubmittedState\(\)/);
  assert.match(refreshSource, /sendCaptionUpdate\(\{\s*fullText:\s*latestTranscriptText,\s*entries:\s*latestTranscriptEntries\s*\}\)/);
  assert.doesNotMatch(refreshSource, /payloadVersion/);
});

test('submitted transcript annotation keeps submitted prefixes for extended live caption rows', () => {
  const source = readRepoFile('main.js');
  const prefixSource = getFunctionSource(source, 'getSubmittedTranscriptEntryPrefix');
  const submittedSource = getFunctionSource(source, 'isTranscriptEntrySubmitted');
  const annotationSource = getFunctionSource(source, 'annotateTranscriptEntriesForRenderer');

  assert.match(prefixSource, /sourceText\.startsWith\(submittedSourceText\)/);
  assert.match(prefixSource, /submittedSourceText\.endsWith\(sourceText\)/);
  assert.match(submittedSource, /getSubmittedTranscriptEntryPrefix\(entry/);
  assert.match(annotationSource, /const submittedSourceText = getSubmittedTranscriptEntryPrefix\(entry\)/);
  assert.match(annotationSource, /submittedSourceText,/);
  assert.match(annotationSource, /isSubmitted:\s*isTranscriptEntrySubmitted\(entry,\s*\{\s*submittedSourceText\s*\}\)/);
});

test('caption updates send normalized entries with speaker metadata to the renderer', () => {
  const source = readRepoFile('main.js');
  const sendCaptionUpdateSource = getFunctionSource(source, 'sendCaptionUpdate');
  const annotationSource = getFunctionSource(source, 'annotateTranscriptEntriesForRenderer');

  assert.doesNotMatch(source, /entries:\s*payload\?\.entries\s*\|\|\s*latestTranscriptEntries/);
  assert.match(source, /entries:\s*latestTranscriptEntries/);
  assert.match(sendCaptionUpdateSource, /annotateTranscriptEntriesForRenderer/);
  assert.match(annotationSource, /isSubmitted:\s*isTranscriptEntrySubmitted\(entry,\s*\{\s*submittedSourceText\s*\}\)/);
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
