import { beforeEach, describe, expect, it } from 'vitest';
import type { HostAction, PublicPlayer } from '../shared/src/index';
import { GameEngine } from '../server/src/engine/engine';
import { MultipleChoiceGame } from '../server/src/games/multipleChoice';
import { DEFAULT_SCORING } from '../server/src/scoring/strategies';

const QUIZ = new MultipleChoiceGame({
  id: 'demo-quiz',
  name: 'Demo Game',
  scoring: { ...DEFAULT_SCORING, correctAnswer: 100 },
  rounds: [
    {
      prompt: 'What is 2 + 2?',
      options: [
        { id: 'a', label: '3' },
        { id: 'b', label: '4' },
      ],
      correctOptionId: 'b',
    },
    {
      prompt: 'Pick a colour',
      options: [
        { id: 'a', label: 'Green' },
        { id: 'b', label: 'Blue' },
      ],
      correctOptionId: 'a',
    },
  ],
});

function player(id: string, name: string, role: 'PLAYER' | 'SPECIAL' = 'PLAYER'): PublicPlayer {
  return { id, name, role, connected: true, joinedAt: 0 };
}

const SARAH = player('p1', 'Sarah');
const DAVID = player('p2', 'David');
const JUDY = player('p3', 'Judy', 'SPECIAL');
const PLAYERS = [SARAH, DAVID, JUDY];

let engine: GameEngine;

beforeEach(() => {
  engine = new GameEngine({ games: [QUIZ], specialPlayerName: 'Judy' });
});

/** Drives the engine through a list of actions, asserting each succeeds. */
function run(...actions: HostAction[]): void {
  for (const action of actions) {
    const result = engine.applyHostAction(action, PLAYERS);
    if (!result.ok) throw new Error(`${action} failed: ${result.message}`);
  }
}

function toInput(): void {
  run('OPEN_GAME_SELECT', 'START_GAME', 'CONTINUE', 'OPEN_INPUT');
}

describe('engine starting state', () => {
  it('starts in LOBBY with no game', () => {
    expect(engine.currentPhase()).toBe('LOBBY');
    expect(engine.currentGame()).toBeNull();
    expect(engine.snapshot(PLAYERS).gameName).toBeNull();
  });

  it('offers only game selection from the lobby', () => {
    expect(engine.availableActions().map((a) => a.action)).toEqual(['OPEN_GAME_SELECT']);
  });
});

describe('valid transitions', () => {
  it('walks the full canonical round', () => {
    const phases: string[] = [];
    const actions: HostAction[] = [
      'OPEN_GAME_SELECT',
      'START_GAME',
      'CONTINUE',
      'OPEN_INPUT',
      'LOCK_SUBMISSIONS',
      'REVEAL',
      'SHOW_RESULTS',
      'SHOW_LEADERBOARD',
    ];
    for (const action of actions) {
      const result = engine.applyHostAction(action, PLAYERS);
      expect(result.ok).toBe(true);
      if (result.ok) phases.push(result.phase);
    }

    expect(phases).toEqual([
      'GAME_SELECT',
      'GAME_INTRO',
      'ROUND_INTRO',
      'PLAYER_INPUT',
      'SUBMISSIONS_LOCKED',
      'REVEAL',
      'RESULTS',
      'LEADERBOARD',
    ]);
  });

  it('advances to the next round and reports the round number', () => {
    run('OPEN_GAME_SELECT', 'START_GAME', 'CONTINUE', 'OPEN_INPUT', 'LOCK_SUBMISSIONS');
    run('SHOW_RESULTS', 'NEXT_ROUND');

    expect(engine.currentPhase()).toBe('ROUND_INTRO');
    expect(engine.snapshot(PLAYERS).roundNumber).toBe(2);
  });

  it('completes the game after the final round', () => {
    run('OPEN_GAME_SELECT', 'START_GAME', 'CONTINUE', 'OPEN_INPUT', 'LOCK_SUBMISSIONS');
    run('SHOW_RESULTS', 'NEXT_ROUND', 'OPEN_INPUT', 'LOCK_SUBMISSIONS', 'SHOW_RESULTS');
    run('NEXT_ROUND');

    expect(engine.currentPhase()).toBe('GAME_COMPLETE');
  });

  it('allows skipping REVEAL, going straight from locked to results', () => {
    run('OPEN_GAME_SELECT', 'START_GAME', 'CONTINUE', 'OPEN_INPUT', 'LOCK_SUBMISSIONS');
    const result = engine.applyHostAction('SHOW_RESULTS', PLAYERS);

    expect(result.ok).toBe(true);
    expect(engine.currentPhase()).toBe('RESULTS');
  });
});

describe('invalid transitions', () => {
  it.each<HostAction>([
    'LOCK_SUBMISSIONS',
    'REVEAL',
    'SHOW_RESULTS',
    'NEXT_ROUND',
    'START_GAME',
    'CONTINUE',
  ])('rejects %s from LOBBY', (action) => {
    const result = engine.applyHostAction(action, PLAYERS);
    expect(result.ok).toBe(false);
    expect(engine.currentPhase()).toBe('LOBBY');
  });

  it('rejects revealing before answers are locked', () => {
    toInput();
    const result = engine.applyHostAction('REVEAL', PLAYERS);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain('PLAYER_INPUT');
    expect(engine.currentPhase()).toBe('PLAYER_INPUT');
  });

  it('rejects an unknown action', () => {
    const result = engine.applyHostAction('NOT_REAL' as HostAction, PLAYERS);
    expect(result.ok).toBe(false);
  });

  it('never offers an action it would then reject', () => {
    // Walk several phases and confirm the advertised list is always honoured.
    const visited: HostAction[][] = [];
    toInput();
    for (const action of ['LOCK_SUBMISSIONS', 'REVEAL', 'SHOW_RESULTS'] as HostAction[]) {
      visited.push(engine.availableActions().map((a) => a.action));
      expect(engine.availableActions().some((a) => a.action === action)).toBe(true);
      expect(engine.applyHostAction(action, PLAYERS).ok).toBe(true);
    }
    expect(visited).toHaveLength(3);
  });

  it('does not offer START_GAME when the pack has no games', () => {
    const empty = new GameEngine({ games: [], specialPlayerName: 'Judy' });
    empty.applyHostAction('OPEN_GAME_SELECT', PLAYERS);

    expect(empty.availableActions().some((a) => a.action === 'START_GAME')).toBe(false);
  });
});

describe('player submissions', () => {
  it('accepts an answer during PLAYER_INPUT', () => {
    toInput();
    expect(engine.submit(SARAH, 'b', PLAYERS)).toEqual({ ok: true });
    expect(engine.submissionCount()).toBe(1);
  });

  it('rejects an answer before the round opens', () => {
    run('OPEN_GAME_SELECT', 'START_GAME', 'CONTINUE');
    const result = engine.submit(SARAH, 'b', PLAYERS);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('wrong_phase');
  });

  it('rejects a late answer once locked', () => {
    toInput();
    run('LOCK_SUBMISSIONS');
    const result = engine.submit(SARAH, 'b', PLAYERS);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('wrong_phase');
    expect(result.message).toContain('locked');
  });

  it('rejects a duplicate answer and keeps the first', () => {
    toInput();
    engine.submit(SARAH, 'b', PLAYERS);
    const second = engine.submit(SARAH, 'a', PLAYERS);

    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.code).toBe('already_submitted');
    expect(engine.submissionCount()).toBe(1);
  });

  it('rejects an option that does not exist', () => {
    toInput();
    const result = engine.submit(SARAH, 'zzz', PLAYERS);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('invalid_value');
  });

  it('rejects answers when no game is running', () => {
    const result = engine.submit(SARAH, 'b', PLAYERS);
    expect(result.ok).toBe(false);
  });

  it('counts answers toward the expected total', () => {
    toInput();
    engine.submit(SARAH, 'b', PLAYERS);
    engine.submit(DAVID, 'a', PLAYERS);

    const snapshot = engine.snapshot(PLAYERS);
    expect(snapshot.submittedCount).toBe(2);
    expect(snapshot.expectedCount).toBe(3);
  });
});

describe('recovery actions', () => {
  it('restart round clears answers and returns to ROUND_INTRO', () => {
    toInput();
    engine.submit(SARAH, 'b', PLAYERS);
    run('RESTART_ROUND');

    expect(engine.currentPhase()).toBe('ROUND_INTRO');
    expect(engine.submissionCount()).toBe(0);
  });

  it('restart round keeps the same round number', () => {
    run('OPEN_GAME_SELECT', 'START_GAME', 'CONTINUE', 'OPEN_INPUT', 'LOCK_SUBMISSIONS');
    run('SHOW_RESULTS', 'NEXT_ROUND', 'OPEN_INPUT', 'RESTART_ROUND');

    expect(engine.snapshot(PLAYERS).roundNumber).toBe(2);
  });

  it('skip round moves on without answers', () => {
    toInput();
    run('SKIP_ROUND');

    expect(engine.currentPhase()).toBe('ROUND_INTRO');
    expect(engine.snapshot(PLAYERS).roundNumber).toBe(2);
  });

  it('skip on the last round completes the game', () => {
    run('OPEN_GAME_SELECT', 'START_GAME', 'CONTINUE', 'OPEN_INPUT', 'LOCK_SUBMISSIONS');
    run('SHOW_RESULTS', 'NEXT_ROUND', 'OPEN_INPUT', 'SKIP_ROUND');

    expect(engine.currentPhase()).toBe('GAME_COMPLETE');
  });

  it('restart game returns to round one and clears scores', () => {
    toInput();
    engine.submit(SARAH, 'b', PLAYERS);
    run('LOCK_SUBMISSIONS', 'SHOW_RESULTS');
    expect(engine.scoreFor(SARAH.id)).toBe(100);

    run('RESTART_GAME');
    expect(engine.currentPhase()).toBe('GAME_INTRO');
    expect(engine.snapshot(PLAYERS).roundNumber).toBe(1);
    expect(engine.scoreFor(SARAH.id)).toBe(0);
    expect(engine.submissionCount()).toBe(0);
  });

  it('returns to the lobby from mid-round and drops the game', () => {
    toInput();
    engine.submit(SARAH, 'b', PLAYERS);
    run('RETURN_TO_LOBBY');

    expect(engine.currentPhase()).toBe('LOBBY');
    expect(engine.currentGame()).toBeNull();
    expect(engine.submissionCount()).toBe(0);
  });

  it('returns to game select from mid-round', () => {
    toInput();
    run('RETURN_TO_GAME_SELECT');

    expect(engine.currentPhase()).toBe('GAME_SELECT');
    expect(engine.submissionCount()).toBe(0);
  });
});

describe('scoring hand-off', () => {
  it('awards configured points for a correct answer, once', () => {
    toInput();
    engine.submit(SARAH, 'b', PLAYERS);
    engine.submit(DAVID, 'a', PLAYERS);
    run('LOCK_SUBMISSIONS', 'SHOW_RESULTS');

    expect(engine.scoreFor(SARAH.id)).toBe(100);
    expect(engine.scoreFor(DAVID.id)).toBe(0);

    // Restarting reverts the round, so replaying it cannot double-count.
    run('RESTART_ROUND', 'OPEN_INPUT');
    expect(engine.scoreFor(SARAH.id)).toBe(0);

    engine.submit(SARAH, 'b', PLAYERS);
    run('LOCK_SUBMISSIONS', 'SHOW_RESULTS');
    expect(engine.scoreFor(SARAH.id)).toBe(100);
  });

  it('keeps scores from earlier rounds', () => {
    toInput();
    engine.submit(SARAH, 'b', PLAYERS);
    run('LOCK_SUBMISSIONS', 'SHOW_RESULTS', 'NEXT_ROUND', 'OPEN_INPUT');
    engine.submit(SARAH, 'a', PLAYERS);
    run('LOCK_SUBMISSIONS', 'SHOW_RESULTS');

    expect(engine.scoreFor(SARAH.id)).toBe(200);
  });

  it('keeps scores when returning to the lobby', () => {
    toInput();
    engine.submit(SARAH, 'b', PLAYERS);
    run('LOCK_SUBMISSIONS', 'SHOW_RESULTS', 'RETURN_TO_LOBBY');

    expect(engine.scoreFor(SARAH.id)).toBe(100);
  });

  it('records a manual host award', () => {
    expect(engine.awardManually(SARAH.id, 250)).toBe(true);
    expect(engine.scoreFor(SARAH.id)).toBe(250);

    engine.awardManually(SARAH.id, -100);
    expect(engine.scoreFor(SARAH.id)).toBe(150);
  });

  it('builds a leaderboard sorted by score', () => {
    toInput();
    engine.submit(SARAH, 'b', PLAYERS);
    run('LOCK_SUBMISSIONS', 'SHOW_RESULTS', 'SHOW_LEADERBOARD');

    const view = engine.displayView(PLAYERS);
    expect(view.kind).toBe('leaderboard');
    if (view.kind !== 'leaderboard') return;
    expect(view.rows[0]?.playerName).toBe('Sarah');
    expect(view.rows[0]?.score).toBe(100);
    expect(view.rows[0]?.rank).toBe(1);
    expect(view.rows[0]?.delta).toBe(100);
  });

  it('exposes a single player standing', () => {
    toInput();
    engine.submit(SARAH, 'b', PLAYERS);
    run('LOCK_SUBMISSIONS', 'SHOW_RESULTS');

    expect(engine.standingFor(SARAH.id, PLAYERS)).toEqual({
      score: 100,
      rank: 1,
      delta: 100,
      totalPlayers: 3,
    });
  });
});

describe('views', () => {
  it('shows the lobby before a game starts', () => {
    expect(engine.displayView(PLAYERS).kind).toBe('lobby');
  });

  it('gives phones the question during PLAYER_INPUT', () => {
    toInput();
    const view = engine.playerView(SARAH, PLAYERS);

    expect(view.kind).toBe('choose');
    if (view.kind !== 'choose') return;
    expect(view.prompt).toBe('What is 2 + 2?');
    expect(view.selectedOptionId).toBeNull();
  });

  it('returns a reconnecting player their existing answer', () => {
    toInput();
    engine.submit(SARAH, 'b', PLAYERS);

    const view = engine.playerView(SARAH, PLAYERS);
    expect(view.kind).toBe('choose');
    if (view.kind !== 'choose') return;
    expect(view.selectedOptionId).toBe('b');
  });

  it('tallies answers on the reveal screen', () => {
    toInput();
    engine.submit(SARAH, 'b', PLAYERS);
    engine.submit(DAVID, 'b', PLAYERS);
    run('LOCK_SUBMISSIONS', 'REVEAL');

    const view = engine.displayView(PLAYERS);
    expect(view.kind).toBe('reveal');
    if (view.kind !== 'reveal') return;
    expect(view.tallies).toEqual({ a: 0, b: 2 });
    expect(view.correctOptionId).toBe('b');
  });

  it('tells a player who never answered that they missed it', () => {
    toInput();
    run('LOCK_SUBMISSIONS', 'REVEAL');

    const view = engine.playerView(JUDY, PLAYERS);
    expect(view.kind).toBe('round_result');
    if (view.kind !== 'round_result') return;
    expect(view.correct).toBe(false);
  });

  it('shows the answered count on the TV', () => {
    toInput();
    engine.submit(SARAH, 'b', PLAYERS);

    const view = engine.displayView(PLAYERS);
    expect(view.kind).toBe('question');
    if (view.kind !== 'question') return;
    expect(view.answered).toBe(1);
    expect(view.expected).toBe(3);
    expect(view.locked).toBe(false);
  });
});
