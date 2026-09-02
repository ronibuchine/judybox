import { beforeEach, describe, expect, it } from 'vitest';
import { RATING_MAX, RATING_MIN, type PublicPlayer } from '../shared/src/index';
import { GameEngine } from '../server/src/engine/engine';
import { RottenTomatoesGame, type RottenTomatoesConfig } from '../server/src/games/rottenTomatoes';
import { DEFAULT_SCORING } from '../server/src/scoring/strategies';

const SCORING = {
  ...DEFAULT_SCORING,
  distance: {
    bands: [
      { within: 0, points: 500 },
      { within: 5, points: 400 },
      { within: 10, points: 300 },
      { within: 20, points: 150 },
    ],
    otherwise: 0,
  },
};

const CONFIG: RottenTomatoesConfig = {
  id: 'judys-rotten-tomatoes',
  name: "Judy's Rotten Tomatoes",
  scoring: SCORING,
  rounds: [
    {
      prompt: 'How would Judy rate this room?',
      imageUrl: '/assets/placeholder/room-01.svg',
      meta: 'Listed at a price nobody should pay',
    },
    { prompt: 'And this one?', imageUrl: '/assets/placeholder/room-02.svg', meta: null },
  ],
};

function player(id: string, name: string, role: 'PLAYER' | 'SPECIAL' = 'PLAYER'): PublicPlayer {
  return { id, name, role, connected: true, joinedAt: 0 };
}

const SARAH = player('p1', 'Sarah');
const DAVID = player('p2', 'David');
const MIA = player('p4', 'Mia');
const JUDY = player('p3', 'Judy', 'SPECIAL');
const PLAYERS = [SARAH, DAVID, MIA, JUDY];

let engine: GameEngine;

beforeEach(() => {
  engine = new GameEngine({
    games: [new RottenTomatoesGame(CONFIG)],
    specialPlayerName: 'Judy',
  });
});

function openInput(players: readonly PublicPlayer[] = PLAYERS): void {
  for (const action of ['OPEN_GAME_SELECT', 'START_GAME', 'CONTINUE', 'OPEN_INPUT'] as const) {
    const result = engine.applyHostAction(action, players);
    if (!result.ok) throw new Error(`${action} failed: ${result.message}`);
  }
}

function act(action: Parameters<GameEngine['applyHostAction']>[0], players = PLAYERS): void {
  const result = engine.applyHostAction(action, players);
  if (!result.ok) throw new Error(`${action} failed: ${result.message}`);
}

describe('submitting a score', () => {
  it('accepts the bottom of the scale', () => {
    openInput();
    expect(engine.submit(SARAH, String(RATING_MIN), PLAYERS)).toEqual({ ok: true });
  });

  it('accepts the top of the scale', () => {
    openInput();
    expect(engine.submit(SARAH, String(RATING_MAX), PLAYERS)).toEqual({ ok: true });
  });

  it('accepts a score from the special player', () => {
    openInput();
    expect(engine.submit(JUDY, '73', PLAYERS)).toEqual({ ok: true });
  });

  it.each([
    ['below the scale', '-1'],
    ['above the scale', '101'],
    ['wildly above', '999'],
    ['blank', ''],
    ['whitespace', '   '],
    ['not a number', 'great'],
    ['fractional', '50.5'],
    ['hex-looking', '0x40'],
  ])('rejects a score that is %s', (_label, value) => {
    openInput();
    const result = engine.submit(SARAH, value, PLAYERS);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('invalid_value');
  });

  it('rejects a duplicate score and keeps the first', () => {
    openInput();
    engine.submit(SARAH, '40', PLAYERS);
    const second = engine.submit(SARAH, '90', PLAYERS);

    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.code).toBe('already_submitted');

    const view = engine.playerView(SARAH, PLAYERS);
    expect(view.kind === 'rate' && view.submittedValue).toBe(40);
  });

  it('rejects a late score once locked', () => {
    openInput();
    act('LOCK_SUBMISSIONS');
    const result = engine.submit(SARAH, '50', PLAYERS);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('wrong_phase');
  });

  it('expects a score from everyone including the special player', () => {
    openInput();
    expect(engine.snapshot(PLAYERS).expectedCount).toBe(4);
  });
});

describe('the phone view', () => {
  it('asks the two roles different questions', () => {
    openInput();
    const forPlayer = engine.playerView(SARAH, PLAYERS);
    const forSpecial = engine.playerView(JUDY, PLAYERS);

    expect(forPlayer.kind === 'rate' && forPlayer.headline).toBe('How would Judy rate this?');
    expect(forSpecial.kind === 'rate' && forSpecial.headline).toBe('How do YOU rate this?');
    expect(forSpecial.kind === 'rate' && forSpecial.special).toBe(true);
    expect(forPlayer.kind === 'rate' && forPlayer.special).toBeFalsy();
  });

  it('sends slider bounds the phone can render without guessing', () => {
    openInput();
    const view = engine.playerView(SARAH, PLAYERS);

    expect(view.kind).toBe('rate');
    if (view.kind !== 'rate') return;
    expect(view.min).toBe(RATING_MIN);
    expect(view.max).toBe(RATING_MAX);
    expect(view.step).toBe(1);
    expect(view.defaultValue).toBe(50);
    expect(view.submittedValue).toBeNull();
  });

  it('offers the comment box only to the special player', () => {
    openInput();
    expect(engine.playerView(JUDY, PLAYERS).kind === 'rate').toBe(true);

    const hers = engine.playerView(JUDY, PLAYERS);
    const theirs = engine.playerView(SARAH, PLAYERS);
    expect(hers.kind === 'rate' && hers.note?.editable).toBe(true);
    expect(theirs.kind === 'rate' && theirs.note).toBeFalsy();
  });
});

describe('reconnect', () => {
  it('returns a player their own score, and not anyone else the same', () => {
    openInput();
    engine.submit(SARAH, '82', PLAYERS);
    engine.submit(JUDY, '17', PLAYERS);

    const hers = engine.playerView(SARAH, PLAYERS);
    expect(hers.kind === 'rate' && hers.submittedValue).toBe(82);

    const theirs = engine.playerView(DAVID, PLAYERS);
    expect(theirs.kind === 'rate' && theirs.submittedValue).toBeNull();
  });

  it('returns zero rather than treating it as no answer', () => {
    openInput();
    engine.submit(SARAH, '0', PLAYERS);

    const view = engine.playerView(SARAH, PLAYERS);
    expect(view.kind === 'rate' && view.submittedValue).toBe(0);
  });

  it('clears scores when the host restarts the round', () => {
    openInput();
    engine.submit(SARAH, '60', PLAYERS);
    act('RESTART_ROUND');

    expect(engine.submissionCount()).toBe(0);
    act('OPEN_INPUT');
    const view = engine.playerView(SARAH, PLAYERS);
    expect(view.kind === 'rate' && view.submittedValue).toBeNull();
  });
});

describe('her score stays private until the reveal', () => {
  it('is absent from the TV while scoring', () => {
    openInput();
    engine.submit(JUDY, '17', PLAYERS);
    engine.submit(SARAH, '80', PLAYERS);

    const view = engine.displayView(PLAYERS);
    expect(view.kind).toBe('question');
    if (view.kind !== 'question') return;
    expect(view.specialStatus).toEqual({ name: 'Judy', answered: true });
    expect(JSON.stringify(view)).not.toContain('17');
    expect(JSON.stringify(view)).not.toContain('80');
  });

  it('shows the scale on the TV instead of an option list', () => {
    openInput();
    const view = engine.displayView(PLAYERS);

    expect(view.kind).toBe('question');
    if (view.kind !== 'question') return;
    expect(view.options).toEqual([]);
    expect(view.scale).toEqual({ min: 0, max: 100, label: 'Everyone scores it 0\u2013100' });
  });

  it('does not leak her comment before the reveal', () => {
    openInput();
    engine.setSpecialNote(JUDY, 'It smells like a hotel corridor.');

    expect(JSON.stringify(engine.displayView(PLAYERS))).not.toContain('hotel corridor');
    expect(JSON.stringify(engine.playerView(SARAH, PLAYERS))).not.toContain('hotel corridor');
  });
});

describe('reveal', () => {
  it('shows her score, labelled, with the guesses nearest first', () => {
    openInput();
    engine.submit(JUDY, '40', PLAYERS);
    engine.submit(SARAH, '90', PLAYERS);
    engine.submit(DAVID, '45', PLAYERS);
    engine.submit(MIA, '40', PLAYERS);
    act('LOCK_SUBMISSIONS');
    act('REVEAL');

    const view = engine.displayView(PLAYERS);
    expect(view.kind).toBe('rating_reveal');
    if (view.kind !== 'rating_reveal') return;

    expect(view.actualScore).toBe(40);
    expect(view.revealLabel).toBe("Judy's score");
    expect(view.meta).toBe('Listed at a price nobody should pay');
    expect(view.guesses).toEqual([
      { playerName: 'Mia', score: 40, distance: 0 },
      { playerName: 'David', score: 45, distance: 5 },
      { playerName: 'Sarah', score: 90, distance: 50 },
    ]);
  });

  it('shows her comment on the TV', () => {
    openInput();
    engine.submit(JUDY, '12', PLAYERS);
    engine.setSpecialNote(JUDY, 'It smells like a hotel corridor.');
    act('LOCK_SUBMISSIONS');
    act('REVEAL');

    const view = engine.displayView(PLAYERS);
    expect(view.kind === 'rating_reveal' && view.note).toBe('It smells like a hotel corridor.');
  });

  it('reports no score when she never entered one', () => {
    openInput();
    engine.submit(SARAH, '50', PLAYERS);
    act('LOCK_SUBMISSIONS');
    act('REVEAL');

    const view = engine.displayView(PLAYERS);
    expect(view.kind).toBe('rating_reveal');
    if (view.kind !== 'rating_reveal') return;
    expect(view.actualScore).toBeNull();
    expect(view.guesses[0]?.distance).toBeNull();
  });

  it('leaves her out of the guesses and the results table', () => {
    openInput();
    engine.submit(JUDY, '40', PLAYERS);
    engine.submit(SARAH, '41', PLAYERS);
    act('LOCK_SUBMISSIONS');
    act('REVEAL');

    const reveal = engine.displayView(PLAYERS);
    expect(reveal.kind === 'rating_reveal' && reveal.guesses.map((g) => g.playerName)).toEqual([
      'Sarah',
    ]);

    act('SHOW_RESULTS');
    const results = engine.displayView(PLAYERS);
    expect(results.kind).toBe('results');
    if (results.kind !== 'results') return;
    expect(results.rows.map((row) => row.playerName)).toEqual(['Sarah', 'David', 'Mia']);
    expect(results.rows[0]?.choiceLabel).toBe('41 (off by 1)');
    expect(results.rows[1]?.choiceLabel).toBeNull();
  });

  it('tells each player how far off they were', () => {
    openInput();
    engine.submit(JUDY, '40', PLAYERS);
    engine.submit(SARAH, '40', PLAYERS);
    engine.submit(DAVID, '70', PLAYERS);
    act('LOCK_SUBMISSIONS');
    act('REVEAL');

    const exact = engine.playerView(SARAH, PLAYERS);
    expect(exact.kind === 'round_result' && exact.correct).toBe(true);
    expect(exact.kind === 'round_result' && exact.message).toContain('Exactly 40');

    const off = engine.playerView(DAVID, PLAYERS);
    expect(off.kind === 'round_result' && off.correct).toBe(false);
    expect(off.kind === 'round_result' && off.message).toContain('off by 30');

    const missed = engine.playerView(MIA, PLAYERS);
    expect(missed.kind === 'round_result' && missed.correct).toBe(false);

    const hers = engine.playerView(JUDY, PLAYERS);
    expect(hers.kind === 'round_result' && hers.correct).toBeNull();
  });
});

describe('scoring by distance', () => {
  it.each([
    ['exact', 40, 500],
    ['within 5', 45, 400],
    ['on the edge of 10', 50, 300],
    ['within 20', 59, 150],
    ['on the edge of 20', 60, 150],
    ['outside every band', 61, 0],
  ])('awards %s', (_label, guess, points) => {
    openInput();
    engine.submit(JUDY, '40', PLAYERS);
    engine.submit(SARAH, String(guess), PLAYERS);
    act('LOCK_SUBMISSIONS');
    act('SHOW_RESULTS');

    expect(engine.scoreFor(SARAH.id)).toBe(points);
  });

  it('awards every player in a band, not just the closest', () => {
    openInput();
    engine.submit(JUDY, '40', PLAYERS);
    engine.submit(SARAH, '42', PLAYERS);
    engine.submit(DAVID, '38', PLAYERS);
    engine.submit(MIA, '40', PLAYERS);
    act('LOCK_SUBMISSIONS');
    act('SHOW_RESULTS');

    expect(engine.scoreFor(MIA.id)).toBe(500);
    expect(engine.scoreFor(SARAH.id)).toBe(400);
    expect(engine.scoreFor(DAVID.id)).toBe(400);
  });

  it('never awards the special player', () => {
    openInput();
    engine.submit(JUDY, '40', PLAYERS);
    act('LOCK_SUBMISSIONS');
    act('SHOW_RESULTS');

    expect(engine.scoreFor(JUDY.id)).toBe(0);
  });

  it('scores nothing when she never entered a score', () => {
    openInput();
    engine.submit(SARAH, '50', PLAYERS);
    engine.submit(DAVID, '50', PLAYERS);
    act('LOCK_SUBMISSIONS');
    act('SHOW_RESULTS');

    expect(engine.scoreFor(SARAH.id)).toBe(0);
    expect(engine.scoreFor(DAVID.id)).toBe(0);
  });

  it('scores an incomplete round without complaint', () => {
    openInput();
    engine.submit(JUDY, '40', PLAYERS);
    engine.submit(SARAH, '40', PLAYERS);
    act('LOCK_SUBMISSIONS');
    act('SHOW_RESULTS');

    expect(engine.scoreFor(SARAH.id)).toBe(500);
    expect(engine.scoreFor(DAVID.id)).toBe(0);
    expect(engine.scoreFor(MIA.id)).toBe(0);
  });

  it('scores the extremes of the scale like any other value', () => {
    openInput();
    engine.submit(JUDY, '100', PLAYERS);
    engine.submit(SARAH, '100', PLAYERS);
    engine.submit(DAVID, '0', PLAYERS);
    act('LOCK_SUBMISSIONS');
    act('SHOW_RESULTS');

    expect(engine.scoreFor(SARAH.id)).toBe(500);
    expect(engine.scoreFor(DAVID.id)).toBe(0);
  });

  it('accumulates across rounds', () => {
    openInput();
    engine.submit(JUDY, '40', PLAYERS);
    engine.submit(SARAH, '40', PLAYERS);
    act('LOCK_SUBMISSIONS');
    act('SHOW_RESULTS');
    act('NEXT_ROUND');
    act('OPEN_INPUT');
    engine.submit(JUDY, '10', PLAYERS);
    engine.submit(SARAH, '12', PLAYERS);
    act('LOCK_SUBMISSIONS');
    act('SHOW_RESULTS');

    expect(engine.scoreFor(SARAH.id)).toBe(900);
  });

  it('takes the points back when the host restarts a scored round', () => {
    openInput();
    engine.submit(JUDY, '40', PLAYERS);
    engine.submit(SARAH, '40', PLAYERS);
    act('LOCK_SUBMISSIONS');
    act('SHOW_RESULTS');
    expect(engine.scoreFor(SARAH.id)).toBe(500);

    act('RESTART_ROUND');
    expect(engine.scoreFor(SARAH.id)).toBe(0);
  });
});

describe('host progression', () => {
  it('does not advance on its own once everyone has scored', () => {
    openInput();
    for (const person of PLAYERS) engine.submit(person, '50', PLAYERS);

    expect(engine.currentPhase()).toBe('PLAYER_INPUT');
  });

  it('does not offer REVEAL before scores are locked', () => {
    openInput();
    expect(engine.availableActions().some((a) => a.action === 'REVEAL')).toBe(false);

    act('LOCK_SUBMISSIONS');
    expect(engine.availableActions().some((a) => a.action === 'REVEAL')).toBe(true);
  });
});
