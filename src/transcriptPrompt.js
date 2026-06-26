const TRANSCRIPT_PROMPT_HEADER = 'Conversations so far like this';
const TRANSCRIPT_SPEAKER_TAG = 'Them';
const DEFAULT_TRANSCRIPT_TIMESTAMP_LABEL = '00:00:00';

function normalizeTranscriptPromptText(text) {
  return String(text || '').trim();
}

function formatTranscriptElapsedTimestamp(elapsedMs = 0) {
  const numericElapsedMs = Number(elapsedMs);
  const safeElapsedMs = Number.isFinite(numericElapsedMs)
    ? Math.max(0, numericElapsedMs)
    : 0;
  const totalSeconds = Math.floor(safeElapsedMs / 1000);
  const seconds = totalSeconds % 60;
  const minutes = Math.floor(totalSeconds / 60) % 60;
  const hours = Math.floor(totalSeconds / 3600);

  return [
    String(hours).padStart(2, '0'),
    String(minutes).padStart(2, '0'),
    String(seconds).padStart(2, '0')
  ].join(':');
}

function normalizeTranscriptTimestampLabel(label) {
  const value = String(label || '').trim();
  const match = value.match(/^(\d{1,}):([0-5]\d):([0-5]\d)$/);
  if (!match) {
    return '';
  }

  return `${match[1].padStart(2, '0')}:${match[2]}:${match[3]}`;
}

function normalizeTranscriptSpeakerTag(speakerTag) {
  const value = String(speakerTag || '').trim();
  return value || TRANSCRIPT_SPEAKER_TAG;
}

function formatTranscriptEntryMarker(entry = {}) {
  const timestampLabel = normalizeTranscriptTimestampLabel(entry.timestampLabel)
    || DEFAULT_TRANSCRIPT_TIMESTAMP_LABEL;
  const speakerTag = normalizeTranscriptSpeakerTag(entry.speakerTag);

  return `[${timestampLabel} | ${speakerTag}]`;
}

function formatTranscriptEntryPromptLine(entry = {}) {
  const sourceText = normalizeTranscriptPromptText(entry.sourceText);
  if (!sourceText) {
    return '';
  }

  return `${formatTranscriptEntryMarker(entry)} ${sourceText}`;
}

function getTranscriptEntryPromptLines(transcriptEntries = []) {
  if (!Array.isArray(transcriptEntries)) {
    return [];
  }

  return transcriptEntries
    .map((entry) => formatTranscriptEntryPromptLine(entry))
    .filter(Boolean);
}

function getFallbackTranscriptPromptLines(transcriptText) {
  return normalizeTranscriptPromptText(transcriptText)
    .split('\n')
    .map((line) => normalizeTranscriptPromptText(line))
    .filter(Boolean)
    .map((sourceText) => formatTranscriptEntryPromptLine({ sourceText }));
}

function buildTranscriptPromptText({
  transcriptText = '',
  transcriptEntries = [],
  promptText = ''
} = {}) {
  const normalizedPromptText = normalizeTranscriptPromptText(promptText);
  const transcriptLines = getTranscriptEntryPromptLines(transcriptEntries);
  const fallbackTranscriptLines = transcriptLines.length > 0
    ? transcriptLines
    : getFallbackTranscriptPromptLines(transcriptText);

  const sections = [];
  if (fallbackTranscriptLines.length > 0) {
    sections.push(TRANSCRIPT_PROMPT_HEADER, ...fallbackTranscriptLines);
  }

  if (normalizedPromptText) {
    if (sections.length > 0) {
      sections.push('');
    }
    sections.push(normalizedPromptText);
  }

  return sections.join('\n');
}

module.exports = {
  TRANSCRIPT_PROMPT_HEADER,
  TRANSCRIPT_SPEAKER_TAG,
  DEFAULT_TRANSCRIPT_TIMESTAMP_LABEL,
  buildTranscriptPromptText,
  formatTranscriptElapsedTimestamp,
  formatTranscriptEntryMarker,
  formatTranscriptEntryPromptLine,
  normalizeTranscriptPromptText,
  normalizeTranscriptSpeakerTag,
  normalizeTranscriptTimestampLabel
};
