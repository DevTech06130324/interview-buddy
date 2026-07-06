const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createTranscriptDisplayGroups,
  TRANSCRIPT_DISPLAY_GROUP_TRANSLATING_TEXT
} = require('../src/transcriptDisplayGroups');

test('display groups merge consecutive transcript entries into readable blocks', () => {
  const groups = createTranscriptDisplayGroups([
    {
      id: 'caption-1',
      sourceText: 'First short sentence.',
      translatedText: '첫 번째 문장.',
      status: 'translated',
      isFinal: true,
      speakerTag: 'Them'
    },
    {
      id: 'caption-2',
      sourceText: 'Second short sentence.',
      translatedText: '두 번째 문장.',
      status: 'translated',
      isFinal: true,
      speakerTag: 'Them'
    },
    {
      id: 'caption-3',
      sourceText: 'Third short sentence still belongs with the paragraph.',
      translatedText: '',
      status: 'pending',
      isFinal: false,
      speakerTag: 'Them'
    }
  ], {
    maxEntries: 5,
    maxSourceChars: 240
  });

  assert.equal(groups.length, 1);
  assert.equal(groups[0].id, 'display-caption-1');
  assert.equal(
    groups[0].sourceText,
    'First short sentence.\nSecond short sentence.\nThird short sentence still belongs with the paragraph.'
  );
  assert.equal(groups[0].translatedText, `첫 번째 문장.\n두 번째 문장.\n${TRANSCRIPT_DISPLAY_GROUP_TRANSLATING_TEXT}`);
  assert.equal(groups[0].status, 'pending');
  assert.equal(groups[0].isFinal, false);
  assert.equal(groups[0].speakerTag, 'Them');
});

test('display groups start a new block when the readable block limit is reached', () => {
  const groups = createTranscriptDisplayGroups([
    { id: 'caption-1', sourceText: 'One.', translatedText: '하나.', status: 'translated', isFinal: true },
    { id: 'caption-2', sourceText: 'Two.', translatedText: '둘.', status: 'translated', isFinal: true },
    { id: 'caption-3', sourceText: 'Three.', translatedText: '셋.', status: 'translated', isFinal: true }
  ], {
    maxEntries: 2,
    maxSourceChars: 200
  });

  assert.equal(groups.length, 2);
  assert.equal(groups[0].sourceText, 'One.\nTwo.');
  assert.equal(groups[0].translatedText, '하나.\n둘.');
  assert.equal(groups[1].sourceText, 'Three.');
  assert.equal(groups[1].translatedText, '셋.');
});

test('display groups preserve line breaks and punctuation inside a speaker turn', () => {
  const groups = createTranscriptDisplayGroups([
    {
      id: 'caption-1',
      sourceText: 'Opening line.\nSecond line with punctuation?',
      translatedText: '',
      status: 'disabled',
      isFinal: true,
      speakerTag: 'Them'
    },
    {
      id: 'caption-2',
      sourceText: 'Next point: keep this readable.',
      translatedText: '',
      status: 'disabled',
      isFinal: true,
      speakerTag: 'Them'
    }
  ]);

  assert.equal(groups.length, 1);
  assert.equal(
    groups[0].sourceText,
    'Opening line.\nSecond line with punctuation?\nNext point: keep this readable.'
  );
});

test('display groups keep a long entry as its own readable block', () => {
  const groups = createTranscriptDisplayGroups([
    { id: 'caption-1', sourceText: 'Short intro.', translatedText: '짧은 소개.', status: 'translated', isFinal: true },
    {
      id: 'caption-2',
      sourceText: 'This sentence is intentionally long enough to exceed the tiny test character limit by itself.',
      translatedText: '긴 문장.',
      status: 'translated',
      isFinal: true
    }
  ], {
    maxEntries: 5,
    maxSourceChars: 24
  });

  assert.equal(groups.length, 2);
  assert.equal(groups[0].sourceText, 'Short intro.');
  assert.equal(
    groups[1].sourceText,
    'This sentence is intentionally long enough to exceed the tiny test character limit by itself.'
  );
});

test('display groups start a new block when speaker changes', () => {
  const groups = createTranscriptDisplayGroups([
    {
      id: 'caption-1',
      sourceText: 'Interviewer opening.',
      translatedText: '',
      status: 'disabled',
      isFinal: true,
      speakerTag: 'Them'
    },
    {
      id: 'caption-2',
      sourceText: 'Interviewer follow up.',
      translatedText: '',
      status: 'disabled',
      isFinal: true,
      speakerTag: 'Them'
    },
    {
      id: 'caption-3',
      sourceText: 'Candidate answer.',
      translatedText: '',
      status: 'disabled',
      isFinal: true,
      speakerTag: 'Me'
    }
  ], {
    maxEntries: 5,
    maxSourceChars: 240
  });

  assert.equal(groups.length, 2);
  assert.equal(groups[0].sourceText, 'Interviewer opening.\nInterviewer follow up.');
  assert.equal(groups[0].speakerTag, 'Them');
  assert.equal(groups[1].sourceText, 'Candidate answer.');
  assert.equal(groups[1].speakerTag, 'Me');
});

test('display groups keep a speaker turn together until another speaker starts', () => {
  const groups = createTranscriptDisplayGroups([
    {
      id: 'caption-1',
      sourceText: 'First part.',
      translatedText: '',
      status: 'disabled',
      isFinal: true,
      speakerTag: 'Me'
    },
    {
      id: 'caption-2',
      sourceText: 'Second part.',
      translatedText: '',
      status: 'disabled',
      isFinal: true,
      speakerTag: 'Me'
    },
    {
      id: 'caption-3',
      sourceText: 'Third part.',
      translatedText: '',
      status: 'disabled',
      isFinal: true,
      speakerTag: 'Me'
    }
  ], {
    maxEntries: 1,
    maxSourceChars: 8
  });

  assert.equal(groups.length, 1);
  assert.equal(groups[0].sourceText, 'First part.\nSecond part.\nThird part.');
  assert.equal(groups[0].speakerTag, 'Me');
});
