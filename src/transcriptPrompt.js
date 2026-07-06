(function initTranscriptPrompt(root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
    return;
  }

  root.transcriptPrompt = factory();
}(typeof globalThis !== 'undefined' ? globalThis : this, function createTranscriptPromptModule() {
const TRANSCRIPT_PROMPT_HEADER = 'Conversations so far like this';
const TRANSCRIPT_SPEAKER_TAG = 'Them';

function normalizeTranscriptPromptText(text) {
  return String(text || '').trim();
}

function normalizeTranscriptSpeakerTag(speakerTag) {
  const value = String(speakerTag || '').trim();
  return value || TRANSCRIPT_SPEAKER_TAG;
}

function formatTranscriptEntryMarker(entry = {}, options = {}) {
  const includeSpeaker = Boolean(options.includeSpeaker);

  if (!includeSpeaker) {
    return '';
  }

  return `[${normalizeTranscriptSpeakerTag(entry.speakerTag)}]`;
}

function shouldIncludeTranscriptSpeaker(entry = {}, index = 0, previousEntry = null) {
  if (index === 0) {
    return true;
  }

  const currentSpeaker = normalizeTranscriptSpeakerTag(entry.speakerTag);
  const previousSpeaker = normalizeTranscriptSpeakerTag(previousEntry?.speakerTag);
  return Boolean(currentSpeaker && previousSpeaker && currentSpeaker !== previousSpeaker);
}

function formatTranscriptEntryPromptLine(entry = {}, options = {}) {
  const sourceText = normalizeTranscriptPromptText(entry.sourceText);
  if (!sourceText) {
    return '';
  }

  const marker = formatTranscriptEntryMarker(entry, options);
  return marker ? `${marker} ${sourceText}` : sourceText;
}

function getTranscriptEntryPromptLines(transcriptEntries = []) {
  if (!Array.isArray(transcriptEntries)) {
    return [];
  }

  return transcriptEntries
    .map((entry, index) => formatTranscriptEntryPromptLine(entry, {
      includeSpeaker: shouldIncludeTranscriptSpeaker(entry, index, transcriptEntries[index - 1])
    }))
    .filter(Boolean);
}

function getFallbackTranscriptPromptLines(transcriptText) {
  return normalizeTranscriptPromptText(transcriptText)
    .split('\n')
    .map((line) => normalizeTranscriptPromptText(line))
    .filter(Boolean)
    .map((sourceText, index) => formatTranscriptEntryPromptLine(
      { sourceText },
      { includeSpeaker: index === 0 }
    ));
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
    sections.push(TRANSCRIPT_PROMPT_HEADER, '"""', ...fallbackTranscriptLines, '"""');
  }

  if (normalizedPromptText) {
    if (sections.length > 0) {
      sections.push('');
    }
    sections.push(normalizedPromptText);
  }

  return sections.join('\n');
}

return {
  TRANSCRIPT_PROMPT_HEADER,
  TRANSCRIPT_SPEAKER_TAG,
  buildTranscriptPromptText,
  formatTranscriptEntryMarker,
  formatTranscriptEntryPromptLine,
  normalizeTranscriptPromptText,
  normalizeTranscriptSpeakerTag,
  shouldIncludeTranscriptSpeaker
};
}));
