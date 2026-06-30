const {
  normalizeTranscriptPromptText
} = require('./transcriptPrompt');

function normalizeTranscriptEntryForCursor(entry, index = 0) {
  if (!entry) {
    return null;
  }

  const sourceText = normalizeTranscriptPromptText(entry.sourceText);
  if (!sourceText) {
    return null;
  }

  return {
    ...entry,
    id: typeof entry.id === 'string' && entry.id ? entry.id : `caption-${index}`,
    sourceText
  };
}

function normalizeTranscriptEntriesForCursor(entries) {
  if (!Array.isArray(entries)) {
    return [];
  }

  return entries
    .map((entry, index) => normalizeTranscriptEntryForCursor(entry, index))
    .filter(Boolean);
}

function getTranscriptTextFromEntries(entries) {
  return normalizeTranscriptEntriesForCursor(entries)
    .map((entry) => entry.sourceText)
    .join('\n')
    .trim();
}

function getComparableTranscriptText(text) {
  return normalizeTranscriptPromptText(text)
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .toLowerCase();
}

function getTranscriptLines(text) {
  return normalizeTranscriptPromptText(text)
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

function getPendingTextFromMatchedEntry(currentSourceText, cursorSourceText) {
  const currentText = normalizeTranscriptPromptText(currentSourceText);
  const cursorText = normalizeTranscriptPromptText(cursorSourceText);

  if (!currentText || !cursorText || currentText === cursorText) {
    return '';
  }

  if (currentText.startsWith(cursorText)) {
    return currentText.slice(cursorText.length).trim();
  }

  const currentComparable = getComparableTranscriptText(currentText);
  const cursorComparable = getComparableTranscriptText(cursorText);
  if (currentComparable && cursorComparable && currentComparable.startsWith(cursorComparable)) {
    return currentText.slice(Math.min(currentText.length, cursorText.length)).trim();
  }

  return '';
}

function getTranscriptEntryWithSourceText(entry, sourceText) {
  const normalizedSourceText = normalizeTranscriptPromptText(sourceText);
  if (!entry || !normalizedSourceText) {
    return null;
  }

  return {
    ...entry,
    sourceText: normalizedSourceText
  };
}

function getPendingTranscriptEntriesFromEntryCursor(currentEntries, cursorEntries) {
  const normalizedCurrentEntries = normalizeTranscriptEntriesForCursor(currentEntries);
  const normalizedCursorEntries = normalizeTranscriptEntriesForCursor(cursorEntries);

  if (normalizedCurrentEntries.length === 0 || normalizedCursorEntries.length === 0) {
    return null;
  }

  for (let cursorIndex = normalizedCursorEntries.length - 1; cursorIndex >= 0; cursorIndex -= 1) {
    const cursorEntry = normalizedCursorEntries[cursorIndex];
    const currentIndex = normalizedCurrentEntries.findIndex((entry) => entry.id === cursorEntry.id);

    if (currentIndex === -1) {
      continue;
    }

    const currentEntry = normalizedCurrentEntries[currentIndex];
    const parts = [];
    const currentEntryRemainder = getPendingTextFromMatchedEntry(
      currentEntry.sourceText,
      cursorEntry.sourceText
    );

    if (currentEntryRemainder) {
      const remainderEntry = getTranscriptEntryWithSourceText(currentEntry, currentEntryRemainder);
      if (remainderEntry) {
        parts.push(remainderEntry);
      }
    }

    parts.push(...normalizedCurrentEntries.slice(currentIndex + 1));
    return parts;
  }

  for (let cursorIndex = normalizedCursorEntries.length - 1; cursorIndex >= 0; cursorIndex -= 1) {
    const cursorEntry = normalizedCursorEntries[cursorIndex];
    const cursorComparable = getComparableTranscriptText(cursorEntry.sourceText);
    if (!cursorComparable) {
      continue;
    }

    for (let currentIndex = normalizedCurrentEntries.length - 1; currentIndex >= 0; currentIndex -= 1) {
      const currentEntry = normalizedCurrentEntries[currentIndex];
      const currentComparable = getComparableTranscriptText(currentEntry.sourceText);
      const isSameEntryText = currentEntry.sourceText === cursorEntry.sourceText
        || currentComparable === cursorComparable
        || currentComparable.startsWith(cursorComparable);

      if (!isSameEntryText) {
        continue;
      }

      const parts = [];
      const currentEntryRemainder = getPendingTextFromMatchedEntry(
        currentEntry.sourceText,
        cursorEntry.sourceText
      );

      if (currentEntryRemainder) {
        const remainderEntry = getTranscriptEntryWithSourceText(currentEntry, currentEntryRemainder);
        if (remainderEntry) {
          parts.push(remainderEntry);
        }
      }

      parts.push(...normalizedCurrentEntries.slice(currentIndex + 1));
      return parts;
    }
  }

  return null;
}

function getPendingTranscriptTextFromEntryCursor(currentEntries, cursorEntries) {
  const pendingEntries = getPendingTranscriptEntriesFromEntryCursor(currentEntries, cursorEntries);
  return pendingEntries === null
    ? null
    : getTranscriptTextFromEntries(pendingEntries);
}

function getLongestTranscriptBoundaryOverlap(previousText, currentText) {
  const previous = normalizeTranscriptPromptText(previousText);
  const current = normalizeTranscriptPromptText(currentText);
  const maxLength = Math.min(previous.length, current.length);

  for (let length = maxLength; length >= 24; length -= 1) {
    if (previous.slice(previous.length - length) === current.slice(0, length)) {
      return length;
    }
  }

  return 0;
}

function getPendingTranscriptText(transcriptText, cursorText) {
  const currentTranscriptText = normalizeTranscriptPromptText(transcriptText);
  const submittedTranscriptText = normalizeTranscriptPromptText(cursorText);

  if (!currentTranscriptText || !submittedTranscriptText) {
    return currentTranscriptText;
  }

  if (currentTranscriptText === submittedTranscriptText) {
    return '';
  }

  if (currentTranscriptText.startsWith(submittedTranscriptText)) {
    return currentTranscriptText.slice(submittedTranscriptText.length).replace(/^\s*\n?/, '').trim();
  }

  const cursorTextIndex = currentTranscriptText.lastIndexOf(submittedTranscriptText);
  if (cursorTextIndex !== -1) {
    return currentTranscriptText.slice(cursorTextIndex + submittedTranscriptText.length).trim();
  }

  const overlapLength = getLongestTranscriptBoundaryOverlap(submittedTranscriptText, currentTranscriptText);
  if (overlapLength > 0) {
    return currentTranscriptText.slice(overlapLength).trim();
  }

  const currentLines = getTranscriptLines(currentTranscriptText);
  const submittedLines = getTranscriptLines(submittedTranscriptText);
  for (let submittedLineIndex = submittedLines.length - 1; submittedLineIndex >= 0; submittedLineIndex -= 1) {
    const submittedLine = submittedLines[submittedLineIndex];
    const submittedComparable = getComparableTranscriptText(submittedLine);
    if (!submittedComparable) {
      continue;
    }

    for (let currentLineIndex = currentLines.length - 1; currentLineIndex >= 0; currentLineIndex -= 1) {
      const currentLine = currentLines[currentLineIndex];
      const currentComparable = getComparableTranscriptText(currentLine);
      const isSameLine = currentLine === submittedLine
        || currentComparable === submittedComparable
        || currentComparable.startsWith(submittedComparable);

      if (!isSameLine) {
        continue;
      }

      const lineRemainder = getPendingTextFromMatchedEntry(currentLine, submittedLine);
      return [
        lineRemainder,
        ...currentLines.slice(currentLineIndex + 1)
      ].filter(Boolean).join('\n').trim();
    }
  }

  let firstUnsubmittedLineIndex = 0;

  while (
    firstUnsubmittedLineIndex < currentLines.length
    && firstUnsubmittedLineIndex < submittedLines.length
    && currentLines[firstUnsubmittedLineIndex] === submittedLines[firstUnsubmittedLineIndex]
  ) {
    firstUnsubmittedLineIndex += 1;
  }

  if (firstUnsubmittedLineIndex === 0 && submittedLines.length > 0) {
    if (currentTranscriptText.length > submittedTranscriptText.length) {
      return currentTranscriptText.slice(submittedTranscriptText.length).trim();
    }

    return '';
  }

  return currentLines.slice(firstUnsubmittedLineIndex).join('\n').trim();
}

function getPendingFirstEntryText(pendingText, restText) {
  if (!restText) {
    return pendingText;
  }

  const restSuffix = `\n${restText}`;
  if (!pendingText.endsWith(restSuffix)) {
    return null;
  }

  return pendingText.slice(0, -restSuffix.length).trim();
}

function getPendingTranscriptEntriesFromText(currentEntries, pendingText) {
  const normalizedCurrentEntries = normalizeTranscriptEntriesForCursor(currentEntries);
  const normalizedPendingText = normalizeTranscriptPromptText(pendingText);

  if (!normalizedPendingText) {
    return [];
  }

  if (normalizedCurrentEntries.length === 0) {
    return [];
  }

  for (let entryIndex = 0; entryIndex < normalizedCurrentEntries.length; entryIndex += 1) {
    const entriesFromIndex = normalizedCurrentEntries.slice(entryIndex);
    if (getTranscriptTextFromEntries(entriesFromIndex) === normalizedPendingText) {
      return entriesFromIndex;
    }
  }

  for (let entryIndex = 0; entryIndex < normalizedCurrentEntries.length; entryIndex += 1) {
    const currentEntry = normalizedCurrentEntries[entryIndex];
    const followingEntries = normalizedCurrentEntries.slice(entryIndex + 1);
    const followingText = getTranscriptTextFromEntries(followingEntries);
    const firstEntryText = getPendingFirstEntryText(normalizedPendingText, followingText);

    if (!firstEntryText) {
      continue;
    }

    const currentText = normalizeTranscriptPromptText(currentEntry.sourceText);
    const firstEntryComparable = getComparableTranscriptText(firstEntryText);
    const currentComparable = getComparableTranscriptText(currentText);
    const isEntryTail = currentText.endsWith(firstEntryText)
      || (firstEntryComparable && currentComparable.endsWith(firstEntryComparable));

    if (!isEntryTail) {
      continue;
    }

    const firstEntry = getTranscriptEntryWithSourceText(currentEntry, firstEntryText);
    return [
      ...(firstEntry ? [firstEntry] : []),
      ...followingEntries
    ];
  }

  return [];
}

function getPendingTranscriptTextForCursor({
  transcriptText = '',
  transcriptEntries = [],
  cursorText = '',
  cursorEntries = []
} = {}) {
  const currentTranscriptText = normalizeTranscriptPromptText(transcriptText);
  const submittedTranscriptText = normalizeTranscriptPromptText(cursorText);

  if (!currentTranscriptText || !submittedTranscriptText) {
    return currentTranscriptText;
  }

  const entryPendingText = getPendingTranscriptTextFromEntryCursor(transcriptEntries, cursorEntries);
  if (entryPendingText !== null) {
    return entryPendingText;
  }

  return getPendingTranscriptText(currentTranscriptText, submittedTranscriptText);
}

function getPendingTranscriptEntriesForCursor({
  transcriptText = '',
  transcriptEntries = [],
  cursorText = '',
  cursorEntries = []
} = {}) {
  const currentTranscriptText = normalizeTranscriptPromptText(transcriptText);
  const submittedTranscriptText = normalizeTranscriptPromptText(cursorText);
  const normalizedTranscriptEntries = normalizeTranscriptEntriesForCursor(transcriptEntries);

  if (!currentTranscriptText) {
    return [];
  }

  if (!submittedTranscriptText) {
    return normalizedTranscriptEntries;
  }

  const pendingEntries = getPendingTranscriptEntriesFromEntryCursor(
    normalizedTranscriptEntries,
    cursorEntries
  );
  if (pendingEntries !== null) {
    return pendingEntries;
  }

  return getPendingTranscriptEntriesFromText(
    normalizedTranscriptEntries,
    getPendingTranscriptText(currentTranscriptText, submittedTranscriptText)
  );
}

module.exports = {
  getPendingTranscriptEntriesForCursor,
  getPendingTranscriptEntriesFromEntryCursor,
  getPendingTranscriptText,
  getPendingTranscriptTextForCursor,
  getPendingTranscriptTextFromEntryCursor,
  getTranscriptTextFromEntries
};
