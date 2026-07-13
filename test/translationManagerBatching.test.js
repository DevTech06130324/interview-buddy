const test = require('node:test');
const assert = require('node:assert/strict');

const translationManager = require('../src/translationManager');

function resetTranslationManager() {
  translationManager.removeAllListeners('updated');
  translationManager.reset('');
  translationManager.setTranslationEnabled(false);
  translationManager.translationCache.clear();
  translationManager.translationQueue = [];
}

test('cached translations emit one consolidated update while caption text is reconciled', () => {
  resetTranslationManager();
  translationManager.setTranslationEnabled(true);
  translationManager.setCachedTranslation('First sentence.', '첫 번째 문장');
  translationManager.setCachedTranslation('Second sentence.', '두 번째 문장');

  const updates = [];
  translationManager.on('updated', (payload) => updates.push(payload));

  const payload = translationManager.update('First sentence. Second sentence.');

  assert.equal(updates.length, 1);
  assert.deepEqual(
    updates[0].entries.map(({ sourceText, translatedText, status }) => ({ sourceText, translatedText, status })),
    [
      { sourceText: 'First sentence.', translatedText: '첫 번째 문장', status: 'translated' },
      { sourceText: 'Second sentence.', translatedText: '두 번째 문장', status: 'translated' }
    ]
  );
  assert.deepEqual(updates[0], payload);

  resetTranslationManager();
});

test('cached translations emit one consolidated update while transcript entries are reconciled', () => {
  resetTranslationManager();
  translationManager.setTranslationEnabled(true);
  translationManager.setCachedTranslation('Speaker one.', '화자 하나');
  translationManager.setCachedTranslation('Speaker two.', '화자 둘');

  const updates = [];
  translationManager.on('updated', (payload) => updates.push(payload));

  const payload = translationManager.updateEntries([
    { id: 'them-1', sourceText: 'Speaker one.', isFinal: true, speakerTag: 'Them' },
    { id: 'me-1', sourceText: 'Speaker two.', isFinal: true, speakerTag: 'Me' }
  ]);

  assert.equal(updates.length, 1);
  assert.deepEqual(
    updates[0].entries.map(({ id, sourceText, translatedText, status, speakerTag }) => ({
      id,
      sourceText,
      translatedText,
      status,
      speakerTag
    })),
    [
      {
        id: 'them-1',
        sourceText: 'Speaker one.',
        translatedText: '화자 하나',
        status: 'translated',
        speakerTag: 'Them'
      },
      {
        id: 'me-1',
        sourceText: 'Speaker two.',
        translatedText: '화자 둘',
        status: 'translated',
        speakerTag: 'Me'
      }
    ]
  );
  assert.deepEqual(updates[0], payload);

  resetTranslationManager();
});

test('Live Captions revision history collapses repeated growing hypotheses', () => {
  resetTranslationManager();

  const payload = translationManager.update([
    'While you were.',
    'While you were joining.',
    'While you were joining which which language do you want to use?',
    'While you were joining which which language do you want to use we have like While you were joining which which language do you want to use?',
    'We have like Python.'
  ].join('\n'));

  assert.deepEqual(
    payload.entries.map((entry) => entry.sourceText),
    [
      'While you were joining which which language do you want to use?',
      'We have like Python.'
    ]
  );

  resetTranslationManager();
});
