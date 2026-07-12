(function initTranscriptDisplayGroups(root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
    return;
  }

  root.transcriptDisplayGroups = factory();
}(typeof globalThis !== 'undefined' ? globalThis : this, function createTranscriptDisplayGroupsModule() {
  const DEFAULT_TRANSCRIPT_DISPLAY_GROUP_MAX_SOURCE_CHARS = 420;
  const DEFAULT_TRANSCRIPT_DISPLAY_GROUP_MAX_ENTRIES = 5;
  const TRANSCRIPT_DISPLAY_GROUP_TRANSLATING_TEXT = 'Translating...';

  function getCleanText(value) {
    return typeof value === 'string' ? value.trim() : '';
  }

  function normalizePositiveInteger(value, fallback) {
    const number = Number(value);
    if (!Number.isFinite(number) || number <= 0) {
      return fallback;
    }

    return Math.max(1, Math.floor(number));
  }

  function normalizeDisplayGroupOptions(options = {}) {
    return {
      maxSourceChars: normalizePositiveInteger(
        options.maxSourceChars,
        DEFAULT_TRANSCRIPT_DISPLAY_GROUP_MAX_SOURCE_CHARS
      ),
      maxEntries: normalizePositiveInteger(
        options.maxEntries,
        DEFAULT_TRANSCRIPT_DISPLAY_GROUP_MAX_ENTRIES
      )
    };
  }

  function joinSourceText(entries) {
    return entries
      .map((entry) => getCleanText(entry?.sourceText))
      .filter(Boolean)
      .join('\n');
  }

  function joinTranslatedText(entries) {
    const translatedLines = [];
    let hasPendingWithoutTranslation = false;

    for (const entry of entries) {
      const translatedText = getCleanText(entry?.translatedText);
      if (translatedText) {
        translatedLines.push(translatedText);
      } else if (entry?.status === 'pending') {
        hasPendingWithoutTranslation = true;
      }
    }

    if (translatedLines.length > 0 && hasPendingWithoutTranslation) {
      translatedLines.push(TRANSCRIPT_DISPLAY_GROUP_TRANSLATING_TEXT);
    }

    return translatedLines.join('\n');
  }

  function getGroupStatus(entries) {
    if (entries.some((entry) => entry?.status === 'error')) {
      return 'error';
    }

    if (entries.some((entry) => entry?.status === 'pending')) {
      return 'pending';
    }

    if (entries.some((entry) => entry?.status === 'translated')) {
      return 'translated';
    }

    return 'disabled';
  }

  function shouldStartNewDisplayGroup(currentEntries, nextEntry, options) {
    if (currentEntries.length === 0) {
      return false;
    }

    const currentSpeakerTag = getCleanText(currentEntries[currentEntries.length - 1]?.speakerTag);
    const nextSpeakerTag = getCleanText(nextEntry?.speakerTag);
    if (currentSpeakerTag !== nextSpeakerTag) {
      return true;
    }

    if (currentEntries.length >= options.maxEntries) {
      return true;
    }

    const currentText = joinSourceText(currentEntries);
    const nextText = getCleanText(nextEntry?.sourceText);
    if (!currentText || !nextText) {
      return false;
    }

    return currentText.length + 1 + nextText.length > options.maxSourceChars;
  }

  function createDisplayGroup(entries, groupIndex) {
    const firstEntry = entries[0] || {};
    const firstId = getCleanText(firstEntry.id) || String(groupIndex);

    return {
      id: `display-${firstId}`,
      sourceText: joinSourceText(entries),
      translatedText: joinTranslatedText(entries),
      status: getGroupStatus(entries),
      isFinal: entries.every((entry) => Boolean(entry?.isFinal)),
      speakerTag: firstEntry.speakerTag,
      entryCount: entries.length
    };
  }

  function createTranscriptDisplayGroups(entries, options = {}) {
    if (!Array.isArray(entries) || entries.length === 0) {
      return [];
    }

    const normalizedOptions = normalizeDisplayGroupOptions(options);
    const displayGroups = [];
    let currentEntries = [];

    for (const entry of entries) {
      if (!entry || !getCleanText(entry.sourceText)) {
        continue;
      }

      if (shouldStartNewDisplayGroup(currentEntries, entry, normalizedOptions)) {
        displayGroups.push(createDisplayGroup(currentEntries, displayGroups.length));
        currentEntries = [];
      }

      currentEntries.push(entry);
    }

    if (currentEntries.length > 0) {
      displayGroups.push(createDisplayGroup(currentEntries, displayGroups.length));
    }

    return displayGroups;
  }

  return {
    DEFAULT_TRANSCRIPT_DISPLAY_GROUP_MAX_SOURCE_CHARS,
    DEFAULT_TRANSCRIPT_DISPLAY_GROUP_MAX_ENTRIES,
    TRANSCRIPT_DISPLAY_GROUP_TRANSLATING_TEXT,
    createTranscriptDisplayGroups
  };
}));
