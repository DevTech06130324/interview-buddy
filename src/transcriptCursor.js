const {
  normalizeTranscriptPromptText
} = require('./transcriptPrompt');

const TRANSCRIPT_CURSOR_MATCHED_STATUS = 'matched';
const TRANSCRIPT_CURSOR_MISMATCH_STATUS = 'mismatch';
const TRANSCRIPT_CURSOR_MISMATCH_REASON = 'unverified-boundary';
const MIN_EXACT_TRANSCRIPT_OVERLAP_CHARS = 24;
const MIN_SAME_ENTRY_REVISION_BOUNDARY_CHARS = 8;
const MIN_REVISED_TRANSCRIPT_OVERLAP_WORDS = 6;
const MAX_REVISED_TRANSCRIPT_MISMATCHES = 4;
const REVISED_TRANSCRIPT_MISMATCH_RATIO = 0.1;
const TERMINAL_BOUNDARY_PUNCTUATION_PATTERN = /[.!?\u3002\uff1f\uff01]\s*$/u;
const TRAILING_BOUNDARY_PATTERN = /[\s.!?\u3002\uff1f\uff01]+$/u;
const WORD_TOKEN_PATTERN = /[\p{L}\p{N}]+(?:['\u2019][\p{L}\p{N}]+)*/gu;

function normalizeTranscriptEntryForCursor(entry) {
  if (!entry) {
    return null;
  }

  const sourceText = normalizeTranscriptPromptText(entry.sourceText);
  if (!sourceText) {
    return null;
  }

  return {
    ...entry,
    sourceText
  };
}

function normalizeTranscriptEntriesForCursor(entries) {
  if (!Array.isArray(entries)) {
    return [];
  }

  return entries
    .map((entry) => normalizeTranscriptEntryForCursor(entry))
    .filter(Boolean);
}

function getTranscriptTextFromEntries(entries) {
  return normalizeTranscriptEntriesForCursor(entries)
    .map((entry) => entry.sourceText)
    .join('\n')
    .trim();
}

function getExplicitEntryId(entry) {
  return typeof entry?.id === 'string' ? entry.id.trim() : '';
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

function hasTerminalBoundaryPunctuation(text) {
  return TERMINAL_BOUNDARY_PUNCTUATION_PATTERN.test(String(text || ''));
}

function trimTerminalBoundary(text) {
  return normalizeTranscriptPromptText(text).replace(TRAILING_BOUNDARY_PATTERN, '').trim();
}

function isTerminalBoundaryPunctuation(character) {
  return character === '.'
    || character === '!'
    || character === '?'
    || character === '\u3002'
    || character === '\uff1f'
    || character === '\uff01';
}

function isWordCharacter(character) {
  return typeof character === 'string'
    && character.length > 0
    && /[\p{L}\p{N}]/u.test(character);
}

function getWordTokens(text) {
  return Array.from(String(text || '').matchAll(WORD_TOKEN_PATTERN), (match) => ({
    text: match[0],
    end: match.index + match[0].length
  }));
}

function getTokenTextLength(tokens) {
  return tokens.reduce((length, token) => length + token.text.length, 0);
}

function getAllowedRevisedTranscriptMismatches(tokenCount) {
  return Math.min(
    MAX_REVISED_TRANSCRIPT_MISMATCHES,
    Math.max(1, Math.floor(tokenCount * REVISED_TRANSCRIPT_MISMATCH_RATIO))
  );
}

function hasRevisedBoundaryAnchor(previousTokens, currentTokens, previousStartIndex, overlapLength) {
  const lastPreviousToken = previousTokens[previousTokens.length - 1];
  const lastCurrentToken = currentTokens[overlapLength - 1];
  if (lastPreviousToken.text === lastCurrentToken.text) {
    return true;
  }

  const anchorWindowLength = Math.min(3, overlapLength - 1);
  const requiredAnchorMatches = Math.min(2, anchorWindowLength);
  let anchorMatches = 0;

  for (
    let index = overlapLength - 1 - anchorWindowLength;
    index < overlapLength - 1;
    index += 1
  ) {
    if (previousTokens[previousStartIndex + index].text === currentTokens[index].text) {
      anchorMatches += 1;
    }
  }

  return anchorMatches >= requiredAnchorMatches;
}

function getBoundaryAfterInterveningPunctuation(text, boundaryLength) {
  let length = boundaryLength;
  while (length < text.length && !isWordCharacter(text[length])) {
    length += 1;
  }

  return length;
}

function hasVerifiedRevisedTokenBoundary(previousTokens, currentTokens, previousStartIndex) {
  const overlapLength = previousTokens.length - previousStartIndex;
  if (
    overlapLength < MIN_REVISED_TRANSCRIPT_OVERLAP_WORDS
    || overlapLength > currentTokens.length
  ) {
    return false;
  }

  const previousOverlapTokens = previousTokens.slice(previousStartIndex);
  if (getTokenTextLength(previousOverlapTokens) < MIN_EXACT_TRANSCRIPT_OVERLAP_CHARS) {
    return false;
  }

  if (!hasRevisedBoundaryAnchor(previousTokens, currentTokens, previousStartIndex, overlapLength)) {
    return false;
  }

  let mismatchCount = 0;
  for (let index = 0; index < overlapLength; index += 1) {
    if (previousTokens[previousStartIndex + index].text !== currentTokens[index].text) {
      mismatchCount += 1;
    }
  }

  return mismatchCount <= getAllowedRevisedTranscriptMismatches(overlapLength);
}

function getVerifiedEntryBoundaryLength(currentText, cursorText) {
  if (currentText.startsWith(cursorText)) {
    return cursorText.length;
  }

  const cursorBoundaryText = trimTerminalBoundary(cursorText);
  if (
    cursorBoundaryText.length < MIN_SAME_ENTRY_REVISION_BOUNDARY_CHARS
    || !currentText.startsWith(cursorBoundaryText)
  ) {
    return -1;
  }

  let boundaryLength = cursorBoundaryText.length;
  if (hasTerminalBoundaryPunctuation(cursorText)) {
    while (isTerminalBoundaryPunctuation(currentText[boundaryLength])) {
      boundaryLength += 1;
    }
  }

  return isWordCharacter(currentText[boundaryLength]) ? -1 : boundaryLength;
}

function createMatchedCursorResult(pendingText, pendingEntries) {
  return {
    status: TRANSCRIPT_CURSOR_MATCHED_STATUS,
    pendingText: normalizeTranscriptPromptText(pendingText),
    pendingEntries: normalizeTranscriptEntriesForCursor(pendingEntries)
  };
}

function createCursorMismatchResult() {
  return {
    status: TRANSCRIPT_CURSOR_MISMATCH_STATUS,
    reason: TRANSCRIPT_CURSOR_MISMATCH_REASON,
    pendingText: '',
    pendingEntries: []
  };
}

function getExactEntryBoundaryResult(currentEntries, cursorEntries) {
  if (currentEntries.length === 0 || cursorEntries.length === 0) {
    return null;
  }

  const cursorEntry = cursorEntries[cursorEntries.length - 1];
  const cursorEntryId = getExplicitEntryId(cursorEntry);
  if (!cursorEntryId) {
    return null;
  }

  const currentIndex = currentEntries.findIndex(
    (entry) => getExplicitEntryId(entry) === cursorEntryId
  );
  if (currentIndex === -1) {
    return null;
  }

  const currentBoundaryEntries = currentEntries.slice(0, currentIndex + 1);
  if (currentBoundaryEntries.length > cursorEntries.length) {
    return createCursorMismatchResult();
  }

  const cursorBoundaryEntries = cursorEntries.slice(-currentBoundaryEntries.length);
  let currentEntryBoundaryLength = -1;
  for (let index = 0; index < currentBoundaryEntries.length; index += 1) {
    const currentBoundaryEntry = currentBoundaryEntries[index];
    const cursorBoundaryEntry = cursorBoundaryEntries[index];
    const hasSameIdentity = getExplicitEntryId(currentBoundaryEntry)
      && getExplicitEntryId(currentBoundaryEntry) === getExplicitEntryId(cursorBoundaryEntry);
    const isLastBoundaryEntry = index === currentBoundaryEntries.length - 1;
    currentEntryBoundaryLength = isLastBoundaryEntry
      ? getVerifiedEntryBoundaryLength(currentBoundaryEntry.sourceText, cursorBoundaryEntry.sourceText)
      : -1;
    const hasVerifiedContent = isLastBoundaryEntry
      ? currentEntryBoundaryLength >= 0
      : currentBoundaryEntry.sourceText === cursorBoundaryEntry.sourceText;

    if (!hasSameIdentity || !hasVerifiedContent) {
      return createCursorMismatchResult();
    }
  }

  const currentEntry = currentEntries[currentIndex];

  const pendingEntries = [];
  const currentEntryRemainder = normalizeTranscriptPromptText(
    currentEntry.sourceText.slice(currentEntryBoundaryLength)
  );
  const remainderEntry = getTranscriptEntryWithSourceText(
    currentEntry,
    currentEntryRemainder
  );
  if (remainderEntry) {
    pendingEntries.push(remainderEntry);
  }

  pendingEntries.push(...currentEntries.slice(currentIndex + 1));
  return createMatchedCursorResult(
    getTranscriptTextFromEntries(pendingEntries),
    pendingEntries
  );
}

function getLongestExactTranscriptBoundaryOverlap(previousText, currentText) {
  const maxLength = Math.min(previousText.length, currentText.length);

  for (let length = maxLength; length >= MIN_EXACT_TRANSCRIPT_OVERLAP_CHARS; length -= 1) {
    if (previousText.slice(previousText.length - length) === currentText.slice(0, length)) {
      return length;
    }
  }

  return 0;
}

function getLongestRevisedTranscriptBoundaryOverlap(previousText, currentText) {
  const previousTokens = getWordTokens(previousText);
  const currentTokens = getWordTokens(currentText);

  for (let previousStartIndex = 0; previousStartIndex < previousTokens.length; previousStartIndex += 1) {
    if (!hasVerifiedRevisedTokenBoundary(previousTokens, currentTokens, previousStartIndex)) {
      continue;
    }

    const overlapLength = previousTokens.length - previousStartIndex;
    return getBoundaryAfterInterveningPunctuation(
      currentText,
      currentTokens[overlapLength - 1].end
    );
  }

  return 0;
}

function getExactPendingText(currentText, cursorText) {
  if (!cursorText) {
    return currentText;
  }

  if (!currentText) {
    return null;
  }

  if (currentText === cursorText) {
    return '';
  }

  if (currentText.startsWith(cursorText)) {
    return normalizeTranscriptPromptText(currentText.slice(cursorText.length));
  }

  const overlapLength = getLongestExactTranscriptBoundaryOverlap(cursorText, currentText);
  if (overlapLength > 0) {
    return normalizeTranscriptPromptText(currentText.slice(overlapLength));
  }

  return null;
}

function getDisjointPendingText(currentText, cursorText) {
  if (!currentText) {
    return null;
  }

  if (!cursorText) {
    return currentText;
  }

  if (cursorText.includes(currentText)) {
    return '';
  }

  const cursorIndex = currentText.indexOf(cursorText);
  if (cursorIndex >= 0) {
    return normalizeTranscriptPromptText(
      currentText.slice(cursorIndex + cursorText.length)
    );
  }

  const overlapLength = getLongestExactTranscriptBoundaryOverlap(cursorText, currentText);
  if (overlapLength > 0) {
    return normalizeTranscriptPromptText(currentText.slice(overlapLength));
  }

  const revisedOverlapLength = getLongestRevisedTranscriptBoundaryOverlap(cursorText, currentText);
  if (revisedOverlapLength > 0) {
    return normalizeTranscriptPromptText(currentText.slice(revisedOverlapLength));
  }

  return currentText;
}

function getDisjointCursorResult(currentText, currentEntries, cursorText) {
  const disjointPendingText = getDisjointPendingText(currentText, cursorText);
  if (disjointPendingText === null) {
    return null;
  }

  return createMatchedCursorResult(
    disjointPendingText,
    getPendingTranscriptEntriesFromExactText(currentEntries, disjointPendingText)
  );
}

function getPendingFirstEntryText(pendingText, restText) {
  if (!restText) {
    return pendingText;
  }

  const restSuffix = `\n${restText}`;
  if (!pendingText.endsWith(restSuffix)) {
    return null;
  }

  return normalizeTranscriptPromptText(
    pendingText.slice(0, -restSuffix.length)
  );
}

function getPendingTranscriptEntriesFromExactText(currentEntries, pendingText) {
  const normalizedPendingText = normalizeTranscriptPromptText(pendingText);
  if (!normalizedPendingText || currentEntries.length === 0) {
    return [];
  }

  for (let entryIndex = 0; entryIndex < currentEntries.length; entryIndex += 1) {
    const entriesFromIndex = currentEntries.slice(entryIndex);
    if (getTranscriptTextFromEntries(entriesFromIndex) === normalizedPendingText) {
      return entriesFromIndex;
    }
  }

  for (let entryIndex = 0; entryIndex < currentEntries.length; entryIndex += 1) {
    const currentEntry = currentEntries[entryIndex];
    const followingEntries = currentEntries.slice(entryIndex + 1);
    const followingText = getTranscriptTextFromEntries(followingEntries);
    const firstEntryText = getPendingFirstEntryText(normalizedPendingText, followingText);

    if (!firstEntryText || !currentEntry.sourceText.endsWith(firstEntryText)) {
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

function resolvePendingTranscriptCursor({
  transcriptText = '',
  transcriptEntries = [],
  cursorText = '',
  cursorEntries = [],
  allowDisjointCurrentTranscript = false
} = {}) {
  const normalizedTranscriptEntries = normalizeTranscriptEntriesForCursor(transcriptEntries);
  const normalizedCursorEntries = normalizeTranscriptEntriesForCursor(cursorEntries);
  const currentTranscriptText = normalizeTranscriptPromptText(transcriptText)
    || getTranscriptTextFromEntries(normalizedTranscriptEntries);
  const previousCursorText = normalizeTranscriptPromptText(cursorText)
    || getTranscriptTextFromEntries(normalizedCursorEntries);

  const entryBoundaryResult = getExactEntryBoundaryResult(
    normalizedTranscriptEntries,
    normalizedCursorEntries
  );
  if (entryBoundaryResult) {
    if (
      allowDisjointCurrentTranscript
      && entryBoundaryResult.status === TRANSCRIPT_CURSOR_MISMATCH_STATUS
    ) {
      const disjointCursorResult = getDisjointCursorResult(
        currentTranscriptText,
        normalizedTranscriptEntries,
        previousCursorText
      );
      if (disjointCursorResult) {
        return disjointCursorResult;
      }
    }

    return entryBoundaryResult;
  }

  const pendingText = getExactPendingText(currentTranscriptText, previousCursorText);
  if (pendingText === null) {
    if (allowDisjointCurrentTranscript) {
      const disjointCursorResult = getDisjointCursorResult(
        currentTranscriptText,
        normalizedTranscriptEntries,
        previousCursorText
      );
      if (disjointCursorResult) {
        return disjointCursorResult;
      }
    }

    return createCursorMismatchResult();
  }

  return createMatchedCursorResult(
    pendingText,
    getPendingTranscriptEntriesFromExactText(normalizedTranscriptEntries, pendingText)
  );
}

module.exports = {
  resolvePendingTranscriptCursor
};
