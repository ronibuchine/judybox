import { beforeEach, describe, expect, it } from 'vitest';
import { MAX_SPECIAL_NOTE_LENGTH, type PublicPlayer } from '../shared/src/index';
import { GameEngine } from '../server/src/engine/engine';
import { PredictSpecialGame, type PredictSpecialConfig } from '../server/src/games/predictSpecial';
import { DEFAULT_SCORING } from '../server/src/scoring/strategies';

const OPTIONS = [
  { id: '0', label: 'LOVE' },
  { id: '1', label: 'MAYBE' },
  { id: '2', label: 'NO' },
  { id: '3', label: 'THIS OFFENDS ME' },
];

/** "Would Judy Approve?": image-led, with a scripted fallback answer. */
const CONFIG: PredictSpecialConfig = {
  id: 'would-judy-approve',
  name: 'Would Judy Approve?',
  scoring: { ...DEFAULT_SCORING, predictSpecial: 100 },
  rounds: [
    {
      prompt: 'Would Judy approve of this room?',
      imageUrl: '/assets/placeholder/room-01.svg',
      options: OPTIONS,
      configuredAnswerId: '1',
      comment: 'It is fine, and that is the problem.',
    },
    {
      prompt: 'And this one?',
      imageUrl: '/assets/placeholder/room-02.svg',
      options: OPTIONS,
      configuredAnswerId: '3',
      comment: null,
    },
  ],
};

function player(id: string, name: string, role: 'PLAYER' | 'SPECIAL' = 'PLAYER'): PublicPlayer {
  return { id, name, role, connected: true, joinedAt: 0 };
}

const SARAH = player('p1', 'Sarah');
const DAVID = player('p2', 'David');
const JUDY = player('p3', 'Judy', 'SPECIAL');
const PLAYERS = [SARAH, DAVID, JUDY];

let engine: GameEngine;

beforeEach(() => {
  engine = new GameEngine({
    games: [new PredictSpecialGame(CONFIG)],
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

describe('answering', () => {
  it('accepts a normal player prediction', () => {
    openInput();
    expect(engine.submit(SARAH, '2', PLAYERS)).toEqual({ ok: true });
  });

  it('accepts the special player answering for herself', () => {
    openInput();
    expect(engine.submit(JUDY, '1', PLAYERS)).toEqual({ ok: true });
  });

  it('rejects an option that does not exist', () => {
    openInput();
    const result = engine.submit(SARAH, '9', PLAYERS);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('invalid_value');
  });

  it('rejects a duplicate answer and keeps the first', () => {
    openInput();
    engine.submit(SARAH, '0', PLAYERS);
    const second = engine.submit(SARAH, '3', PLAYERS);

    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.code).toBe('already_submitted');

    const view = engine.playerView(SARAH, PLAYERS);
    expect(view.kind === 'choose' && view.selectedOptionId).toBe('0');
  });

  it('rejects a late answer once locked', () => {
    openInput();
    act('LOCK_SUBMISSIONS');
    const result = engine.submit(SARAH, '0', PLAYERS);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('wrong_phase');
  });

  it('expects an answer from everyone including the special player', () => {
    openInput();
    expect(engine.snapshot(PLAYERS).expectedCount).toBe(3);
  });
});

describe('the special player answer stays private', () => {
  it('is absent from the TV view while answering', () => {
    openInput();
    engine.submit(JUDY, '1', PLAYERS);
    engine.submit(SARAH, '2', PLAYERS);

    const view = engine.displayView(PLAYERS);
    expect(view.kind).toBe('question');
    if (view.kind !== 'question') return;

    // The TV may say she has answered, but never which option.
    expect(view.specialStatus).toEqual({ name: 'Judy', answered: true });
    expect(JSON.stringify(view)).not.toContain('correctOptionId');
  });

  it('shows her as still deciding before she answers', () => {
    openInput();
    const view = engine.displayView(PLAYERS);

    expect(view.kind === 'question' && view.specialStatus?.answered).toBe(false);
  });

  it('is not leaked to another player through their own view', () => {
    openInput();
    engine.submit(JUDY, '1', PLAYERS);

    const view = engine.playerView(SARAH, PLAYERS);
    expect(view.kind).toBe('choose');
    if (view.kind !== 'choose') return;
    expect(view.selectedOptionId).toBeNull();
  });

  it('asks the two roles different questions', () => {
    openInput();
    const forPlayer = engine.playerView(SARAH, PLAYERS);
    const forSpecial = engine.playerView(JUDY, PLAYERS);

    expect(forPlayer.kind === 'choose' && forPlayer.headline).toBe(
      'Which answer will Judy choose?',
    );
    expect(forSpecial.kind === 'choose' && forSpecial.headline).toBe('What is YOUR answer?');
    expect(forSpecial.kind === 'choose' && forSpecial.special).toBe(true);
    expect(forPlayer.kind === 'choose' && forPlayer.special).toBeFalsy();
  });

  it('does not reveal player choices before the reveal', () => {
    openInput();
    engine.submit(SARAH, '2', PLAYERS);
    engine.submit(DAVID, '0', PLAYERS);

    const view = engine.displayView(PLAYERS);
    expect(view.kind).toBe('question');
    if (view.kind !== 'question') return;
    expect(view.answered).toBe(2);
    expect(JSON.stringify(view)).not.toContain('Sarah');
  });
});

describe('reveal', () => {
  it('shows her live answer, labelled, with her comment', () => {
    openInput();
    engine.submit(JUDY, '2', PLAYERS);
    engine.submit(SARAH, '2', PLAYERS);
    act('LOCK_SUBMISSIONS');
    act('REVEAL');

    const view = engine.displayView(PLAYERS);
    expect(view.kind).toBe('reveal');
    if (view.kind !== 'reveal') return;

    // Her live answer wins over the configured '1'.
    expect(view.correctOptionId).toBe('2');
    expect(view.revealLabel).toBe("Judy's answer");
    expect(view.note).toBe('It is fine, and that is the problem.');
  });

  it('falls back to the configured answer when she never answered', () => {
    openInput();
    engine.submit(SARAH, '1', PLAYERS);
    act('LOCK_SUBMISSIONS');
    act('REVEAL');

    const view = engine.displayView(PLAYERS);
    expect(view.kind === 'reveal' && view.correctOptionId).toBe('1');
  });

  it('excludes her own answer from the crowd tally', () => {
    openInput();
    engine.submit(JUDY, '0', PLAYERS);
    engine.submit(SARAH, '0', PLAYERS);
    act('LOCK_SUBMISSIONS');
    act('REVEAL');

    const view = engine.displayView(PLAYERS);
    expect(view.kind).toBe('reveal');
    if (view.kind !== 'reveal') return;
    expect(view.tallies['0']).toBe(1);
  });

  it('carries the image through to the TV', () => {
    openInput();
    const view = engine.displayView(PLAYERS);
    expect(view.kind === 'question' && view.imageUrl).toBe('/assets/placeholder/room-01.svg');
  });

  it('leaves her out of the results table', () => {
    openInput();
    engine.submit(JUDY, '2', PLAYERS);
    engine.submit(SARAH, '2', PLAYERS);
    act('LOCK_SUBMISSIONS');
    act('SHOW_RESULTS');

    const view = engine.displayView(PLAYERS);
    expect(view.kind).toBe('results');
    if (view.kind !== 'results') return;
    expect(view.rows.map((row) => row.playerName)).toEqual(['Sarah', 'David']);
  });
});

describe('scoring', () => {
  it('awards players who predicted her, and not her', () => {
    openInput();
    engine.submit(JUDY, '2', PLAYERS);
    engine.submit(SARAH, '2', PLAYERS);
    engine.submit(DAVID, '0', PLAYERS);
    act('LOCK_SUBMISSIONS');
    act('SHOW_RESULTS');

    expect(engine.scoreFor(SARAH.id)).toBe(100);
    expect(engine.scoreFor(DAVID.id)).toBe(0);
    expect(engine.scoreFor(JUDY.id)).toBe(0);
  });

  it('scores against the configured answer when she is absent', () => {
    const withoutJudy = [SARAH, DAVID];
    openInput(withoutJudy);
    engine.submit(SARAH, '1', withoutJudy);
    engine.submit(DAVID, '0', withoutJudy);
    act('LOCK_SUBMISSIONS', withoutJudy);
    act('SHOW_RESULTS', withoutJudy);

    expect(engine.scoreFor(SARAH.id)).toBe(100);
    expect(engine.scoreFor(DAVID.id)).toBe(0);
  });

  it('awards nobody when nobody predicted correctly', () => {
    openInput();
    engine.submit(JUDY, '3', PLAYERS);
    engine.submit(SARAH, '0', PLAYERS);
    act('LOCK_SUBMISSIONS');
    act('SHOW_RESULTS');

    expect(engine.scoreFor(SARAH.id)).toBe(0);
  });

  it('scores an incomplete round without complaint', () => {
    openInput();
    engine.submit(JUDY, '1', PLAYERS);
    act('LOCK_SUBMISSIONS');
    act('SHOW_RESULTS');

    expect(engine.scoreFor(SARAH.id)).toBe(0);
    expect(engine.scoreFor(DAVID.id)).toBe(0);
  });

  it('accumulates across rounds', () => {
    openInput();
    engine.submit(JUDY, '1', PLAYERS);
    engine.submit(SARAH, '1', PLAYERS);
    act('LOCK_SUBMISSIONS');
    act('SHOW_RESULTS');
    act('NEXT_ROUND');
    act('OPEN_INPUT');
    engine.submit(JUDY, '3', PLAYERS);
    engine.submit(SARAH, '3', PLAYERS);
    act('LOCK_SUBMISSIONS');
    act('SHOW_RESULTS');

    expect(engine.scoreFor(SARAH.id)).toBe(200);
  });
});

describe("the special player's own comment", () => {
  it('offers her a labelled comment box while answering', () => {
    openInput();
    const view = engine.playerView(JUDY, PLAYERS);

    expect(view.kind).toBe('choose');
    if (view.kind !== 'choose') return;
    expect(view.note).toBeTruthy();
    expect(view.note?.label).toBe('Your comment for the TV');
    expect(view.note?.hint).toContain('TV');
    expect(view.note?.editable).toBe(true);
    expect(view.note?.maxLength).toBe(MAX_SPECIAL_NOTE_LENGTH);
  });

  it('never offers the box to a normal player', () => {
    openInput();
    const view = engine.playerView(SARAH, PLAYERS);
    expect(view.kind === 'choose' && view.note).toBeFalsy();
  });

  it('shows her comment on the TV at the reveal, over the scripted one', () => {
    openInput();
    engine.submit(JUDY, '2', PLAYERS);
    engine.setSpecialNote(JUDY, 'That lamp is a cry for help.');
    act('LOCK_SUBMISSIONS');
    act('REVEAL');

    const view = engine.displayView(PLAYERS);
    expect(view.kind === 'reveal' && view.note).toBe('That lamp is a cry for help.');
  });

  it('falls back to the scripted comment when she writes nothing', () => {
    openInput();
    engine.submit(JUDY, '2', PLAYERS);
    act('LOCK_SUBMISSIONS');
    act('REVEAL');

    const view = engine.displayView(PLAYERS);
    expect(view.kind === 'reveal' && view.note).toBe('It is fine, and that is the problem.');
  });

  it('lets her keep editing after answers lock and through the reveal', () => {
    openInput();
    engine.submit(JUDY, '2', PLAYERS);
    act('LOCK_SUBMISSIONS');

    const locked = engine.playerView(JUDY, PLAYERS);
    expect(locked.kind === 'waiting' && locked.note?.editable).toBe(true);
    expect(engine.setSpecialNote(JUDY, 'Second thoughts.')).toEqual({ ok: true });

    act('REVEAL');
    const revealed = engine.playerView(JUDY, PLAYERS);
    expect(revealed.kind === 'round_result' && revealed.note?.editable).toBe(true);
  });

  it('stops accepting edits once the host moves to results', () => {
    openInput();
    engine.setSpecialNote(JUDY, 'Locked in.');
    act('LOCK_SUBMISSIONS');
    act('SHOW_RESULTS');

    const result = engine.setSpecialNote(JUDY, 'Too late.');
    expect(result.ok).toBe(false);

    const view = engine.playerView(JUDY, PLAYERS);
    expect(view.kind === 'round_result' && view.note?.editable).toBe(false);
    expect(engine.currentSpecialNote()).toBe('Locked in.');
  });

  it('echoes her saved text back so a refresh keeps it', () => {
    openInput();
    engine.setSpecialNote(JUDY, 'Beige again.');

    const view = engine.playerView(JUDY, PLAYERS);
    expect(view.kind === 'choose' && view.note?.value).toBe('Beige again.');
  });

  it('refuses a comment from anyone but her', () => {
    openInput();
    const result = engine.setSpecialNote(SARAH, 'Let me write the joke.');

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('not_playing');
    expect(engine.currentSpecialNote()).toBeNull();
  });

  it('rejects a comment too long for the TV', () => {
    openInput();
    const result = engine.setSpecialNote(JUDY, 'x'.repeat(MAX_SPECIAL_NOTE_LENGTH + 1));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('invalid_value');
  });

  it('treats a blank comment as clearing it', () => {
    openInput();
    engine.setSpecialNote(JUDY, 'Actually, never mind.');
    engine.setSpecialNote(JUDY, '   ');

    expect(engine.currentSpecialNote()).toBeNull();
  });

  it('does not leak her comment to other players before the reveal', () => {
    openInput();
    engine.setSpecialNote(JUDY, 'Secret opinion.');

    expect(JSON.stringify(engine.playerView(SARAH, PLAYERS))).not.toContain('Secret opinion');
    expect(JSON.stringify(engine.displayView(PLAYERS))).not.toContain('Secret opinion');
  });

  it('clears the comment with the round', () => {
    openInput();
    engine.setSpecialNote(JUDY, 'Round one thoughts.');
    act('RESTART_ROUND');

    expect(engine.currentSpecialNote()).toBeNull();
  });

  it('does not carry the comment into the next round', () => {
    openInput();
    engine.submit(JUDY, '1', PLAYERS);
    engine.setSpecialNote(JUDY, 'Round one thoughts.');
    act('LOCK_SUBMISSIONS');
    act('SHOW_RESULTS');
    act('NEXT_ROUND');
    act('OPEN_INPUT');

    expect(engine.currentSpecialNote()).toBeNull();
    const view = engine.playerView(JUDY, PLAYERS);
    expect(view.kind === 'choose' && view.note?.value).toBe('');
  });

  it('refuses a comment when no game is running', () => {
    expect(engine.setSpecialNote(JUDY, 'Too early.').ok).toBe(false);
  });
});

describe('host progression and reconnect', () => {  it('requires the host to advance every step', () => {
    openInput();
    engine.submit(JUDY, '1', PLAYERS);
    engine.submit(SARAH, '1', PLAYERS);
    engine.submit(DAVID, '1', PLAYERS);

    // Everyone has answered; the engine must not advance on its own.
    expect(engine.currentPhase()).toBe('PLAYER_INPUT');
  });

  it('does not offer REVEAL before answers are locked', () => {
    openInput();
    expect(engine.availableActions().some((a) => a.action === 'REVEAL')).toBe(false);

    act('LOCK_SUBMISSIONS');
    expect(engine.availableActions().some((a) => a.action === 'REVEAL')).toBe(true);
  });

  it('returns her own answer after a reconnect, and only to her', () => {
    openInput();
    engine.submit(JUDY, '3', PLAYERS);

    const hers = engine.playerView(JUDY, PLAYERS);
    expect(hers.kind === 'choose' && hers.selectedOptionId).toBe('3');

    const theirs = engine.playerView(DAVID, PLAYERS);
    expect(theirs.kind === 'choose' && theirs.selectedOptionId).toBeNull();
  });

  it('clears answers when the host restarts the round', () => {
    openInput();
    engine.submit(JUDY, '1', PLAYERS);
    engine.submit(SARAH, '1', PLAYERS);
    act('RESTART_ROUND');

    expect(engine.submissionCount()).toBe(0);
    act('OPEN_INPUT');
    const view = engine.playerView(JUDY, PLAYERS);
    expect(view.kind === 'choose' && view.selectedOptionId).toBeNull();
  });

  it('tells a player who never answered that they missed it', () => {
    openInput();
    engine.submit(JUDY, '1', PLAYERS);
    act('LOCK_SUBMISSIONS');
    act('REVEAL');

    const view = engine.playerView(SARAH, PLAYERS);
    expect(view.kind).toBe('round_result');
    if (view.kind !== 'round_result') return;
    expect(view.correct).toBe(false);
  });

  it('never marks the special player right or wrong', () => {
    openInput();
    engine.submit(JUDY, '1', PLAYERS);
    act('LOCK_SUBMISSIONS');
    act('REVEAL');

    const view = engine.playerView(JUDY, PLAYERS);
    expect(view.kind).toBe('round_result');
    if (view.kind !== 'round_result') return;
    expect(view.correct).toBeNull();
  });
});

/**
 * "What Would Judy Do?" is the same mechanic with no scripted answer and no
 * image, so these cover only what differs: her live answer is the only truth.
 */
describe('what would judy do', () => {
  const SCENARIO_OPTIONS = [
    { id: '0', label: 'Go shopping' },
    { id: '1', label: 'Find a museum' },
    { id: '2', label: 'Find an absurdly good restaurant' },
    { id: '3', label: 'Walk around with no plan' },
  ];

  const UNSCRIPTED: PredictSpecialConfig = {
    id: 'what-would-judy-do',
    name: 'What Would Judy Do?',
    scoring: { ...DEFAULT_SCORING, predictSpecial: 100 },
    rounds: [
      {
        prompt: 'Judy has three free hours in Paris. What does she do?',
        imageUrl: null,
        options: SCENARIO_OPTIONS,
        configuredAnswerId: null,
        comment: null,
      },
    ],
  };

  let scenarios: GameEngine;

  beforeEach(() => {
    scenarios = new GameEngine({
      games: [new PredictSpecialGame(UNSCRIPTED)],
      specialPlayerName: 'Judy',
    });
    for (const action of ['OPEN_GAME_SELECT', 'START_GAME', 'CONTINUE', 'OPEN_INPUT'] as const) {
      const result = scenarios.applyHostAction(action, PLAYERS);
      if (!result.ok) throw new Error(`${action} failed: ${result.message}`);
    }
  });

  const step = (action: Parameters<GameEngine['applyHostAction']>[0]): void => {
    const result = scenarios.applyHostAction(action, PLAYERS);
    if (!result.ok) throw new Error(`${action} failed: ${result.message}`);
  };

  it('runs without an image', () => {
    const view = scenarios.displayView(PLAYERS);
    expect(view.kind === 'question' && view.imageUrl).toBeNull();
    expect(view.kind === 'question' && view.options).toHaveLength(4);
  });

  it('reveals her live answer', () => {
    scenarios.submit(JUDY, '2', PLAYERS);
    scenarios.submit(SARAH, '2', PLAYERS);
    scenarios.submit(DAVID, '0', PLAYERS);
    step('LOCK_SUBMISSIONS');
    step('REVEAL');

    const view = scenarios.displayView(PLAYERS);
    expect(view.kind === 'reveal' && view.correctOptionId).toBe('2');
    expect(view.kind === 'reveal' && view.revealLabel).toBe("Judy's answer");
  });

  it('scores only the players who predicted her', () => {
    scenarios.submit(JUDY, '2', PLAYERS);
    scenarios.submit(SARAH, '2', PLAYERS);
    scenarios.submit(DAVID, '0', PLAYERS);
    step('LOCK_SUBMISSIONS');
    step('SHOW_RESULTS');

    expect(scenarios.scoreFor(SARAH.id)).toBe(100);
    expect(scenarios.scoreFor(DAVID.id)).toBe(0);
    expect(scenarios.scoreFor(JUDY.id)).toBe(0);
  });

  it('reveals nothing and scores nothing when she never answers', () => {
    scenarios.submit(SARAH, '2', PLAYERS);
    step('LOCK_SUBMISSIONS');
    step('SHOW_RESULTS');

    const view = scenarios.displayView(PLAYERS);
    expect(view.kind === 'results').toBe(true);
    expect(scenarios.scoreFor(SARAH.id)).toBe(0);
  });

  it('still gives her a comment box', () => {
    const view = scenarios.playerView(JUDY, PLAYERS);
    expect(view.kind === 'choose' && view.note?.editable).toBe(true);
  });
});

