import {
  MAX_SPECIAL_NOTE_LENGTH,
  RATING_MAX,
  RATING_MIN,
  type DisplayView,
  type PlayerView,
  type PublicPlayer,
  type SpecialNoteInput,
} from '@judybox/shared';
import type { GameDefinition, RoundContext, SubmissionCheck } from '../engine/types.js';
import type { ScoringEvent } from '../scoring/scoreboard.js';
import { awardByDistance, DEFAULT_SCORING, type ScoringConfig } from '../scoring/strategies.js';

/** Phases in which she may still write or change her comment. */
const NOTE_EDITABLE: readonly string[] = ['PLAYER_INPUT', 'SUBMISSIONS_LOCKED', 'REVEAL'];

export const ROTTEN_TOMATOES_TYPE = 'rotten-tomatoes';

/** Whole percentage points; a slider is fiddly enough without decimals. */
const RATING_STEP = 1;

export interface RatingRound {
  prompt: string;
  /** Served path such as `/assets/placeholder/room-01.svg`; null when absent. */
  imageUrl: string | null;
  /** Optional aside from the pack, e.g. a year or a source. */
  meta: string | null;
}

export interface RottenTomatoesConfig {
  id: string;
  name: string;
  rounds: RatingRound[];
  scoring?: ScoringConfig;
}

/**
 * Rate-the-thing mechanic: players guess the score the special player will
 * give, she enters her real score privately, and points fall off with distance.
 *
 * Her score is never in the pack. If she does not enter one the round simply
 * scores nothing, which the host can fix with RESTART_ROUND.
 */
export class RottenTomatoesGame implements GameDefinition {
  readonly phases = [
    'GAME_INTRO',
    'ROUND_INTRO',
    'PLAYER_INPUT',
    'SUBMISSIONS_LOCKED',
    'REVEAL',
    'RESULTS',
    'LEADERBOARD',
    'GAME_COMPLETE',
  ] as const;

  constructor(private readonly config: RottenTomatoesConfig) {}

  get id(): string {
    return this.config.id;
  }

  get name(): string {
    return this.config.name;
  }

  get roundCount(): number {
    return this.config.rounds.length;
  }

  private round(index: number): RatingRound | undefined {
    return this.config.rounds[index];
  }

  private distanceScoring() {
    return this.config.scoring?.distance ?? DEFAULT_SCORING.distance;
  }

  private specialPlayer(context: RoundContext): PublicPlayer | undefined {
    return context.players.find((player) => player.role === 'SPECIAL');
  }

  /** Her live score, or null while she has not entered one. */
  private actualScore(context: RoundContext): number | null {
    const special = this.specialPlayer(context);
    const submitted = special ? context.submissions.get(special.id) : undefined;
    if (!submitted) return null;
    const score = Number(submitted.value);
    return Number.isFinite(score) ? score : null;
  }

  private noteInput(context: RoundContext): SpecialNoteInput {
    const editable = NOTE_EDITABLE.includes(context.phase);
    return {
      value: context.specialNote ?? '',
      label: 'Your comment for the TV',
      hint: editable
        ? 'Optional. Everyone sees this on the TV when the host reveals your score.'
        : 'This was shown on the TV with your score.',
      placeholder: 'Justify the score\u2026',
      editable,
      maxLength: MAX_SPECIAL_NOTE_LENGTH,
    };
  }

  expectedSubmitters(context: RoundContext): string[] {
    return context.players.map((player) => player.id);
  }

  validateSubmission(context: RoundContext, _playerId: string, value: string): SubmissionCheck {
    const round = this.round(context.roundIndex);
    if (!round) return { ok: false, code: 'wrong_phase', message: 'No round is active.' };

    const reject = {
      ok: false,
      code: 'invalid_value',
      message: `Pick a whole number from ${RATING_MIN} to ${RATING_MAX}.`,
    } as const;

    // Number('') and Number(' ') are 0, so reject blanks before converting.
    if (!/^-?\d+$/.test(value.trim())) return reject;

    const score = Number(value.trim());
    if (score < RATING_MIN || score > RATING_MAX) return reject;

    return { ok: true, value: String(score) };
  }

  displayView(context: RoundContext): DisplayView {
    const round = this.round(context.roundIndex);
    if (!round) return { kind: 'game_complete', gameName: this.name };

    const specialName = context.specialPlayerName;

    switch (context.phase) {
      case 'GAME_INTRO':
        return { kind: 'game_intro', gameName: this.name, roundCount: this.roundCount };

      case 'ROUND_INTRO':
        return {
          kind: 'round_intro',
          roundNumber: context.roundIndex + 1,
          roundCount: this.roundCount,
          prompt: round.prompt,
          imageUrl: round.imageUrl,
          meta: round.meta,
        };

      case 'PLAYER_INPUT':
      case 'SUBMISSIONS_LOCKED': {
        const special = this.specialPlayer(context);
        return {
          kind: 'question',
          prompt: round.prompt,
          imageUrl: round.imageUrl,
          // Scores are entered on a slider, so there is nothing to list.
          options: [],
          scale: {
            min: RATING_MIN,
            max: RATING_MAX,
            label: `Everyone scores it ${RATING_MIN}\u2013${RATING_MAX}`,
          },
          answered: context.submissions.size,
          expected: this.expectedSubmitters(context).length,
          locked: context.phase === 'SUBMISSIONS_LOCKED',
          specialStatus: special
            ? { name: special.name, answered: context.submissions.has(special.id) }
            : null,
        };
      }

      case 'REVEAL':
        return {
          kind: 'rating_reveal',
          prompt: round.prompt,
          imageUrl: round.imageUrl,
          meta: round.meta,
          revealLabel: `${specialName}'s score`,
          actualScore: this.actualScore(context),
          min: RATING_MIN,
          max: RATING_MAX,
          guesses: this.guesses(context),
          note: context.specialNote,
        };

      case 'RESULTS': {
        const actual = this.actualScore(context);
        const special = this.specialPlayer(context);
        return {
          kind: 'results',
          prompt: round.prompt,
          rows: context.players
            .filter((player) => player.id !== special?.id)
            .map((player) => {
              const submission = context.submissions.get(player.id);
              if (!submission) {
                return { playerName: player.name, choiceLabel: null, correct: null };
              }
              const score = Number(submission.value);
              const distance = actual === null ? null : Math.abs(score - actual);
              return {
                playerName: player.name,
                choiceLabel: distance === null ? `${score}` : `${score} (off by ${distance})`,
                correct: distance === null ? null : distance === 0,
              };
            }),
        };
      }

      case 'GAME_COMPLETE':
        return { kind: 'game_complete', gameName: this.name };

      default:
        return { kind: 'game_intro', gameName: this.name, roundCount: this.roundCount };
    }
  }

  playerView(context: RoundContext, player: PublicPlayer): PlayerView {
    const round = this.round(context.roundIndex);
    if (!round) return { kind: 'idle', message: 'Waiting for the host.' };

    const isSpecial = player.role === 'SPECIAL';
    const submission = context.submissions.get(player.id);
    const specialName = context.specialPlayerName;

    switch (context.phase) {
      case 'PLAYER_INPUT':
        return {
          kind: 'rate',
          headline: isSpecial ? 'How do YOU rate this?' : `How would ${specialName} rate this?`,
          prompt: round.prompt,
          imageUrl: round.imageUrl,
          min: RATING_MIN,
          max: RATING_MAX,
          step: RATING_STEP,
          defaultValue: Math.round((RATING_MIN + RATING_MAX) / 2),
          submittedValue: submission ? Number(submission.value) : null,
          locked: false,
          special: isSpecial,
          note: isSpecial ? this.noteInput(context) : null,
        };

      case 'SUBMISSIONS_LOCKED':
        return {
          kind: 'waiting',
          message: isSpecial ? 'Your score is in. Look at the TV.' : 'Scores locked. Look at the TV.',
          note: isSpecial ? this.noteInput(context) : null,
        };

      case 'REVEAL':
      case 'RESULTS': {
        if (isSpecial) {
          return {
            kind: 'round_result',
            correct: null,
            message: 'Your score is on the TV.',
            note: this.noteInput(context),
          };
        }
        const actual = this.actualScore(context);
        if (actual === null) {
          return {
            kind: 'round_result',
            correct: null,
            message: `${specialName} did not score this one.`,
          };
        }
        if (!submission) {
          return { kind: 'round_result', correct: false, message: 'You did not score this one.' };
        }
        const distance = Math.abs(Number(submission.value) - actual);
        return {
          kind: 'round_result',
          correct: distance === 0,
          message:
            distance === 0
              ? `Exactly ${actual}. You know her.`
              : `She said ${actual}. You were off by ${distance}.`,
        };
      }

      default:
        return { kind: 'waiting', message: 'Waiting for the host.' };
    }
  }

  scoreRound(context: RoundContext): ScoringEvent[] {
    const actual = this.actualScore(context);
    if (actual === null) return [];

    const special = this.specialPlayer(context);
    return awardByDistance(
      context.submissions,
      actual,
      this.distanceScoring(),
      special ? [special.id] : [],
    );
  }

  /** Every normal player's guess, nearest first. */
  private guesses(
    context: RoundContext,
  ): { playerName: string; score: number; distance: number | null }[] {
    const actual = this.actualScore(context);
    const special = this.specialPlayer(context);

    return context.players
      .filter((player) => player.id !== special?.id)
      .flatMap((player) => {
        const submission = context.submissions.get(player.id);
        if (!submission) return [];
        const score = Number(submission.value);
        if (!Number.isFinite(score)) return [];
        return [
          {
            playerName: player.name,
            score,
            distance: actual === null ? null : Math.abs(score - actual),
          },
        ];
      })
      .sort((a, b) => (a.distance ?? 0) - (b.distance ?? 0));
  }
}
