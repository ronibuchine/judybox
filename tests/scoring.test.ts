import { beforeEach, describe, expect, it } from 'vitest';
import type { PublicPlayer } from '../shared/src/index';
import { Scoreboard, type ScoringEvent } from '../server/src/scoring/scoreboard';
import {
  awardByDistance,
  awardChosenWinner,
  awardClosestNumeric,
  awardCorrectAnswer,
  awardPredictedSpecial,
  manualAward,
  DEFAULT_SCORING,
} from '../server/src/scoring/strategies';
import type { Submission } from '../server/src/engine/types';

function player(id: string, name: string, role: 'PLAYER' | 'SPECIAL' = 'PLAYER'): PublicPlayer {
  return { id, name, role, connected: true, joinedAt: 0 };
}

const SARAH = player('p1', 'Sarah');
const DAVID = player('p2', 'David');
const RONI = player('p3', 'Roni');
const JUDY = player('p4', 'Judy', 'SPECIAL');
const PLAYERS = [SARAH, DAVID, RONI, JUDY];

function submissions(entries: Record<string, string>): Map<string, Submission> {
  const map = new Map<string, Submission>();
  for (const [playerId, value] of Object.entries(entries)) {
    map.set(playerId, { playerId, value, submittedAt: 0 });
  }
  return map;
}

let board: Scoreboard;

beforeEach(() => {
  board = new Scoreboard();
});

describe('Scoreboard accounting', () => {
  it('starts everyone at zero', () => {
    expect(board.scoreFor(SARAH.id)).toBe(0);
    expect(board.standings(PLAYERS).every((row) => row.score === 0)).toBe(true);
  });

  it('applies a batch once', () => {
    const events: ScoringEvent[] = [{ playerId: SARAH.id, reason: 'correct_answer', points: 100 }];
    expect(board.apply('r1', events)).toBe(true);
    expect(board.scoreFor(SARAH.id)).toBe(100);
  });

  it('refuses to apply the same batch twice', () => {
    const events: ScoringEvent[] = [{ playerId: SARAH.id, reason: 'correct_answer', points: 100 }];
    board.apply('r1', events);

    expect(board.apply('r1', events)).toBe(false);
    expect(board.scoreFor(SARAH.id)).toBe(100);
  });

  it('accumulates across different batches', () => {
    board.apply('r1', [{ playerId: SARAH.id, reason: 'correct_answer', points: 100 }]);
    board.apply('r2', [{ playerId: SARAH.id, reason: 'correct_answer', points: 50 }]);

    expect(board.scoreFor(SARAH.id)).toBe(150);
  });

  it('reverts a batch exactly', () => {
    board.apply('r1', [{ playerId: SARAH.id, reason: 'correct_answer', points: 100 }]);
    expect(board.revert('r1')).toBe(true);

    expect(board.scoreFor(SARAH.id)).toBe(0);
    expect(board.hasScored('r1')).toBe(false);
  });

  it('allows re-scoring after a revert', () => {
    board.apply('r1', [{ playerId: SARAH.id, reason: 'correct_answer', points: 100 }]);
    board.revert('r1');
    board.apply('r1', [{ playerId: DAVID.id, reason: 'correct_answer', points: 100 }]);

    expect(board.scoreFor(SARAH.id)).toBe(0);
    expect(board.scoreFor(DAVID.id)).toBe(100);
  });

  it('ignores reverting an unknown batch', () => {
    expect(board.revert('never-happened')).toBe(false);
  });

  it('reverts every batch belonging to one game', () => {
    board.apply('quiz:0', [{ playerId: SARAH.id, reason: 'correct_answer', points: 100 }]);
    board.apply('quiz:1', [{ playerId: SARAH.id, reason: 'correct_answer', points: 100 }]);
    board.apply('other:0', [{ playerId: SARAH.id, reason: 'correct_answer', points: 25 }]);

    expect(board.revertMatching('quiz:')).toBe(2);
    expect(board.scoreFor(SARAH.id)).toBe(25);
  });

  it('handles negative and zero point events', () => {
    board.apply('r1', [
      { playerId: SARAH.id, reason: 'penalty', points: -50 },
      { playerId: DAVID.id, reason: 'nothing', points: 0 },
    ]);

    expect(board.scoreFor(SARAH.id)).toBe(-50);
    expect(board.scoreFor(DAVID.id)).toBe(0);
  });

  it('ranks a negative score below zero', () => {
    board.apply('r1', [{ playerId: SARAH.id, reason: 'penalty', points: -50 }]);
    const rows = board.standings([SARAH, DAVID]);

    expect(rows[0]?.playerName).toBe('David');
    expect(rows[1]?.playerName).toBe('Sarah');
  });

  it('clears everything on reset', () => {
    board.apply('r1', [{ playerId: SARAH.id, reason: 'correct_answer', points: 100 }]);
    board.reset();

    expect(board.scoreFor(SARAH.id)).toBe(0);
    expect(board.hasScored('r1')).toBe(false);
  });
});

describe('Scoreboard ranking', () => {
  it('orders by score descending', () => {
    board.apply('r1', [
      { playerId: SARAH.id, reason: 'x', points: 300 },
      { playerId: DAVID.id, reason: 'x', points: 200 },
      { playerId: RONI.id, reason: 'x', points: 100 },
    ]);

    expect(board.standings(PLAYERS).map((row) => row.playerName)).toEqual([
      'Sarah',
      'David',
      'Roni',
      'Judy',
    ]);
  });

  it('gives tied players the same rank and skips the next', () => {
    board.apply('r1', [
      { playerId: SARAH.id, reason: 'x', points: 100 },
      { playerId: DAVID.id, reason: 'x', points: 100 },
      { playerId: RONI.id, reason: 'x', points: 50 },
    ]);

    const rows = board.standings([SARAH, DAVID, RONI]);
    expect(rows.map((row) => row.rank)).toEqual([1, 1, 3]);
  });

  it('breaks display ties by name for stable ordering', () => {
    board.apply('r1', [
      { playerId: RONI.id, reason: 'x', points: 100 },
      { playerId: DAVID.id, reason: 'x', points: 100 },
    ]);

    expect(board.standings([RONI, DAVID]).map((row) => row.playerName)).toEqual(['David', 'Roni']);
  });

  it('ranks everyone first when all scores are zero', () => {
    expect(board.standings([SARAH, DAVID]).map((row) => row.rank)).toEqual([1, 1]);
  });

  it('reports the delta from the most recent batch only', () => {
    board.apply('r1', [{ playerId: SARAH.id, reason: 'x', points: 100 }]);
    board.apply('r2', [{ playerId: SARAH.id, reason: 'x', points: 40 }]);

    expect(board.scoreFor(SARAH.id)).toBe(140);
    expect(board.deltaFor(SARAH.id)).toBe(40);
    expect(board.deltaFor(DAVID.id)).toBe(0);
  });

  it('gives a single player their own standing', () => {
    board.apply('r1', [{ playerId: DAVID.id, reason: 'x', points: 100 }]);
    const standing = board.standingFor(DAVID.id, [SARAH, DAVID]);

    expect(standing).toEqual({ score: 100, rank: 1, delta: 100, totalPlayers: 2 });
  });

  it('returns no standing for someone not in the roster', () => {
    expect(board.standingFor('ghost', PLAYERS)).toBeNull();
  });
});

describe('strategy: correct answer', () => {
  it('awards everyone who matched', () => {
    const events = awardCorrectAnswer(
      submissions({ [SARAH.id]: 'b', [DAVID.id]: 'a', [RONI.id]: 'b' }),
      'b',
      100,
    );

    expect(events).toHaveLength(2);
    expect(events.every((event) => event.points === 100)).toBe(true);
    expect(events.map((event) => event.playerId).sort()).toEqual([SARAH.id, RONI.id].sort());
  });

  it('awards nothing when there is no correct answer', () => {
    expect(awardCorrectAnswer(submissions({ [SARAH.id]: 'b' }), null, 100)).toEqual([]);
  });

  it('awards nothing when nobody was right', () => {
    expect(awardCorrectAnswer(submissions({ [SARAH.id]: 'a' }), 'b', 100)).toEqual([]);
  });
});

describe('strategy: closest numeric', () => {
  it('awards by finishing place', () => {
    const events = awardClosestNumeric(
      submissions({ [SARAH.id]: '70', [DAVID.id]: '60', [RONI.id]: '10' }),
      72,
      [100, 60, 30],
    );

    expect(events).toEqual([
      { playerId: SARAH.id, reason: 'closest_place_1', points: 100 },
      { playerId: DAVID.id, reason: 'closest_place_2', points: 60 },
      { playerId: RONI.id, reason: 'closest_place_3', points: 30 },
    ]);
  });

  it('gives tied distances the same place and consumes the next', () => {
    // 70 and 74 are both 2 away from 72; 60 comes third.
    const events = awardClosestNumeric(
      submissions({ [SARAH.id]: '70', [DAVID.id]: '74', [RONI.id]: '60' }),
      72,
      [100, 60, 30],
    );

    const points = new Map(events.map((event) => [event.playerId, event.points]));
    expect(points.get(SARAH.id)).toBe(100);
    expect(points.get(DAVID.id)).toBe(100);
    expect(points.get(RONI.id)).toBe(30);
  });

  it('awards nothing beyond the configured places', () => {
    const events = awardClosestNumeric(
      submissions({ [SARAH.id]: '70', [DAVID.id]: '60', [RONI.id]: '10' }),
      72,
      [100],
    );

    expect(events).toHaveLength(1);
    expect(events[0]?.playerId).toBe(SARAH.id);
  });

  it('ignores non-numeric guesses', () => {
    const events = awardClosestNumeric(
      submissions({ [SARAH.id]: 'banana', [DAVID.id]: '70' }),
      72,
      [100],
    );

    expect(events).toHaveLength(1);
    expect(events[0]?.playerId).toBe(DAVID.id);
  });

  it('excludes the special player from their own guessing round', () => {
    const events = awardClosestNumeric(
      submissions({ [JUDY.id]: '72', [SARAH.id]: '70' }),
      72,
      [100],
      [JUDY.id],
    );

    expect(events).toHaveLength(1);
    expect(events[0]?.playerId).toBe(SARAH.id);
  });

  it('awards nobody when there are no submissions', () => {
    expect(awardClosestNumeric(submissions({}), 72, [100])).toEqual([]);
  });
});

describe('strategy: predicting the special player', () => {
  it('awards players who matched the special answer', () => {
    const events = awardPredictedSpecial(
      submissions({ [JUDY.id]: 'love', [SARAH.id]: 'love', [DAVID.id]: 'no' }),
      JUDY.id,
      100,
    );

    expect(events).toEqual([{ playerId: SARAH.id, reason: 'predicted_special', points: 100 }]);
  });

  it('never awards the special player for matching themselves', () => {
    const events = awardPredictedSpecial(
      submissions({ [JUDY.id]: 'love', [SARAH.id]: 'love' }),
      JUDY.id,
      100,
    );

    expect(events.some((event) => event.playerId === JUDY.id)).toBe(false);
  });

  it('awards nothing when the special player did not answer', () => {
    expect(awardPredictedSpecial(submissions({ [SARAH.id]: 'love' }), JUDY.id, 100)).toEqual([]);
  });

  it('awards nothing when there is no special player', () => {
    expect(awardPredictedSpecial(submissions({ [SARAH.id]: 'love' }), null, 100)).toEqual([]);
  });
});

describe('strategy: chosen winner and manual award', () => {
  it('awards the chosen winner', () => {
    expect(awardChosenWinner(SARAH.id, 150)).toEqual([
      { playerId: SARAH.id, reason: 'chosen_winner', points: 150 },
    ]);
  });

  it('awards nothing when no winner was chosen', () => {
    expect(awardChosenWinner(null, 150)).toEqual([]);
  });

  it('supports positive and negative host awards', () => {
    expect(manualAward(SARAH.id, 100)).toEqual([
      { playerId: SARAH.id, reason: 'host_award', points: 100 },
    ]);
    expect(manualAward(SARAH.id, -100)[0]?.points).toBe(-100);
  });

  it('ignores a zero-point award', () => {
    expect(manualAward(SARAH.id, 0)).toEqual([]);
  });
});

describe('default scoring configuration', () => {
  it('provides sensible defaults for every strategy', () => {
    expect(DEFAULT_SCORING.correctAnswer).toBeGreaterThan(0);
    expect(DEFAULT_SCORING.closestPlaces.length).toBeGreaterThan(0);
    expect(DEFAULT_SCORING.predictSpecial).toBeGreaterThan(0);
    expect(DEFAULT_SCORING.specialPick).toBeGreaterThan(0);
    expect(DEFAULT_SCORING.manualStep).toBeGreaterThan(0);
    expect(DEFAULT_SCORING.distance.bands.length).toBeGreaterThan(0);
  });
});

describe('awardByDistance', () => {
  const BANDS = {
    bands: [
      { within: 0, points: 500 },
      { within: 5, points: 400 },
      { within: 10, points: 300 },
      { within: 20, points: 150 },
    ],
    otherwise: 0,
  };

  it('puts each guess in its nearest band', () => {
    const events = awardByDistance(
      submissions({ p1: '40', p2: '45', p3: '50' }),
      40,
      BANDS,
    );

    expect(events).toEqual([
      { playerId: 'p1', reason: 'rating_exact', points: 500 },
      { playerId: 'p2', reason: 'rating_within_5', points: 400 },
      { playerId: 'p3', reason: 'rating_within_10', points: 300 },
    ]);
  });

  it('is absolute, not competitive: everyone in a band gets the same', () => {
    const events = awardByDistance(submissions({ p1: '41', p2: '39', p3: '42' }), 40, BANDS);
    expect(events.map((event) => event.points)).toEqual([400, 400, 400]);
  });

  it('treats band edges as inclusive', () => {
    const events = awardByDistance(submissions({ p1: '45', p2: '46' }), 40, BANDS);
    expect(events[0]?.points).toBe(400);
    expect(events[1]?.points).toBe(300);
  });

  it('applies otherwise beyond the widest band', () => {
    const generous = { ...BANDS, otherwise: 25 };
    const events = awardByDistance(submissions({ p1: '99' }), 0, generous);
    expect(events).toEqual([{ playerId: 'p1', reason: 'rating_otherwise', points: 25 }]);
  });

  it('emits nothing for a zero-point outcome', () => {
    expect(awardByDistance(submissions({ p1: '99' }), 0, BANDS)).toEqual([]);
  });

  it('honours bands given out of order', () => {
    const shuffled = {
      bands: [
        { within: 10, points: 300 },
        { within: 0, points: 500 },
        { within: 5, points: 400 },
      ],
      otherwise: 0,
    };
    expect(awardByDistance(submissions({ p1: '40' }), 40, shuffled)[0]?.points).toBe(500);
  });

  it('skips excluded players and non-numeric guesses', () => {
    const events = awardByDistance(
      submissions({ p1: '40', p2: '40', p3: 'nope' }),
      40,
      BANDS,
      ['p2'],
    );
    expect(events.map((event) => event.playerId)).toEqual(['p1']);
  });

  it('works with a single band and nothing else', () => {
    const strict = { bands: [{ within: 0, points: 1000 }], otherwise: 0 };
    const events = awardByDistance(submissions({ p1: '7', p2: '8' }), 7, strict);
    expect(events).toEqual([{ playerId: 'p1', reason: 'rating_exact', points: 1000 }]);
  });
});
