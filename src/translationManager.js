const EventEmitter = require('events');

const EOS_CHARS = new Set(['.', '?', '!', '\u3002', '\uff1f', '\uff01']);
const GOOGLE_TRANSLATE_URL = 'https://clients5.google.com/translate_a/t';
const TARGET_LANGUAGE = 'ko';
const TRANSLATION_TIMEOUT_MS = 8000;
const PARTIAL_MIN_LENGTH = 10;
const PARTIAL_CHANGE_THRESHOLD = 3;
const PARTIAL_IDLE_MS = 700;
const RECONCILE_MIN_LOOKBACK = 12;
const RECONCILE_EXTRA_LOOKBACK = 4;

function normalizeSegmentText(text) {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function getByteLength(text) {
  return Buffer.byteLength(String(text || ''), 'utf8');
}

function parseCaptionSegments(fullText) {
  const text = String(fullText || '')
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

function extractGoogleTranslation(responseBody) {
  const parsed = JSON.parse(responseBody);

  if (Array.isArray(parsed)) {
    if (Array.isArray(parsed[0]) && typeof parsed[0][0] === 'string') {
      return parsed[0][0];
    }

    if (
      Array.isArray(parsed[0])
      && Array.isArray(parsed[0][0])
      && typeof parsed[0][0][0] === 'string'
    ) {
      return parsed[0][0][0];
    }
  }

  const stack = [parsed];
  while (stack.length > 0) {
    const value = stack.shift();
    if (typeof value === 'string' && value.trim()) {
      return value;
    }

    if (Array.isArray(value)) {
      stack.unshift(...value);
    } else if (value && typeof value === 'object') {
      stack.unshift(...Object.values(value));
    }
  }

  throw new Error('Unexpected Google Translate response format.');
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
    this.sessionGeneration += 1;
    this.liveCaptionText = String(fullText || '');
    this.entryCounter = 0;
    this.clearPartialIdleTimer();

    for (const entry of this.entries) {
      this.abortEntryTranslation(entry);
    }

    this.entries = [];
    return this.getPayload();
  }

  update(fullText) {
    this.liveCaptionText = String(fullText || '');
    const segments = parseCaptionSegments(this.liveCaptionText);
    this.reconcileEntries(segments);
    this.queueTranslations();
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
    entry.changeCount = 0;
  }

  getReconcileSearchStart(segmentCount) {
    const lookback = Math.max(RECONCILE_MIN_LOOKBACK, segmentCount + RECONCILE_EXTRA_LOOKBACK);
    return Math.max(0, this.entries.length - lookback);
  }

  findMatchingEntry(segment, startIndex) {
    for (let index = startIndex; index < this.entries.length; index += 1) {
      const entry = this.entries[index];
      if (!entry) {
        continue;
      }

      if (entry.sourceText === segment.sourceText) {
        return {
          entry,
          index,
          isRevision: false
        };
      }

      if (isLikelyRevision(entry.sourceText, segment.sourceText)) {
        return {
          entry,
          index,
          isRevision: true
        };
      }
    }

    return null;
  }

  reconcileSegment(segment, startIndex) {
    const match = this.findMatchingEntry(segment, startIndex);

    if (match) {
      if (match.isRevision) {
        this.updateEntryFromSegment(match.entry, segment);
      } else if (match.entry.isFinal !== segment.isFinal) {
        match.entry.isFinal = segment.isFinal;
      }

      return {
        entry: match.entry,
        nextStartIndex: match.index + 1
      };
    }

    const entry = this.createEntry(segment);
    this.entries.push(entry);
    return {
      entry,
      nextStartIndex: this.entries.length
    };
  }

  reconcileEntries(segments) {
    const previousPartial = this.entries.length > 0 && !this.entries[this.entries.length - 1].isFinal
      ? this.entries[this.entries.length - 1]
      : null;
    const touchedEntries = new Set();
    let nextStartIndex = this.getReconcileSearchStart(segments.length);

    for (const segment of segments) {
      const result = this.reconcileSegment(segment, nextStartIndex);
      touchedEntries.add(result.entry);
      nextStartIndex = result.nextStartIndex;
    }

    if (
      previousPartial
      && !touchedEntries.has(previousPartial)
      && this.entries.includes(previousPartial)
      && !previousPartial.isFinal
    ) {
      this.abortEntryTranslation(previousPartial);
      this.entries = this.entries.filter((entry) => entry !== previousPartial);
    }
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
      this.queueEntryTranslation(partialEntry);
      return;
    }

    this.partialIdleTimer = setTimeout(() => {
      this.partialIdleTimer = null;
      const latestPartialEntry = this.entries[this.entries.length - 1];
      if (
        latestPartialEntry
        && !latestPartialEntry.isFinal
        && getByteLength(latestPartialEntry.sourceText) >= PARTIAL_MIN_LENGTH
      ) {
        this.queueEntryTranslation(latestPartialEntry);
      }
    }, PARTIAL_IDLE_MS);
  }

  queueEntryTranslation(entry) {
    if (!entry || !entry.sourceText || entry.lastQueuedText === entry.sourceText) {
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

    this.translateWithGoogle(entry.sourceText, controller.signal)
      .then((translatedText) => {
        if (!this.isCurrentTranslation(entry, entryVersion, sessionGeneration)) {
          return;
        }

        entry.translatedText = translatedText;
        entry.status = 'translated';
        entry.controller = null;
        this.emit('updated', this.getPayload());
      })
      .catch((error) => {
        if (!this.isCurrentTranslation(entry, entryVersion, sessionGeneration)) {
          return;
        }

        if (error?.name === 'AbortError' && !timedOut) {
          return;
        }

        entry.translatedText = timedOut
          ? '[ERROR] Translation Failed: request timed out (> 8 seconds).'
          : `[ERROR] Translation Failed: ${error?.message || String(error)}`;
        entry.status = 'error';
        entry.controller = null;
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
    const url = new URL(GOOGLE_TRANSLATE_URL);
    url.searchParams.set('client', 'dict-chrome-ex');
    url.searchParams.set('sl', 'auto');
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
