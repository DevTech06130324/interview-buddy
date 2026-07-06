const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function readRepoFile(fileName) {
  return fs.readFileSync(path.join(__dirname, '..', fileName), 'utf8');
}

test('renderer reuses transcript prompt marker helpers from the shared module', () => {
  const html = readRepoFile('index.html');
  const renderer = readRepoFile('renderer.js');
  const transcriptPrompt = readRepoFile('src/transcriptPrompt.js');

  assert.match(html, /src="src\/transcriptPrompt\.js"[\s\S]*src="renderer\.js"/);
  assert.match(transcriptPrompt, /root\.transcriptPrompt = factory\(\)/);
  assert.match(transcriptPrompt, /module\.exports = factory\(\)/);
  assert.match(renderer, /const \{\s*TRANSCRIPT_SPEAKER_TAG,\s*formatTranscriptEntryMarker,\s*normalizeTranscriptSpeakerTag,\s*shouldIncludeTranscriptSpeaker\s*\} = window\.transcriptPrompt;/);
  assert.doesNotMatch(renderer, /normalizeTranscriptTimestampLabel/);
  assert.doesNotMatch(transcriptPrompt, /DEFAULT_TRANSCRIPT_TIMESTAMP_LABEL/);
  assert.doesNotMatch(transcriptPrompt, /formatTranscriptElapsedTimestamp/);
  assert.equal((renderer.match(/function normalizeTranscriptSpeakerTag/g) || []).length, 0);
  assert.equal((renderer.match(/function formatTranscriptEntryMarker/g) || []).length, 0);
  assert.equal((renderer.match(/function shouldIncludeTranscriptSpeaker/g) || []).length, 0);
});
