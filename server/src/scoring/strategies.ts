import type { Submission } from '../engine/types.js';
import type { ScoringEvent } from './scoreboard.js';

/** One tolerance band for a numeric guess. `within` is an inclusive distance. */
export interface DistanceBand {
  within: number;
  points: number;
}

/** Bands are tried nearest-first; anything outside them all gets `otherwise`. */
export interface DistanceScoring {
  bands: DistanceBand[];
  otherwise: number;
}

/** Point values, supplied per game from party JSON. */
export interface ScoringConfig {
  correctAnswer: number;
  /** Points by finishing place for numeric-guess rounds; index 0 is closest. */
  closestPlaces: number[];
  predictSpecial: number;
  specialPick: number;
  /** Tolerance-band points for rating guesses. */
  distance: DistanceScoring;
  /** Step size for host +/- buttons. */
  manualStep: number;
}

export const DEFAULT_DISTANCE_SCORING: DistanceScoring = {
  bands: [
    { within: 0, points: 500 },
    { within: 5, points: 400 },
    { within: 10, points: 300 },
    { within: 20, points: 150 },
  ],
  otherwise: 0,
};

export const DEFAULT_SCORING: ScoringConfig = {
  correctAnswer: 100,
  closestPlaces: [100, 60, 30],
  predictSpecial: 100,
  specialPick: 150,
  distance: DEFAULT_DISTANCE_SCORING,
  manualStep: 100,
};

type Submissions = ReadonlyMap<string, Submission>;

/** Flat award to everyone whose answer matched a known-correct value. */
export function awardCorrectAnswer(
  submissions: Submissions,
  correctValue: string | null,
  points: number,
): ScoringEvent[] {
  if (correctValue === null) return [];
  const events: ScoringEvent[] = [];
  for (const submission of submissions.values()) {
    if (submission.value === correctValue) {
      events.push({ playerId: submission.playerId, reason: 'correct_answer', points });
    }
  }
  return events;
}

/**
 * Places players by absolute distance from `target`.
 * Equal distances share a place and consume it, so the next group drops a rank.
 */
export function awardClosestNumeric(
  submissions: Submissions,
  target: number,
  placePoints: readonly number[],
  excludePlayerIds: readonly string[] = [],
): ScoringEvent[] {
  const excluded = new Set(excludePlayerIds);

  const scored = [...submissions.values()]
    .filter((submission) => !excluded.has(submission.playerId))
    .map((submission) => ({ submission, guess: Number(submission.value) }))
    .filter((entry) => Number.isFinite(entry.guess))
    .map((entry) => ({ ...entry, distance: Math.abs(entry.guess - target) }))
    .sort((a, b) => a.distance - b.distance);

  const events: ScoringEvent[] = [];
  let place = 0;
  let index = 0;

  while (index < scored.length && place < placePoints.length) {
    const distance = scored[index]?.distance;
    const tied = scored.filter((entry) => entry.distance === distance);
    const points = placePoints[place] ?? 0;

    for (const entry of tied) {
      if (points !== 0) {
        events.push({
          playerId: entry.submission.playerId,
          reason: `closest_place_${place + 1}`,
          points,
        });
      }
    }
    index += tied.length;
    place += tied.length;
  }
  return events;
}

/** Awards everyone who predicted the special player's own answer. */
export function awardPredictedSpecial(
  submissions: Submissions,
  specialPlayerId: string | null,
  points: number,
): ScoringEvent[] {
  if (specialPlayerId === null) return [];
  const actual = submissions.get(specialPlayerId);
  if (!actual) return [];

  const events: ScoringEvent[] = [];
  for (const submission of submissions.values()) {
    if (submission.playerId === specialPlayerId) continue;
    if (submission.value === actual.value) {
      events.push({ playerId: submission.playerId, reason: 'predicted_special', points });
    }
  }
  return events;
}

/** Awards a single winner chosen by the special player or the host. */
export function awardChosenWinner(
  winnerPlayerId: string | null,
  points: number,
  reason = 'chosen_winner',
): ScoringEvent[] {
  if (!winnerPlayerId) return [];
  return [{ playerId: winnerPlayerId, reason, points }];
}

/** Discretionary host award; may be negative to take points away. */
export function manualAward(playerId: string, points: number): ScoringEvent[] {
  if (points === 0) return [];
  return [{ playerId, reason: 'host_award', points }];
}

/** Names the band a guess landed in, so the leaderboard delta is explainable. */
export function distanceReason(band: DistanceBand | null): string {
  if (band === null) return 'rating_otherwise';
  return band.within === 0 ? 'rating_exact' : `rating_within_${band.within}`;
}

/**
 * Awards every guess by how far it sits from `target`.
 *
 * Unlike `awardClosestNumeric` this is absolute, not competitive: twenty people
 * can all be within 5 and all get the same points, which is what a rating game
 * wants. Non-numeric or missing guesses score nothing.
 */
export function awardByDistance(
  submissions: Submissions,
  target: number,
  scoring: DistanceScoring,
  excludePlayerIds: readonly string[] = [],
): ScoringEvent[] {
  const excluded = new Set(excludePlayerIds);
  const bands = [...scoring.bands].sort((a, b) => a.within - b.within);
  const events: ScoringEvent[] = [];

  for (const submission of submissions.values()) {
    if (excluded.has(submission.playerId)) continue;

    const guess = Number(submission.value);
    if (!Number.isFinite(guess)) continue;

    const distance = Math.abs(guess - target);
    const band = bands.find((candidate) => distance <= candidate.within) ?? null;
    const points = band ? band.points : scoring.otherwise;
    if (points === 0) continue;

    events.push({ playerId: submission.playerId, reason: distanceReason(band), points });
  }
  return events;
}
