import { beforeEach, describe, expect, it } from 'vitest';
import { MAX_CAPTION_LENGTH, type PublicPlayer } from '../shared/src/index';
import { GameEngine } from '../server/src/engine/engine';
import { CaptionThisGame, type CaptionThisConfig } from '../server/src/games/captionThis';
import { DEFAULT_SCORING } from '../server/src/scoring/strategies';

const CONFIG: CaptionThisConfig = {
  id: 'caption-this',
  name: 'Caption This',
  scoring: { ...DEFAULT_SCORING, specialPick: 150 },
  rounds: [
    { prompt: 'Judy when the kitchen island is 15cm too short.', imageUrl: '/assets/placeholder/room-01.svg' },
    { prompt: 'And this one?', imageUrl: null },
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
  engine = new GameEngine({ games: [new CaptionThisGame(CONFIG)], specialPlayerName: 'Judy' });
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

describe('submitting a caption', () => {
  it('accepts a normal caption', () => {
    openInput();
    expect(engine.submit(SARAH, 'A cry for help.', PLAYERS)).toEqual({ ok: true });
  });

  it('rejects an empty caption', () => {
    openInput();
    const result = engine.submit(SARAH, '   ', PLAYERS);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('invalid_value');
  });

  it('rejects a caption over the max length', () => {
    openInput();
    const result = engine.submit(SARAH, 'x'.repeat(MAX_CAPTION_LENGTH + 1), PLAYERS);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('invalid_value');
  });

  it('trims a caption before storing it', () => {
    openInput();
    engine.submit(SARAH, '  Nice lamp.  ', PLAYERS);
    const view = engine.playerView(SARAH, PLAYERS);
    expect(view.kind === 'caption' && view.submittedText).toBe('Nice lamp.');
  });

  it('rejects a duplicate caption and keeps the first', () => {
    openInput();
    engine.submit(SARAH, 'First.', PLAYERS);
    const second = engine.submit(SARAH, 'Second.', PLAYERS);

    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.code).toBe('already_submitted');

    const view = engine.playerView(SARAH, PLAYERS);
    expect(view.kind === 'caption' && view.submittedText).toBe('First.');
  });

  it('rejects the special player submitting a caption', () => {
    openInput();
    const result = engine.submit(JUDY, 'Judy should not caption.', PLAYERS);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('not_playing');
  });

  it('rejects a late caption once locked', () => {
    openInput();
    act('LOCK_SUBMISSIONS');
    const result = engine.submit(SARAH, 'Too late.', PLAYERS);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('wrong_phase');
  });

  it('expects a caption from everyone except the special player', () => {
    openInput();
    expect(engine.snapshot(PLAYERS).expectedCount).toBe(3);
  });
});

describe('anonymity', () => {
  it('hides player names from the caption view', () => {
    openInput();
    engine.submit(SARAH, 'A cry for help.', PLAYERS);
    engine.submit(DAVID, 'This is fine.', PLAYERS);
    act('LOCK_SUBMISSIONS');
    act('REVEAL');

    const view = engine.displayView(PLAYERS);
    expect(view.kind).toBe('caption_gallery');
    if (view.kind !== 'caption_gallery') return;
    expect(view.revealed).toBe(false);
    expect(JSON.stringify(view)).not.toContain('Sarah');
    expect(JSON.stringify(view)).not.toContain('David');
    expect(view.entries.map((e) => e.text).sort()).toEqual(['A cry for help.', 'This is fine.']);
  });

  it('gives Judy the same anonymous entries to judge', () => {
    openInput();
    engine.submit(SARAH, 'A cry for help.', PLAYERS);
    act('LOCK_SUBMISSIONS');
    act('REVEAL');

    const view = engine.playerView(JUDY, PLAYERS);
    expect(view.kind).toBe('judge');
    if (view.kind !== 'judge') return;
    expect(view.entries).toEqual([{ id: 'p1', text: 'A cry for help.' }]);
    expect(JSON.stringify(view)).not.toContain('"name"');
  });

  it('reveals names and the winner only at results', () => {
    openInput();
    engine.submit(SARAH, 'A cry for help.', PLAYERS);
    engine.submit(DAVID, 'This is fine.', PLAYERS);
    act('LOCK_SUBMISSIONS');
    act('REVEAL');
    engine.setSpecialPick(JUDY, SARAH.id);
    act('SHOW_RESULTS');

    const view = engine.displayView(PLAYERS);
    expect(view.kind).toBe('caption_gallery');
    if (view.kind !== 'caption_gallery') return;
    expect(view.revealed).toBe(true);
    const sarahEntry = view.entries.find((e) => e.id === SARAH.id);
    expect(sarahEntry?.playerName).toBe('Sarah');
    expect(sarahEntry?.isWinner).toBe(true);
    expect(view.entries.find((e) => e.id === DAVID.id)?.isWinner).toBe(false);
  });
});

describe("Judy picking a winner", () => {
  it('rejects a pick before submissions lock', () => {
    openInput();
    engine.submit(SARAH, 'Sarah says this.', PLAYERS);
    const result = engine.setSpecialPick(JUDY, SARAH.id);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('wrong_phase');
  });

  it('accepts a pick once locked', () => {
    openInput();
    engine.submit(SARAH, 'Sarah says this.', PLAYERS);
    act('LOCK_SUBMISSIONS');
    expect(engine.setSpecialPick(JUDY, SARAH.id)).toEqual({ ok: true });
  });

  it('rejects picking someone who did not submit', () => {
    openInput();
    engine.submit(SARAH, 'Sarah says this.', PLAYERS);
    act('LOCK_SUBMISSIONS');
    const result = engine.setSpecialPick(JUDY, DAVID.id);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('invalid_value');
  });

  it('rejects a pick from anyone but the special player', () => {
    openInput();
    engine.submit(SARAH, 'Sarah says this.', PLAYERS);
    act('LOCK_SUBMISSIONS');
    const result = engine.setSpecialPick(DAVID, SARAH.id);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('not_playing');
  });

  it('lets her change her mind up through the reveal', () => {
    openInput();
    engine.submit(SARAH, 'Sarah says this.', PLAYERS);
    engine.submit(DAVID, 'David says that.', PLAYERS);
    act('LOCK_SUBMISSIONS');
    engine.setSpecialPick(JUDY, SARAH.id);
    act('REVEAL');
    expect(engine.setSpecialPick(JUDY, DAVID.id)).toEqual({ ok: true });
    expect(engine.currentSpecialPick()).toBe(DAVID.id);
  });

  it('clears the pick when she sends an empty target', () => {
    openInput();
    engine.submit(SARAH, 'Sarah says this.', PLAYERS);
    act('LOCK_SUBMISSIONS');
    engine.setSpecialPick(JUDY, SARAH.id);
    engine.setSpecialPick(JUDY, '');
    expect(engine.currentSpecialPick()).toBeNull();
  });

  it('locks the pick once results are shown', () => {
    openInput();
    engine.submit(SARAH, 'Sarah says this.', PLAYERS);
    act('LOCK_SUBMISSIONS');
    engine.setSpecialPick(JUDY, SARAH.id);
    act('SHOW_RESULTS');

    const result = engine.setSpecialPick(JUDY, SARAH.id);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('wrong_phase');
  });

  it('clears the pick between rounds', () => {
    openInput();
    engine.submit(SARAH, 'Sarah says this.', PLAYERS);
    act('LOCK_SUBMISSIONS');
    engine.setSpecialPick(JUDY, SARAH.id);
    act('SHOW_RESULTS');
    act('NEXT_ROUND');

    expect(engine.currentSpecialPick()).toBeNull();
  });
});

describe('reconnect', () => {
  it('echoes a player their own submitted caption', () => {
    openInput();
    engine.submit(SARAH, 'Sarah says this.', PLAYERS);

    const view = engine.playerView(SARAH, PLAYERS);
    expect(view.kind === 'caption' && view.submittedText).toBe('Sarah says this.');
  });

  it('does not give one player another player caption', () => {
    openInput();
    engine.submit(SARAH, 'Sarah says this.', PLAYERS);

    const view = engine.playerView(DAVID, PLAYERS);
    expect(view.kind === 'caption' && view.submittedText).toBeNull();
  });

  it('clears captions when the host restarts the round', () => {
    openInput();
    engine.submit(SARAH, 'Sarah says this.', PLAYERS);
    act('RESTART_ROUND');

    expect(engine.submissionCount()).toBe(0);
    act('OPEN_INPUT');
    const view = engine.playerView(SARAH, PLAYERS);
    expect(view.kind === 'caption' && view.submittedText).toBeNull();
  });
});

describe('scoring', () => {
  it('awards the picked winner and nobody else', () => {
    openInput();
    engine.submit(SARAH, 'Sarah says this.', PLAYERS);
    engine.submit(DAVID, 'David says that.', PLAYERS);
    engine.submit(MIA, 'Mia says other.', PLAYERS);
    act('LOCK_SUBMISSIONS');
    engine.setSpecialPick(JUDY, DAVID.id);
    act('SHOW_RESULTS');

    expect(engine.scoreFor(DAVID.id)).toBe(150);
    expect(engine.scoreFor(SARAH.id)).toBe(0);
    expect(engine.scoreFor(MIA.id)).toBe(0);
    expect(engine.scoreFor(JUDY.id)).toBe(0);
  });

  it('scores nothing when she never picks', () => {
    openInput();
    engine.submit(SARAH, 'Sarah says this.', PLAYERS);
    act('LOCK_SUBMISSIONS');
    act('SHOW_RESULTS');

    expect(engine.scoreFor(SARAH.id)).toBe(0);
  });

  it('takes the points back when the host restarts a scored round', () => {
    openInput();
    engine.submit(SARAH, 'Sarah says this.', PLAYERS);
    act('LOCK_SUBMISSIONS');
    engine.setSpecialPick(JUDY, SARAH.id);
    act('SHOW_RESULTS');
    expect(engine.scoreFor(SARAH.id)).toBe(150);

    act('RESTART_ROUND');
    expect(engine.scoreFor(SARAH.id)).toBe(0);
  });

  it('accumulates across rounds', () => {
    openInput();
    engine.submit(SARAH, 'One.', PLAYERS);
    act('LOCK_SUBMISSIONS');
    engine.setSpecialPick(JUDY, SARAH.id);
    act('SHOW_RESULTS');
    act('NEXT_ROUND');
    act('OPEN_INPUT');
    engine.submit(SARAH, 'Two.', PLAYERS);
    act('LOCK_SUBMISSIONS');
    engine.setSpecialPick(JUDY, SARAH.id);
    act('SHOW_RESULTS');

    expect(engine.scoreFor(SARAH.id)).toBe(300);
  });
});

describe('results view for players', () => {
  it('tells the winner they won', () => {
    openInput();
    engine.submit(SARAH, 'Sarah says this.', PLAYERS);
    act('LOCK_SUBMISSIONS');
    engine.setSpecialPick(JUDY, SARAH.id);
    act('REVEAL');
    act('SHOW_RESULTS');

    const view = engine.playerView(SARAH, PLAYERS);
    expect(view.kind === 'round_result' && view.correct).toBe(true);
  });

  it('tells everyone else they did not win', () => {
    openInput();
    engine.submit(SARAH, 'Sarah says this.', PLAYERS);
    engine.submit(DAVID, 'David says that.', PLAYERS);
    act('LOCK_SUBMISSIONS');
    engine.setSpecialPick(JUDY, SARAH.id);
    act('SHOW_RESULTS');

    const view = engine.playerView(DAVID, PLAYERS);
    expect(view.kind === 'round_result' && view.correct).toBe(false);
  });

  it('never marks the special player right or wrong', () => {
    openInput();
    engine.submit(SARAH, 'Sarah says this.', PLAYERS);
    act('LOCK_SUBMISSIONS');
    engine.setSpecialPick(JUDY, SARAH.id);
    act('SHOW_RESULTS');

    const view = engine.playerView(JUDY, PLAYERS);
    expect(view.kind === 'round_result' && view.correct).toBeNull();
  });

  it('tells a player who never submitted that they missed it', () => {
    openInput();
    engine.submit(SARAH, 'Sarah says this.', PLAYERS);
    act('LOCK_SUBMISSIONS');
    engine.setSpecialPick(JUDY, SARAH.id);
    act('SHOW_RESULTS');

    const view = engine.playerView(DAVID, PLAYERS);
    expect(view.kind === 'round_result' && view.correct).toBe(false);
  });
});

describe('host progression', () => {
  it('does not advance on its own once everyone has captioned', () => {
    openInput();
    engine.submit(SARAH, 'a', PLAYERS);
    engine.submit(DAVID, 'b', PLAYERS);
    engine.submit(MIA, 'c', PLAYERS);

    expect(engine.currentPhase()).toBe('PLAYER_INPUT');
  });

  it('does not offer REVEAL before submissions are locked', () => {
    openInput();
    expect(engine.availableActions().some((a) => a.action === 'REVEAL')).toBe(false);
    act('LOCK_SUBMISSIONS');
    expect(engine.availableActions().some((a) => a.action === 'REVEAL')).toBe(true);
  });
});
