import { beforeEach, describe, expect, it } from 'vitest';
import {
  DRAWING_COLORS,
  DRAWING_GRID,
  MAX_POINTS_PER_STROKE,
  MAX_STROKES_PER_DRAWING,
  type DrawStroke,
  type PublicPlayer,
} from '../shared/src/index';
import { GameEngine } from '../server/src/engine/engine';
import { DrawThisGame, type DrawThisConfig } from '../server/src/games/drawThis';
import { DEFAULT_SCORING } from '../server/src/scoring/strategies';

const CONFIG: DrawThisConfig = {
  id: 'draw-this',
  name: 'Draw This',
  scoring: { ...DEFAULT_SCORING, specialPick: 150 },
  rounds: [{ prompt: "Judy's dream living room, inside Hogwarts." }, { prompt: 'And this one?' }],
};

function player(id: string, name: string, role: 'PLAYER' | 'SPECIAL' = 'PLAYER'): PublicPlayer {
  return { id, name, role, connected: true, joinedAt: 0 };
}

const SARAH = player('p1', 'Sarah');
const DAVID = player('p2', 'David');
const JUDY = player('p3', 'Judy', 'SPECIAL');
const PLAYERS = [SARAH, DAVID, JUDY];

function stroke(overrides: Partial<DrawStroke> = {}): DrawStroke {
  return { points: [0, 0, 100, 100, 200, 50], size: 'thin', ...overrides };
}

function drawing(strokes: DrawStroke[] = [stroke()]): string {
  return JSON.stringify(strokes);
}

let engine: GameEngine;

beforeEach(() => {
  engine = new GameEngine({ games: [new DrawThisGame(CONFIG)], specialPlayerName: 'Judy' });
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

describe('submitting a drawing', () => {
  it('accepts a simple drawing', () => {
    openInput();
    expect(engine.submit(SARAH, drawing(), PLAYERS)).toEqual({ ok: true });
  });

  it('accepts thin and thick strokes, and an eraser stroke', () => {
    openInput();
    const result = engine.submit(
      SARAH,
      drawing([stroke({ size: 'thick' }), stroke({ erase: true })]),
      PLAYERS,
    );
    expect(result).toEqual({ ok: true });
  });

  it('accepts every canonical drawing color and preserves it for judging', () => {
    const colorPlayers = [
      SARAH,
      DAVID,
      player('p4', 'Alex'),
      player('p5', 'Morgan'),
      player('p6', 'Riley'),
      JUDY,
    ];
    openInput(colorPlayers);
    for (const [index, color] of DRAWING_COLORS.entries()) {
      expect(engine.submit(colorPlayers[index]!, drawing([stroke({ color })]), colorPlayers)).toEqual({
        ok: true,
      });
    }
    act('LOCK_SUBMISSIONS', colorPlayers);
    act('REVEAL', colorPlayers);

    const view = engine.playerView(JUDY, colorPlayers);
    expect(view.kind).toBe('judge');
    if (view.kind !== 'judge') return;
    expect(
      view.entries.flatMap((entry) => (entry.strokes ?? []).map((submitted) => submitted.color)),
    ).toEqual([...DRAWING_COLORS]);
  });

  it('accepts a legacy stroke without a color', () => {
    openInput();
    expect(engine.submit(SARAH, drawing([stroke()]), PLAYERS)).toEqual({ ok: true });
  });

  it.each(['purple', 7, null])('rejects invalid drawing color %j', (color) => {
    openInput();
    const result = engine.submit(
      SARAH,
      JSON.stringify([{ points: [0, 0, 100, 100], size: 'thin', color }]),
      PLAYERS,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('invalid_value');
  });

  it('strips color from sanitized eraser strokes', () => {
    openInput();
    expect(engine.submit(SARAH, drawing([stroke({ erase: true, color: 'red' })]), PLAYERS)).toEqual({
      ok: true,
    });
    act('LOCK_SUBMISSIONS');
    act('REVEAL');

    const view = engine.playerView(JUDY, PLAYERS);
    expect(view.kind).toBe('judge');
    if (view.kind !== 'judge') return;
    expect(view.entries[0]?.strokes).toEqual([{ points: stroke().points, size: 'thin', erase: true }]);
  });

  it('rejects an empty drawing', () => {
    openInput();
    const result = engine.submit(SARAH, drawing([]), PLAYERS);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('invalid_value');
  });

  it('rejects malformed JSON', () => {
    openInput();
    const result = engine.submit(SARAH, 'not json', PLAYERS);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('invalid_value');
  });

  it('rejects too many strokes', () => {
    openInput();
    const strokes = Array.from({ length: MAX_STROKES_PER_DRAWING + 1 }, () => stroke());
    const result = engine.submit(SARAH, drawing(strokes), PLAYERS);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('invalid_value');
  });

  it('accepts exactly the stroke cap', () => {
    openInput();
    const strokes = Array.from({ length: MAX_STROKES_PER_DRAWING }, () => stroke());
    expect(engine.submit(SARAH, drawing(strokes), PLAYERS)).toEqual({ ok: true });
  });

  it('rejects too many points in a single stroke', () => {
    openInput();
    const points = Array.from({ length: (MAX_POINTS_PER_STROKE + 1) * 2 }, (_v, i) => i % DRAWING_GRID);
    const result = engine.submit(SARAH, drawing([{ points, size: 'thin' }]), PLAYERS);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('invalid_value');
  });

  it('rejects an odd number of coordinates', () => {
    openInput();
    const result = engine.submit(SARAH, drawing([{ points: [0, 0, 100], size: 'thin' }]), PLAYERS);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('invalid_value');
  });

  it('rejects coordinates outside the grid', () => {
    openInput();
    const tooFar = engine.submit(
      SARAH,
      drawing([{ points: [0, 0, DRAWING_GRID + 1, 0], size: 'thin' }]),
      PLAYERS,
    );
    expect(tooFar.ok).toBe(false);

    const negative = engine.submit(SARAH, drawing([{ points: [-1, 0, 0, 0], size: 'thin' }]), PLAYERS);
    expect(negative.ok).toBe(false);
  });

  it('rejects non-integer coordinates', () => {
    openInput();
    const result = engine.submit(SARAH, drawing([{ points: [0.5, 0, 1, 1], size: 'thin' }]), PLAYERS);
    expect(result.ok).toBe(false);
  });

  it('rejects an invalid brush size', () => {
    openInput();
    const result = engine.submit(
      SARAH,
      JSON.stringify([{ points: [0, 0, 1, 1], size: 'huge' }]),
      PLAYERS,
    );
    expect(result.ok).toBe(false);
  });

  it('rejects the special player submitting a drawing', () => {
    openInput();
    const result = engine.submit(JUDY, drawing(), PLAYERS);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('not_playing');
  });

  it('rejects a duplicate submission', () => {
    openInput();
    engine.submit(SARAH, drawing(), PLAYERS);
    const second = engine.submit(SARAH, drawing([stroke({ size: 'thick' })]), PLAYERS);
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.code).toBe('already_submitted');
  });

  it('rejects a late submission once locked', () => {
    openInput();
    act('LOCK_SUBMISSIONS');
    const result = engine.submit(SARAH, drawing(), PLAYERS);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('wrong_phase');
  });
});

describe('anonymity', () => {
  it('hides player names from the gallery before reveal', () => {
    openInput();
    engine.submit(SARAH, drawing(), PLAYERS);
    engine.submit(DAVID, drawing([stroke({ size: 'thick' })]), PLAYERS);
    act('LOCK_SUBMISSIONS');
    act('REVEAL');

    const view = engine.displayView(PLAYERS);
    expect(view.kind).toBe('drawing_gallery');
    if (view.kind !== 'drawing_gallery') return;
    expect(view.revealed).toBe(false);
    expect(JSON.stringify(view)).not.toContain('Sarah');
    expect(JSON.stringify(view)).not.toContain('David');
    expect(view.entries).toHaveLength(2);
  });

  it('reveals names and the winner at results', () => {
    openInput();
    engine.submit(SARAH, drawing(), PLAYERS);
    act('LOCK_SUBMISSIONS');
    engine.setSpecialPick(JUDY, SARAH.id);
    act('SHOW_RESULTS');

    const view = engine.displayView(PLAYERS);
    expect(view.kind).toBe('drawing_gallery');
    if (view.kind !== 'drawing_gallery') return;
    expect(view.revealed).toBe(true);
    expect(view.entries[0]?.playerName).toBe('Sarah');
    expect(view.entries[0]?.isWinner).toBe(true);
  });
});

describe('reconnect', () => {
  it('marks a player as having submitted without redrawing it for them', () => {
    openInput();
    engine.submit(SARAH, drawing(), PLAYERS);

    const view = engine.playerView(SARAH, PLAYERS);
    expect(view.kind === 'draw' && view.submitted).toBe(true);
  });

  it('does not mark someone else as submitted', () => {
    openInput();
    engine.submit(SARAH, drawing(), PLAYERS);

    const view = engine.playerView(DAVID, PLAYERS);
    expect(view.kind === 'draw' && view.submitted).toBe(false);
  });

  it('clears drawings when the host restarts the round', () => {
    openInput();
    engine.submit(SARAH, drawing(), PLAYERS);
    act('RESTART_ROUND');

    expect(engine.submissionCount()).toBe(0);
  });
});

describe("Judy picking a winner", () => {
  it('picks among submitted drawings and scores the winner', () => {
    openInput();
    engine.submit(SARAH, drawing(), PLAYERS);
    engine.submit(DAVID, drawing([stroke({ size: 'thick' })]), PLAYERS);
    act('LOCK_SUBMISSIONS');
    expect(engine.setSpecialPick(JUDY, DAVID.id)).toEqual({ ok: true });
    act('SHOW_RESULTS');

    expect(engine.scoreFor(DAVID.id)).toBe(150);
    expect(engine.scoreFor(SARAH.id)).toBe(0);
  });

  it('rejects picking a non-submitter', () => {
    openInput();
    engine.submit(SARAH, drawing(), PLAYERS);
    act('LOCK_SUBMISSIONS');
    const result = engine.setSpecialPick(JUDY, DAVID.id);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('invalid_value');
  });

  it('gives Judy anonymous stroke data to judge', () => {
    openInput();
    engine.submit(SARAH, drawing(), PLAYERS);
    act('LOCK_SUBMISSIONS');
    act('REVEAL');

    const view = engine.playerView(JUDY, PLAYERS);
    expect(view.kind).toBe('judge');
    if (view.kind !== 'judge') return;
    expect(view.entries[0]?.strokes).toEqual([stroke()]);
    expect(JSON.stringify(view)).not.toContain('"name"');
  });
});

describe('incomplete rounds', () => {
  it('scores nothing when nobody submitted', () => {
    openInput();
    act('LOCK_SUBMISSIONS');
    act('SHOW_RESULTS');

    expect(engine.scoreFor(SARAH.id)).toBe(0);
    expect(engine.scoreFor(DAVID.id)).toBe(0);
  });

  it('scores nothing when she never picks', () => {
    openInput();
    engine.submit(SARAH, drawing(), PLAYERS);
    act('LOCK_SUBMISSIONS');
    act('SHOW_RESULTS');

    expect(engine.scoreFor(SARAH.id)).toBe(0);
  });

  it('does not advance on its own', () => {
    openInput();
    engine.submit(SARAH, drawing(), PLAYERS);
    engine.submit(DAVID, drawing(), PLAYERS);

    expect(engine.currentPhase()).toBe('PLAYER_INPUT');
  });
});
