const EventEmitter = require('events');
const { logTranscriptEvent } = require('./transcriptLogger');

const EOS_CHARS = new Set(['.', '?', '!', '\u3002', '\uff1f', '\uff01']);
const GOOGLE_TRANSLATE_URL = 'https://clients5.google.com/translate_a/t';
const TARGET_LANGUAGE = 'ko';
const TRANSLATION_TIMEOUT_MS = 8000;
const TRANSLATION_MAX_CONCURRENT_REQUESTS = 3;
const TRANSLATION_MAX_RETRIES = 2;
const TRANSLATION_RETRY_BASE_DELAY_MS = 500;
const TRANSLATION_CACHE_MAX_ENTRIES = 300;
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

function createAbortError() {
  const error = new Error('The operation was aborted.');
  error.name = 'AbortError';
  return error;
}

function isTransientTranslationError(error) {
  if (!error) {
    return false;
  }

  if (error.code === 'TRANSLATION_TIMEOUT' || error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT') {
    return true;
  }

  if (typeof error.status === 'number') {
    return error.status === 408 || error.status === 429 || error.status >= 500;
  }

  return error.name === 'TypeError';
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
    queuedTranslationText: entry.queuedTranslationText,
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
    this.translationCache = new Map();
    this.translationQueue = [];
    this.activeTranslationCount = 0;
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

    this.translationQueue = [];
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

    if (!this.liveCaptionText.trim()) {
      return this.reset('');
    }

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
      queuedTranslationText: '',
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
    entry.queuedTranslationText = '';
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
    const hasQueuedRequest = Boolean(entry?.queuedTranslationText && entry.queuedTranslationText === entry.sourceText);
    const hasUsableTranslation = Boolean(getUsableTranslationText(entry?.translatedText));
    const isSameQueuedText = Boolean(entry && entry.lastQueuedText === entry.sourceText);
    const shouldSkipSameQueuedText = isSameQueuedText
      && (
        hasActiveRequest
        || hasQueuedRequest
        || hasUsableTranslation
        || entry.status === 'error'
      );

    if (!entry || !entry.sourceText || shouldSkipSameQueuedText) {
      logTranscriptEvent('translation-queue-skipped', {
        sessionGeneration: this.sessionGeneration,
        reason: !entry ? 'missing-entry' : (!entry.sourceText ? 'empty-source-text' : 'same-as-last-queued'),
        hasActiveRequest,
        hasQueuedRequest,
        hasUsableTranslation,
        entry: getEntrySnapshot(entry, this.entries.indexOf(entry))
      });
      return;
    }

    const cachedTranslation = this.getCachedTranslation(entry.sourceText);
    if (cachedTranslation) {
      this.abortEntryTranslation(entry);
      entry.translatedText = cachedTranslation;
      entry.status = 'translated';
      entry.lastQueuedText = entry.sourceText;
      entry.queuedTranslationText = '';
      entry.controller = null;
      logTranscriptEvent('translation-cache-hit', {
        sessionGeneration: this.sessionGeneration,
        entry: getEntrySnapshot(entry, this.entries.indexOf(entry))
      });
      this.emit('updated', this.getPayload());
      return;
    }

    this.abortEntryTranslation(entry);

    entry.status = 'pending';
    entry.lastQueuedText = entry.sourceText;
    entry.queuedTranslationText = entry.sourceText;
    entry.version += 1;

    const entryVersion = entry.version;
    const sessionGeneration = this.sessionGeneration;
    const controller = new AbortController();

    entry.controller = controller;

    logTranscriptEvent('translation-queued', {
      sessionGeneration,
      entryVersion,
      entry: getEntrySnapshot(entry, this.entries.indexOf(entry)),
      timeoutMs: TRANSLATION_TIMEOUT_MS
    });

    this.translationQueue.push({
      entry,
      entryVersion,
      sessionGeneration,
      sourceText: entry.sourceText,
      controller
    });
    this.processTranslationQueue();
  }

  processTranslationQueue() {
    while (
      this.activeTranslationCount < TRANSLATION_MAX_CONCURRENT_REQUESTS
      && this.translationQueue.length > 0
    ) {
      const task = this.translationQueue.shift();
      if (!task || task.controller.signal.aborted) {
        continue;
      }

      if (!this.isCurrentTranslation(task.entry, task.entryVersion, task.sessionGeneration)) {
        logTranscriptEvent('translation-queued-task-ignored-stale', {
          sessionGeneration: task.sessionGeneration,
          entryVersion: task.entryVersion,
          entry: getEntrySnapshot(task.entry, this.entries.indexOf(task.entry)),
          currentSessionGeneration: this.sessionGeneration
        });
        continue;
      }

      this.activeTranslationCount += 1;
      void this.runTranslationTask(task)
        .catch((error) => {
          console.error('[ERROR] Translation task failed unexpectedly:', error);
        })
        .finally(() => {
          this.activeTranslationCount = Math.max(0, this.activeTranslationCount - 1);
          this.processTranslationQueue();
        });
    }
  }

  async runTranslationTask(task) {
    const { entry, entryVersion, sessionGeneration, sourceText, controller } = task;

    try {
      const translatedText = await this.translateWithGoogle(sourceText, controller.signal);
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
      entry.queuedTranslationText = '';
      logTranscriptEvent('translation-succeeded', {
        sessionGeneration,
        entryVersion,
        translatedText,
        entry: getEntrySnapshot(entry, this.entries.indexOf(entry))
      });
      this.emit('updated', this.getPayload());
    } catch (error) {
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

      if (error?.name === 'AbortError' && controller.signal.aborted) {
        logTranscriptEvent('translation-aborted', {
          sessionGeneration,
          entryVersion,
          entry: getEntrySnapshot(entry, this.entries.indexOf(entry))
        });
        return;
      }

      entry.translatedText = error?.code === 'TRANSLATION_TIMEOUT'
        ? '[ERROR] Translation Failed: request timed out (> 8 seconds).'
        : `[ERROR] Translation Failed: ${error?.message || String(error)}`;
      entry.status = 'error';
      entry.controller = null;
      entry.queuedTranslationText = '';
      logTranscriptEvent('translation-failed', {
        sessionGeneration,
        entryVersion,
        timedOut: error?.code === 'TRANSLATION_TIMEOUT',
        error,
        entry: getEntrySnapshot(entry, this.entries.indexOf(entry))
      });
      this.emit('updated', this.getPayload());
    }
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
      entry.queuedTranslationText = '';
    }
  }

  clearPartialIdleTimer() {
    if (this.partialIdleTimer) {
      clearTimeout(this.partialIdleTimer);
      this.partialIdleTimer = null;
    }
  }

  getTranslationCacheKey(text) {
    return normalizeSegmentText(text).toLowerCase();
  }

  getCachedTranslation(text) {
    const key = this.getTranslationCacheKey(text);
    if (!key || !this.translationCache.has(key)) {
      return null;
    }

    const translatedText = this.translationCache.get(key);
    this.translationCache.delete(key);
    this.translationCache.set(key, translatedText);
    return translatedText;
  }

  setCachedTranslation(text, translatedText) {
    const key = this.getTranslationCacheKey(text);
    const translation = getUsableTranslationText(translatedText);
    if (!key || !translation) {
      return;
    }

    if (this.translationCache.has(key)) {
      this.translationCache.delete(key);
    }

    this.translationCache.set(key, translation);

    while (this.translationCache.size > TRANSLATION_CACHE_MAX_ENTRIES) {
      const oldestKey = this.translationCache.keys().next().value;
      if (!oldestKey) {
        break;
      }
      this.translationCache.delete(oldestKey);
    }
  }

  sleepWithAbort(delayMs, signal) {
    if (signal?.aborted) {
      return Promise.reject(createAbortError());
    }

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        cleanup();
        resolve();
      }, delayMs);

      const abort = () => {
        cleanup();
        reject(createAbortError());
      };

      const cleanup = () => {
        clearTimeout(timeout);
        signal?.removeEventListener?.('abort', abort);
      };

      signal?.addEventListener?.('abort', abort, { once: true });
    });
  }

  async translateWithGoogle(text, signal) {
    const cachedTranslation = this.getCachedTranslation(text);
    if (cachedTranslation) {
      return cachedTranslation;
    }

    const errors = [];
    let hadTimeoutFailure = false;
    for (let attempt = 0; attempt <= TRANSLATION_MAX_RETRIES; attempt += 1) {
      let transientFailure = false;

      for (const sourceLanguage of ['auto', 'en']) {
        try {
          const translatedText = await this.fetchGoogleTranslation(text, sourceLanguage, signal);
          this.setCachedTranslation(text, translatedText);
          return translatedText;
        } catch (error) {
          if (signal?.aborted) {
            throw error;
          }

          transientFailure = transientFailure || isTransientTranslationError(error);
          hadTimeoutFailure = hadTimeoutFailure || error?.code === 'TRANSLATION_TIMEOUT';
          errors.push(`${sourceLanguage}: ${error?.message || String(error)}`);
          logTranscriptEvent('translation-provider-attempt-failed', {
            sessionGeneration: this.sessionGeneration,
            sourceLanguage,
            attempt,
            text,
            transient: isTransientTranslationError(error),
            error
          });
        }
      }

      if (attempt < TRANSLATION_MAX_RETRIES && transientFailure) {
        const backoffMs = TRANSLATION_RETRY_BASE_DELAY_MS * (2 ** attempt);
        logTranscriptEvent('translation-provider-retry-scheduled', {
          sessionGeneration: this.sessionGeneration,
          attempt,
          backoffMs,
          text,
        });
        await this.sleepWithAbort(backoffMs, signal);
        continue;
      }

      break;
    }

    const error = new Error(`Google Translate returned no usable translation. ${errors.join(' | ')}`);
    if (hadTimeoutFailure) {
      error.code = 'TRANSLATION_TIMEOUT';
    }
    throw error;
  }

  async fetchGoogleTranslation(text, sourceLanguage, signal) {
    const url = new URL(GOOGLE_TRANSLATE_URL);
    url.searchParams.set('client', 'dict-chrome-ex');
    url.searchParams.set('sl', sourceLanguage);
    url.searchParams.set('tl', TARGET_LANGUAGE);
    url.searchParams.set('q', text);

    const controller = new AbortController();
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, TRANSLATION_TIMEOUT_MS);

    const abort = () => {
      controller.abort();
    };

    if (signal?.aborted) {
      clearTimeout(timeout);
      throw createAbortError();
    }

    signal?.addEventListener?.('abort', abort, { once: true });

    try {
      const response = await fetch(url.toString(), { signal: controller.signal });
      if (!response.ok) {
        const error = new Error(`HTTP Error - ${response.status}`);
        error.status = response.status;
        throw error;
      }

      return extractGoogleTranslation(await response.text());
    } catch (error) {
      if (timedOut && error?.name === 'AbortError') {
        const timeoutError = new Error(`request timed out (> ${Math.round(TRANSLATION_TIMEOUT_MS / 1000)} seconds)`);
        timeoutError.code = 'TRANSLATION_TIMEOUT';
        throw timeoutError;
      }

      throw error;
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener?.('abort', abort);
    }
  }
}

module.exports = new TranslationManager();
