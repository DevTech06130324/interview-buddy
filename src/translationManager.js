const EventEmitter = require('events');
const { logTranscriptEvent } = require('./transcriptLogger');

const EOS_CHARS = new Set(['.', '?', '!', '\u3002', '\uff1f', '\uff01']);
const GOOGLE_TRANSLATE_URL = 'https://clients5.google.com/translate_a/t';
const TARGET_LANGUAGE = 'ko';
const TRANSLATION_TIMEOUT_MS = 8000;
const PARTIAL_MIN_LENGTH = 10;
const PARTIAL_CHANGE_THRESHOLD = 3;
const PARTIAL_IDLE_MS = 700;
const RECONCILE_MIN_LOOKBACK = 12;
const RECONCILE_EXTRA_LOOKBACK = 4;
const CONTROL_CHARS_EXCEPT_WHITESPACE_PATTERN = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

function sanitizeCaptionText(text) {
  return String(text || '').replace(CONTROL_CHARS_EXCEPT_WHITESPACE_PATTERN, '');
}

function normalizeSegmentText(text) {
  return sanitizeCaptionText(text)
    .replace(/\s+/g, ' ')
    .trim();
}

function getByteLength(text) {
  return Buffer.byteLength(String(text || ''), 'utf8');
}

function getUsableTranslationText(text) {
  const value = typeof text === 'string' ? text.trim() : '';
  return value || null;
}

function parseCaptionSegments(fullText) {
  const text = sanitizeCaptionText(fullText)
    .replace(/\r\n?/g, '\n')
    .trim();

  if (!text) {
    return [];
  }

  const segments = [];
  let startIndex = 0;

  for (let index = 0; index < text.length; index += 1) {
    if (!EOS_CHARS.has(text[index])) {
      continue;
    }

    const sourceText = normalizeSegmentText(text.slice(startIndex, index + 1));
    if (sourceText) {
      segments.push({
        sourceText,
        isFinal: true
      });
    }

    startIndex = index + 1;
  }

  const partialText = normalizeSegmentText(text.slice(startIndex));
  if (partialText) {
    segments.push({
      sourceText: partialText,
      isFinal: false
    });
  }

  return segments;
}

function getRevisionComparableText(text) {
  return normalizeSegmentText(text)
    .replace(/[.!?\u3002\uff1f\uff01]+$/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .toLowerCase();
}

function isLikelyRevision(previousText, nextText) {
  const previous = getRevisionComparableText(previousText);
  const next = getRevisionComparableText(nextText);

  if (!previous || !next) {
    return false;
  }

  if (previous === next) {
    return normalizeSegmentText(previousText) !== normalizeSegmentText(nextText);
  }

  return next.length > previous.length && next.startsWith(previous);
}

function isLikelySplitRevision(previousText, nextText, hasFollowingSegment) {
  if (!hasFollowingSegment) {
    return false;
  }

  const previous = getRevisionComparableText(previousText);
  const next = getRevisionComparableText(nextText);

  if (!previous || !next || previous === next) {
    return false;
  }

  return previous.length > next.length + 8 && previous.startsWith(next);
}

function isLikelySuffixDuplicate(previousText, nextText) {
  const previous = getRevisionComparableText(previousText);
  const next = getRevisionComparableText(nextText);

  if (!previous || !next || previous === next || next.length < 12) {
    return false;
  }

  return previous.endsWith(next);
}

function extractGoogleTranslation(responseBody) {
  const parsed = JSON.parse(responseBody);
  const candidates = [];

  if (Array.isArray(parsed)) {
    if (typeof parsed[0] === 'string') {
      candidates.push(parsed[0]);
    }

    if (Array.isArray(parsed[0]) && typeof parsed[0][0] === 'string') {
      candidates.push(parsed[0][0]);
    }

    if (Array.isArray(parsed[0])) {
      const joinedTranslation = parsed[0]
        .filter((value) => Array.isArray(value) && typeof value[0] === 'string')
        .map((value) => value[0])
        .join('');
      candidates.push(joinedTranslation);
    }

    if (
      Array.isArray(parsed[0])
      && Array.isArray(parsed[0][0])
      && typeof parsed[0][0][0] === 'string'
    ) {
      candidates.push(parsed[0][0][0]);
    }
  }

  for (const candidate of candidates) {
    const translation = getUsableTranslationText(candidate);
    if (translation) {
      return translation;
    }
  }

  throw new Error('Google Translate returned an empty translation.');
}

function getEntrySnapshot(entry, index = null) {
  if (!entry) {
    return null;
  }

  return {
    index,
    id: entry.id,
    sourceText: entry.sourceText,
    translatedText: entry.translatedText,
    status: entry.status,
    isFinal: entry.isFinal,
    version: entry.version,
    lastQueuedText: entry.lastQueuedText,
    changeCount: entry.changeCount
  };
}

function getEntrySnapshots(entries) {
  return entries.map((entry, index) => getEntrySnapshot(entry, index));
}

function getSegmentSnapshot(segment, index = null) {
  if (!segment) {
    return null;
  }

  return {
    index,
    sourceText: segment.sourceText,
    isFinal: segment.isFinal
  };
}

function getSegmentSnapshots(segments) {
  return segments.map((segment, index) => getSegmentSnapshot(segment, index));
}

class TranslationManager extends EventEmitter {
  constructor() {
    super();
    this.entries = [];
    this.liveCaptionText = '';
    this.sessionGeneration = 0;
    this.entryCounter = 0;
    this.partialIdleTimer = null;
  }

  getPayload() {
    return {
      fullText: this.getSessionTranscriptText(),
      entries: this.entries.map((entry) => ({
        id: entry.id,
        sourceText: entry.sourceText,
        translatedText: entry.translatedText,
        status: entry.status,
        isFinal: entry.isFinal
      }))
    };
  }

  reset(fullText = '') {
    const entriesBefore = getEntrySnapshots(this.entries);
    const requestedFullText = String(fullText || '');
    this.sessionGeneration += 1;
    this.liveCaptionText = sanitizeCaptionText(requestedFullText);
    this.entryCounter = 0;
    this.clearPartialIdleTimer();

    logTranscriptEvent('translation-manager-reset-started', {
      sessionGeneration: this.sessionGeneration,
      requestedFullText,
      sanitizedFullText: this.liveCaptionText,
      entriesBefore
    });

    for (const entry of this.entries) {
      this.abortEntryTranslation(entry);
    }

    this.entries = [];
    logTranscriptEvent('translation-manager-reset-completed', {
      sessionGeneration: this.sessionGeneration,
      payload: this.getPayload()
    });
    return this.getPayload();
  }

  update(fullText) {
    const rawLiveCaptionText = String(fullText || '');
    this.liveCaptionText = sanitizeCaptionText(rawLiveCaptionText);
    const segments = parseCaptionSegments(this.liveCaptionText);
    logTranscriptEvent('translation-manager-update-started', {
      sessionGeneration: this.sessionGeneration,
      rawLiveCaptionText,
      liveCaptionText: this.liveCaptionText,
      parsedSegments: getSegmentSnapshots(segments),
      entriesBefore: getEntrySnapshots(this.entries),
      panelFullTextBefore: this.getSessionTranscriptText()
    });
    this.reconcileEntries(segments);
    this.queueTranslations();
    logTranscriptEvent('translation-manager-update-completed', {
      sessionGeneration: this.sessionGeneration,
      entriesAfter: getEntrySnapshots(this.entries),
      panelFullTextAfter: this.getSessionTranscriptText()
    });
    return this.getPayload();
  }

  getSessionTranscriptText() {
    return this.entries.map((entry) => entry.sourceText).join('\n');
  }

  createEntry(segment, previousPartial = null) {
    return {
      id: `caption-${this.sessionGeneration}-${this.entryCounter++}`,
      sourceText: segment.sourceText,
      translatedText: previousPartial?.translatedText || '',
      status: 'pending',
      isFinal: segment.isFinal,
      version: (previousPartial?.version || 0) + 1,
      lastQueuedText: '',
      changeCount: (previousPartial?.changeCount || 0) + 1,
      controller: null
    };
  }

  updateEntryFromSegment(entry, segment) {
    this.abortEntryTranslation(entry);
    entry.sourceText = segment.sourceText;
    entry.isFinal = segment.isFinal;
    entry.status = 'pending';
    entry.version += 1;
    entry.lastQueuedText = '';
    entry.changeCount = segment.isFinal ? 0 : (entry.changeCount || 0) + 1;
  }

  getReconcileSearchStart(segmentCount) {
    const lookback = Math.max(RECONCILE_MIN_LOOKBACK, segmentCount + RECONCILE_EXTRA_LOOKBACK);
    return Math.max(0, this.entries.length - lookback);
  }

  getSegmentEntryAlignmentScore(entry, segment, segmentIndex, segmentCount) {
    if (!entry || !segment) {
      return 0;
    }

    if (entry.sourceText === segment.sourceText) {
      return 8;
    }

    const entryText = getRevisionComparableText(entry.sourceText);
    const segmentText = getRevisionComparableText(segment.sourceText);
    if (entryText && segmentText && entryText === segmentText) {
      return 6;
    }

    const isFirstSegment = segmentIndex === 0;
    const isLastSegment = segmentIndex === segmentCount - 1;
    if (isFirstSegment && isLikelySplitRevision(entry.sourceText, segment.sourceText, segmentCount > 1)) {
      return 4;
    }

    if (isLastSegment && isLikelyRevision(entry.sourceText, segment.sourceText)) {
      return 3;
    }

    return 0;
  }

  findBestReconcileSearchStart(segments) {
    const fallbackStartIndex = this.getReconcileSearchStart(segments.length);
    if (segments.length < 2 || this.entries.length === 0) {
      return fallbackStartIndex;
    }

    let bestMatch = null;

    for (let entryStartIndex = 0; entryStartIndex < this.entries.length; entryStartIndex += 1) {
      let score = 0;
      let matchedCount = 0;

      for (
        let segmentIndex = 0;
        segmentIndex < segments.length && entryStartIndex + segmentIndex < this.entries.length;
        segmentIndex += 1
      ) {
        const alignmentScore = this.getSegmentEntryAlignmentScore(
          this.entries[entryStartIndex + segmentIndex],
          segments[segmentIndex],
          segmentIndex,
          segments.length
        );

        if (alignmentScore === 0) {
          break;
        }

        score += alignmentScore;
        matchedCount += 1;
      }

      if (matchedCount === 0) {
        continue;
      }

      const candidate = {
        index: entryStartIndex,
        score,
        matchedCount
      };

      if (
        !bestMatch
        || candidate.score > bestMatch.score
        || (
          candidate.score === bestMatch.score
          && candidate.matchedCount > bestMatch.matchedCount
        )
        || (
          candidate.score === bestMatch.score
          && candidate.matchedCount === bestMatch.matchedCount
          && candidate.index > bestMatch.index
        )
      ) {
        bestMatch = candidate;
      }
    }

    if (!bestMatch || bestMatch.score < 8) {
      logTranscriptEvent('translation-reconcile-alignment', {
        sessionGeneration: this.sessionGeneration,
        selectedStartIndex: fallbackStartIndex,
        fallbackStartIndex,
        reason: bestMatch ? 'low-confidence' : 'no-match',
        bestMatch,
        segmentCount: segments.length,
        entryCount: this.entries.length
      });
      return fallbackStartIndex;
    }

    logTranscriptEvent('translation-reconcile-alignment', {
      sessionGeneration: this.sessionGeneration,
      selectedStartIndex: bestMatch.index,
      fallbackStartIndex,
      reason: 'anchored-window',
      bestMatch,
      segmentCount: segments.length,
      entryCount: this.entries.length
    });
    return bestMatch.index;
  }

  findMatchingEntry(segment, startIndex, hasFollowingSegment) {
    for (let index = startIndex; index < this.entries.length; index += 1) {
      const entry = this.entries[index];
      if (!entry) {
        continue;
      }

      if (entry.sourceText === segment.sourceText) {
        return {
          entry,
          index,
          matchType: 'exact'
        };
      }

      if (isLikelyRevision(entry.sourceText, segment.sourceText)) {
        return {
          entry,
          index,
          matchType: 'growing-revision',
          updateSourceText: true
        };
      }

      if (isLikelySplitRevision(entry.sourceText, segment.sourceText, hasFollowingSegment)) {
        return {
          entry,
          index,
          matchType: 'split-revision',
          updateSourceText: true
        };
      }
    }

    return null;
  }

  reconcileSegment(segment, startIndex, hasFollowingSegment, previousSegmentEntry = null) {
    if (previousSegmentEntry && isLikelySuffixDuplicate(previousSegmentEntry.sourceText, segment.sourceText)) {
      logTranscriptEvent('translation-reconcile-decision', {
        sessionGeneration: this.sessionGeneration,
        action: 'skip-suffix-duplicate',
        segment: getSegmentSnapshot(segment),
        previousSegmentEntry: getEntrySnapshot(previousSegmentEntry),
        startIndex
      });
      return {
        entry: previousSegmentEntry,
        nextStartIndex: startIndex
      };
    }

    const match = this.findMatchingEntry(segment, startIndex, hasFollowingSegment);

    if (match) {
      const entryBefore = getEntrySnapshot(match.entry, match.index);
      if (match.updateSourceText) {
        this.updateEntryFromSegment(match.entry, segment);
      } else if (match.entry.isFinal !== segment.isFinal) {
        match.entry.isFinal = segment.isFinal;
      }

      logTranscriptEvent('translation-reconcile-decision', {
        sessionGeneration: this.sessionGeneration,
        action: match.updateSourceText ? 'update-existing' : 'match-existing',
        matchType: match.matchType,
        startIndex,
        matchIndex: match.index,
        hasFollowingSegment,
        segment: getSegmentSnapshot(segment),
        entryBefore,
        entryAfter: getEntrySnapshot(match.entry, match.index)
      });

      return {
        entry: match.entry,
        nextStartIndex: match.index + 1
      };
    }

    const insertIndex = Math.min(startIndex, this.entries.length);
    const entry = this.createEntry(segment);
    this.entries.splice(insertIndex, 0, entry);
    logTranscriptEvent('translation-reconcile-decision', {
      sessionGeneration: this.sessionGeneration,
      action: 'insert-new',
      startIndex,
      insertIndex,
      hasFollowingSegment,
      segment: getSegmentSnapshot(segment),
      entryAfter: getEntrySnapshot(entry, insertIndex)
    });
    return {
      entry,
      nextStartIndex: insertIndex + 1
    };
  }

  reconcileEntries(segments) {
    const previousPartial = this.entries.length > 0 && !this.entries[this.entries.length - 1].isFinal
      ? this.entries[this.entries.length - 1]
      : null;
    const touchedEntries = new Set();
    let nextStartIndex = this.findBestReconcileSearchStart(segments);
    const windowStartIndex = nextStartIndex;
    let previousSegmentEntry = null;

    logTranscriptEvent('translation-reconcile-started', {
      sessionGeneration: this.sessionGeneration,
      searchStartIndex: nextStartIndex,
      previousPartial: getEntrySnapshot(previousPartial),
      segments: getSegmentSnapshots(segments),
      entriesBefore: getEntrySnapshots(this.entries)
    });

    for (let index = 0; index < segments.length; index += 1) {
      const result = this.reconcileSegment(
        segments[index],
        nextStartIndex,
        index < segments.length - 1,
        previousSegmentEntry
      );
      touchedEntries.add(result.entry);
      nextStartIndex = result.nextStartIndex;
      previousSegmentEntry = result.entry;
    }

    if (
      previousPartial
      && !touchedEntries.has(previousPartial)
      && this.entries.includes(previousPartial)
      && !previousPartial.isFinal
    ) {
      this.abortEntryTranslation(previousPartial);
      this.entries = this.entries.filter((entry) => entry !== previousPartial);
      logTranscriptEvent('translation-reconcile-decision', {
        sessionGeneration: this.sessionGeneration,
        action: 'remove-untouched-partial',
        previousPartial: getEntrySnapshot(previousPartial)
      });
    }

    if (segments.length > 0) {
      const removedEntries = [];
      this.entries = this.entries.filter((entry, index) => {
        const shouldKeep = index < windowStartIndex || touchedEntries.has(entry);
        if (!shouldKeep) {
          this.abortEntryTranslation(entry);
          removedEntries.push(getEntrySnapshot(entry, index));
        }
        return shouldKeep;
      });

      if (removedEntries.length > 0) {
        logTranscriptEvent('translation-reconcile-decision', {
          sessionGeneration: this.sessionGeneration,
          action: 'remove-stale-window-entries',
          windowStartIndex,
          removedEntries
        });
      }
    }

    logTranscriptEvent('translation-reconcile-completed', {
      sessionGeneration: this.sessionGeneration,
      entriesAfter: getEntrySnapshots(this.entries)
    });
  }

  queueTranslations() {
    this.clearPartialIdleTimer();

    for (const entry of this.entries) {
      if (entry.isFinal) {
        this.queueEntryTranslation(entry);
      }
    }

    const partialEntry = this.entries[this.entries.length - 1];
    if (!partialEntry || partialEntry.isFinal || getByteLength(partialEntry.sourceText) < PARTIAL_MIN_LENGTH) {
      return;
    }

    if (partialEntry.changeCount >= PARTIAL_CHANGE_THRESHOLD) {
      partialEntry.changeCount = 0;
      logTranscriptEvent('translation-partial-queued-by-change-count', {
        sessionGeneration: this.sessionGeneration,
        entry: getEntrySnapshot(partialEntry, this.entries.length - 1),
        partialChangeThreshold: PARTIAL_CHANGE_THRESHOLD
      });
      this.queueEntryTranslation(partialEntry);
      return;
    }

    logTranscriptEvent('translation-partial-idle-timer-scheduled', {
      sessionGeneration: this.sessionGeneration,
      entry: getEntrySnapshot(partialEntry, this.entries.length - 1),
      partialIdleMs: PARTIAL_IDLE_MS
    });

    this.partialIdleTimer = setTimeout(() => {
      this.partialIdleTimer = null;
      const latestPartialEntry = this.entries[this.entries.length - 1];
      if (
        latestPartialEntry
        && !latestPartialEntry.isFinal
        && getByteLength(latestPartialEntry.sourceText) >= PARTIAL_MIN_LENGTH
      ) {
        logTranscriptEvent('translation-partial-queued-by-idle', {
          sessionGeneration: this.sessionGeneration,
          entry: getEntrySnapshot(latestPartialEntry, this.entries.length - 1)
        });
        this.queueEntryTranslation(latestPartialEntry);
      }
    }, PARTIAL_IDLE_MS);
  }

  queueEntryTranslation(entry) {
    const hasActiveRequest = Boolean(entry?.controller && !entry.controller.signal.aborted);
    const hasUsableTranslation = Boolean(getUsableTranslationText(entry?.translatedText));
    const isSameQueuedText = Boolean(entry && entry.lastQueuedText === entry.sourceText);
    const shouldSkipSameQueuedText = isSameQueuedText
      && (
        hasActiveRequest
        || hasUsableTranslation
        || entry.status === 'error'
      );

    if (!entry || !entry.sourceText || shouldSkipSameQueuedText) {
      logTranscriptEvent('translation-queue-skipped', {
        sessionGeneration: this.sessionGeneration,
        reason: !entry ? 'missing-entry' : (!entry.sourceText ? 'empty-source-text' : 'same-as-last-queued'),
        hasActiveRequest,
        hasUsableTranslation,
        entry: getEntrySnapshot(entry, this.entries.indexOf(entry))
      });
      return;
    }

    this.abortEntryTranslation(entry);

    entry.status = 'pending';
    entry.lastQueuedText = entry.sourceText;
    entry.version += 1;

    const entryVersion = entry.version;
    const sessionGeneration = this.sessionGeneration;
    const controller = new AbortController();
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, TRANSLATION_TIMEOUT_MS);

    entry.controller = controller;

    logTranscriptEvent('translation-queued', {
      sessionGeneration,
      entryVersion,
      entry: getEntrySnapshot(entry, this.entries.indexOf(entry)),
      timeoutMs: TRANSLATION_TIMEOUT_MS
    });

    this.translateWithGoogle(entry.sourceText, controller.signal)
      .then((translatedText) => {
        if (!this.isCurrentTranslation(entry, entryVersion, sessionGeneration)) {
          logTranscriptEvent('translation-result-ignored-stale', {
            sessionGeneration,
            entryVersion,
            translatedText,
            entry: getEntrySnapshot(entry, this.entries.indexOf(entry)),
            currentSessionGeneration: this.sessionGeneration
          });
          return;
        }

        entry.translatedText = translatedText;
        entry.status = 'translated';
        entry.controller = null;
        logTranscriptEvent('translation-succeeded', {
          sessionGeneration,
          entryVersion,
          translatedText,
          entry: getEntrySnapshot(entry, this.entries.indexOf(entry))
        });
        this.emit('updated', this.getPayload());
      })
      .catch((error) => {
        if (!this.isCurrentTranslation(entry, entryVersion, sessionGeneration)) {
          logTranscriptEvent('translation-error-ignored-stale', {
            sessionGeneration,
            entryVersion,
            error,
            entry: getEntrySnapshot(entry, this.entries.indexOf(entry)),
            currentSessionGeneration: this.sessionGeneration
          });
          return;
        }

        if (error?.name === 'AbortError' && !timedOut) {
          logTranscriptEvent('translation-aborted', {
            sessionGeneration,
            entryVersion,
            entry: getEntrySnapshot(entry, this.entries.indexOf(entry))
          });
          return;
        }

        entry.translatedText = timedOut
          ? '[ERROR] Translation Failed: request timed out (> 8 seconds).'
          : `[ERROR] Translation Failed: ${error?.message || String(error)}`;
        entry.status = 'error';
        entry.controller = null;
        logTranscriptEvent('translation-failed', {
          sessionGeneration,
          entryVersion,
          timedOut,
          error,
          entry: getEntrySnapshot(entry, this.entries.indexOf(entry))
        });
        this.emit('updated', this.getPayload());
      })
      .finally(() => {
        clearTimeout(timeout);
      });
  }

  isCurrentTranslation(entry, entryVersion, sessionGeneration) {
    return this.sessionGeneration === sessionGeneration
      && this.entries.includes(entry)
      && entry.version === entryVersion;
  }

  abortEntryTranslation(entry) {
    if (entry?.controller && !entry.controller.signal.aborted) {
      logTranscriptEvent('translation-abort-requested', {
        sessionGeneration: this.sessionGeneration,
        entry: getEntrySnapshot(entry, this.entries.indexOf(entry))
      });
      entry.controller.abort();
    }

    if (entry) {
      entry.controller = null;
    }
  }

  clearPartialIdleTimer() {
    if (this.partialIdleTimer) {
      clearTimeout(this.partialIdleTimer);
      this.partialIdleTimer = null;
    }
  }

  async translateWithGoogle(text, signal) {
    const errors = [];
    for (const sourceLanguage of ['auto', 'en']) {
      try {
        return await this.fetchGoogleTranslation(text, sourceLanguage, signal);
      } catch (error) {
        if (signal?.aborted) {
          throw error;
        }

        errors.push(`${sourceLanguage}: ${error?.message || String(error)}`);
        logTranscriptEvent('translation-provider-attempt-failed', {
          sessionGeneration: this.sessionGeneration,
          sourceLanguage,
          text,
          error
        });
      }
    }

    throw new Error(`Google Translate returned no usable translation. ${errors.join(' | ')}`);
  }

  async fetchGoogleTranslation(text, sourceLanguage, signal) {
    const url = new URL(GOOGLE_TRANSLATE_URL);
    url.searchParams.set('client', 'dict-chrome-ex');
    url.searchParams.set('sl', sourceLanguage);
    url.searchParams.set('tl', TARGET_LANGUAGE);
    url.searchParams.set('q', text);

    const response = await fetch(url.toString(), { signal });
    if (!response.ok) {
      throw new Error(`HTTP Error - ${response.status}`);
    }

    return extractGoogleTranslation(await response.text());
  }
}

module.exports = new TranslationManager();
