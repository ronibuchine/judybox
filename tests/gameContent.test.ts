import { describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
import { parsePartyPack, PartyPackError, DEFAULT_ASSETS_ROOT } from '../server/src/content';
import {
  parseCaptionRound,
  parseDrawRound,
  parseOptions,
  parseRatingRound,
  parseWhatWouldJudyDoRound,
  parseWouldApproveRound,
  resolveImage,
} from '../server/src/games/registry';

const SOURCE = 'party.json';

function pack(games: unknown): unknown {
  return { id: 'p', name: 'P', specialPlayer: { name: 'Judy' }, games };
}

function approveGame(rounds: unknown): unknown {
  return { id: 'g', name: 'G', type: 'would-approve', rounds };
}

const VALID_ROUND = {
  prompt: 'Would Judy approve?',
  image: 'placeholder/room-01.svg',
  options: ['LOVE', 'MAYBE', 'NO', 'THIS OFFENDS ME'],
  judyAnswer: 2,
  judyComment: 'Why would anyone put that there?',
};

function context(): { assetsRoot: string; warnings: string[] } {
  return { assetsRoot: DEFAULT_ASSETS_ROOT, warnings: [] };
}

describe('option parsing', () => {
  it('assigns zero-based string ids', () => {
    expect(parseOptions(['LOVE', 'NO'], SOURCE)).toEqual([
      { id: '0', label: 'LOVE' },
      { id: '1', label: 'NO' },
    ]);
  });

  it('trims labels', () => {
    expect(parseOptions(['  LOVE ', 'NO'], SOURCE)[0]?.label).toBe('LOVE');
  });

  it.each([
    ['too few options', ['ONLY ONE']],
    ['a non-array', 'LOVE'],
    ['an empty label', ['LOVE', '   ']],
    ['a non-string label', ['LOVE', 7]],
    ['duplicate labels', ['LOVE', 'love']],
  ])('rejects %s', (_label, value) => {
    expect(() => parseOptions(value, SOURCE)).toThrow();
  });
});

describe('judyAnswer indexing', () => {
  it('is zero-based: 0 selects the first option', () => {
    const round = parseWouldApproveRound({ ...VALID_ROUND, judyAnswer: 0 }, SOURCE, context());
    expect(round.configuredAnswerId).toBe('0');
    expect(round.options[0]?.label).toBe('LOVE');
  });

  it('accepts the last valid index', () => {
    const round = parseWouldApproveRound({ ...VALID_ROUND, judyAnswer: 3 }, SOURCE, context());
    expect(round.configuredAnswerId).toBe('3');
  });

  it('rejects an index past the end, naming the valid range', () => {
    expect(() =>
      parseWouldApproveRound({ ...VALID_ROUND, judyAnswer: 4 }, SOURCE, context()),
    ).toThrow(/must be 0-3/);
  });

  it('rejects a negative index', () => {
    expect(() =>
      parseWouldApproveRound({ ...VALID_ROUND, judyAnswer: -1 }, SOURCE, context()),
    ).toThrow(/must be 0-3/);
  });

  it('rejects a missing or non-integer index', () => {
    const { judyAnswer: _omitted, ...withoutAnswer } = VALID_ROUND;
    expect(() => parseWouldApproveRound(withoutAnswer, SOURCE, context())).toThrow(/judyAnswer/);
    expect(() =>
      parseWouldApproveRound({ ...VALID_ROUND, judyAnswer: 1.5 }, SOURCE, context()),
    ).toThrow(/judyAnswer/);
  });
});

describe('round validation', () => {
  it('keeps the comment when present', () => {
    const round = parseWouldApproveRound(VALID_ROUND, SOURCE, context());
    expect(round.comment).toBe('Why would anyone put that there?');
  });

  it('treats a blank comment as absent', () => {
    const round = parseWouldApproveRound({ ...VALID_ROUND, judyComment: '  ' }, SOURCE, context());
    expect(round.comment).toBeNull();
  });

  it('allows a round with no image', () => {
    const { image: _omitted, ...withoutImage } = VALID_ROUND;
    expect(parseWouldApproveRound(withoutImage, SOURCE, context()).imageUrl).toBeNull();
  });

  it('rejects an empty prompt', () => {
    expect(() =>
      parseWouldApproveRound({ ...VALID_ROUND, prompt: '  ' }, SOURCE, context()),
    ).toThrow(/prompt/);
  });
});

describe('image resolution', () => {
  it('produces a served URL for a file that exists', () => {
    const ctx = context();
    expect(resolveImage('placeholder/room-01.svg', SOURCE, ctx)).toBe(
      '/assets/placeholder/room-01.svg',
    );
    expect(ctx.warnings).toEqual([]);
  });

  it('warns rather than throwing when the file is missing', () => {
    const ctx = context();
    const url = resolveImage('placeholder/nope.svg', SOURCE, ctx);

    expect(url).toBe('/assets/placeholder/nope.svg');
    expect(ctx.warnings).toHaveLength(1);
    expect(ctx.warnings[0]).toContain('image not found');
  });

  it('refuses to escape the assets directory', () => {
    expect(() => resolveImage('../../secrets.txt', SOURCE, context())).toThrow(/without/);
    expect(() => resolveImage('/etc/passwd', SOURCE, context())).toThrow();
  });

  it('resolves against a custom assets root', () => {
    const ctx = { assetsRoot: resolve('does-not-exist'), warnings: [] as string[] };
    resolveImage('placeholder/room-01.svg', SOURCE, ctx);
    expect(ctx.warnings).toHaveLength(1);
  });
});

describe('pack-level game validation', () => {
  it('surfaces a bad judyAnswer as a pack error', () => {
    const bad = pack([approveGame([{ ...VALID_ROUND, judyAnswer: 99 }])]);
    expect(() => parsePartyPack(bad, 'p', SOURCE)).toThrow(PartyPackError);
  });

  it('collects image warnings without failing the pack', () => {
    const withMissing = pack([approveGame([{ ...VALID_ROUND, image: 'placeholder/gone.svg' }])]);
    const parsed = parsePartyPack(withMissing, 'p', SOURCE);

    expect(parsed.games).toHaveLength(1);
    expect(parsed.warnings).toHaveLength(1);
  });

  it('rejects an unknown game type and lists the known ones', () => {
    const bad = pack([{ id: 'g', name: 'G', type: 'space-invaders', rounds: [VALID_ROUND] }]);
    expect(() => parsePartyPack(bad, 'p', SOURCE)).toThrow(/would-approve/);
  });

  it('rejects a game with no rounds', () => {
    expect(() => parsePartyPack(pack([approveGame([])]), 'p', SOURCE)).toThrow(/at least one round/);
  });
});

describe('what-would-judy-do content', () => {
  const SCENARIO = {
    prompt: 'Judy has three free hours in Paris. What does she do?',
    options: ['Go shopping', 'Find a museum', 'Find a restaurant', 'Walk around'],
  };

  it('needs no answer, because she enters it live', () => {
    const round = parseWhatWouldJudyDoRound(SCENARIO, SOURCE, context());
    expect(round.configuredAnswerId).toBeNull();
    expect(round.imageUrl).toBeNull();
    expect(round.options).toHaveLength(4);
  });

  it('allows an optional image', () => {
    const round = parseWhatWouldJudyDoRound(
      { ...SCENARIO, image: 'placeholder/room-01.svg' },
      SOURCE,
      context(),
    );
    expect(round.imageUrl).toBe('/assets/placeholder/room-01.svg');
  });

  it('accepts 3 to 6 options', () => {
    const labels = ['a', 'b', 'c', 'd', 'e', 'f'];
    expect(() =>
      parseWhatWouldJudyDoRound({ ...SCENARIO, options: labels.slice(0, 3) }, SOURCE, context()),
    ).not.toThrow();
    expect(() =>
      parseWhatWouldJudyDoRound({ ...SCENARIO, options: labels }, SOURCE, context()),
    ).not.toThrow();
  });

  it('rejects fewer than 3 or more than 6 options', () => {
    expect(() =>
      parseWhatWouldJudyDoRound({ ...SCENARIO, options: ['a', 'b'] }, SOURCE, context()),
    ).toThrow(/at least 3/);
    expect(() =>
      parseWhatWouldJudyDoRound(
        { ...SCENARIO, options: ['a', 'b', 'c', 'd', 'e', 'f', 'g'] },
        SOURCE,
        context(),
      ),
    ).toThrow(/most that fits is 6/);
  });

  it('rejects an empty prompt', () => {
    expect(() =>
      parseWhatWouldJudyDoRound({ ...SCENARIO, prompt: ' ' }, SOURCE, context()),
    ).toThrow(/prompt/);
  });

  it('parses through a full pack', () => {
    const parsed = parsePartyPack(
      pack([{ id: 'g', name: 'G', type: 'what-would-judy-do', rounds: [SCENARIO] }]),
      'p',
      SOURCE,
    );
    expect(parsed.games[0]?.roundCount).toBe(1);
  });
});

describe('rotten-tomatoes content', () => {
  const RATING = { prompt: 'How would Judy rate this room?', image: 'placeholder/room-01.svg' };

  it('parses a prompt, image and optional meta', () => {
    const round = parseRatingRound({ ...RATING, meta: 'Built 1974' }, SOURCE, context());
    expect(round.prompt).toBe('How would Judy rate this room?');
    expect(round.imageUrl).toBe('/assets/placeholder/room-01.svg');
    expect(round.meta).toBe('Built 1974');
  });

  it('treats a blank or absent meta as none', () => {
    expect(parseRatingRound(RATING, SOURCE, context()).meta).toBeNull();
    expect(parseRatingRound({ ...RATING, meta: '  ' }, SOURCE, context()).meta).toBeNull();
  });

  it('allows a round with no image', () => {
    const { image: _omitted, ...withoutImage } = RATING;
    expect(parseRatingRound(withoutImage, SOURCE, context()).imageUrl).toBeNull();
  });

  // A score in the pack would be readable by anyone who opens the file.
  it.each(['judyScore', 'score'])('refuses a pre-set %s', (key) => {
    expect(() => parseRatingRound({ ...RATING, [key]: 80 }, SOURCE, context())).toThrow(
      /enters it live/,
    );
  });

  it('rejects an empty prompt and a non-string meta', () => {
    expect(() => parseRatingRound({ ...RATING, prompt: '' }, SOURCE, context())).toThrow(/prompt/);
    expect(() => parseRatingRound({ ...RATING, meta: 7 }, SOURCE, context())).toThrow(/meta/);
  });

  it('reads tolerance bands from the pack', () => {
    const parsed = parsePartyPack(
      pack([
        {
          id: 'g',
          name: 'G',
          type: 'rotten-tomatoes',
          scoring: { exact: 999, within5: 400, otherwise: 10 },
          rounds: [RATING],
        },
      ]),
      'p',
      SOURCE,
    );
    expect(parsed.games).toHaveLength(1);
  });
});

describe('caption-this content', () => {
  const ROUND = { prompt: 'Judy when the kitchen island is 15cm too short.', image: 'placeholder/room-01.svg' };

  it('parses a prompt and optional image', () => {
    const round = parseCaptionRound(ROUND, SOURCE, context());
    expect(round.prompt).toBe(ROUND.prompt);
    expect(round.imageUrl).toBe('/assets/placeholder/room-01.svg');
  });

  it('allows a round with no image', () => {
    const { image: _omitted, ...withoutImage } = ROUND;
    expect(parseCaptionRound(withoutImage, SOURCE, context()).imageUrl).toBeNull();
  });

  it('rejects an empty prompt', () => {
    expect(() => parseCaptionRound({ ...ROUND, prompt: '  ' }, SOURCE, context())).toThrow(/prompt/);
  });

  // A pre-set winner in the pack would be visible to anyone who opens the file.
  it.each(['winner', 'judyPick'])('refuses a pre-set %s', (key) => {
    expect(() => parseCaptionRound({ ...ROUND, [key]: 'p1' }, SOURCE, context())).toThrow(
      /picks one live/,
    );
  });

  it('parses through a full pack', () => {
    const parsed = parsePartyPack(
      pack([{ id: 'g', name: 'G', type: 'caption-this', rounds: [ROUND] }]),
      'p',
      SOURCE,
    );
    expect(parsed.games[0]?.roundCount).toBe(1);
  });
});

describe('quiplash content', () => {
  const ROUND = { prompt: "Judy's ultimate tactic to convince Roni to finally buy a dishwasher" };

  // Same mechanic as Caption This, so it reuses parseCaptionRound outright.
  it('parses through a full pack using the caption-this parser', () => {
    const parsed = parsePartyPack(
      pack([{ id: 'g', name: 'Quiplash', type: 'quiplash', rounds: [ROUND] }]),
      'p',
      SOURCE,
    );
    expect(parsed.games[0]?.roundCount).toBe(1);
  });

  it.each(['winner', 'judyPick'])('refuses a pre-set %s', (key) => {
    expect(() => parseCaptionRound({ ...ROUND, [key]: 'p1' }, SOURCE, context())).toThrow(
      /picks one live/,
    );
  });
});

describe('draw-this content', () => {
  const ROUND = { prompt: "Design Judy's dream living room inside Hogwarts." };

  it('parses a prompt', () => {
    expect(parseDrawRound(ROUND, SOURCE).prompt).toBe(ROUND.prompt);
  });

  it('rejects an empty prompt', () => {
    expect(() => parseDrawRound({ prompt: ' ' }, SOURCE)).toThrow(/prompt/);
  });

  it.each(['winner', 'judyPick'])('refuses a pre-set %s', (key) => {
    expect(() => parseDrawRound({ ...ROUND, [key]: 'p1' }, SOURCE)).toThrow(/picks one live/);
  });

  it('parses through a full pack', () => {
    const parsed = parsePartyPack(
      pack([{ id: 'g', name: 'G', type: 'draw-this', rounds: [ROUND] }]),
      'p',
      SOURCE,
    );
    expect(parsed.games[0]?.roundCount).toBe(1);
  });
});

