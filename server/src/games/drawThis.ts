import {
  DRAWING_GRID,
  MAX_POINTS_PER_STROKE,
  MAX_STROKES_PER_DRAWING,
  type DisplayView,
  type DrawStroke,
  type PlayerView,
  type PublicPlayer,
} from '@judybox/shared';
import type { GameDefinition, RoundContext, SubmissionCheck } from '../engine/types.js';
import type { ScoringEvent } from '../scoring/scoreboard.js';
import { awardChosenWinner, DEFAULT_SCORING, type ScoringConfig } from '../scoring/strategies.js';

export const DRAW_THIS_TYPE = 'draw-this';

export interface DrawRound {
  prompt: string;
}

export interface DrawThisConfig {
  id: string;
  name: string;
  rounds: DrawRound[];
  scoring?: ScoringConfig;
}

/**
 * Same shape as CaptionThisGame, but the submitted value is a small canvas
 * drawing rather than text: a bounded stroke list, wire-encoded as a JSON
 * string inside the existing `submit` value field (no protocol change).
 */
export class DrawThisGame implements GameDefinition {
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

  constructor(private readonly config: DrawThisConfig) {}

  get id(): string {
    return this.config.id;
  }

  get name(): string {
    return this.config.name;
  }

  get roundCount(): number {
    return this.config.rounds.length;
  }

  private round(index: number): DrawRound | undefined {
    return this.config.rounds[index];
  }

  private winnerPoints(): number {
    return this.config.scoring?.specialPick ?? DEFAULT_SCORING.specialPick;
  }

  expectedSubmitters(context: RoundContext): string[] {
    return context.players.filter((player) => player.role !== 'SPECIAL').map((player) => player.id);
  }

  validateSubmission(context: RoundContext, _playerId: string, value: string): SubmissionCheck {
    const round = this.round(context.roundIndex);
    if (!round) return { ok: false, code: 'wrong_phase', message: 'No round is active.' };

    const reject = { ok: false, code: 'invalid_value', message: 'That drawing did not come through.' } as const;

    let parsed: unknown;
    try {
      parsed = JSON.parse(value);
    } catch {
      return reject;
    }
    if (!Array.isArray(parsed) || parsed.length === 0) {
      return { ok: false, code: 'invalid_value', message: 'Draw something first.' };
    }
    if (parsed.length > MAX_STROKES_PER_DRAWING) {
      return {
        ok: false,
        code: 'invalid_value',
        message: `Keep it to ${MAX_STROKES_PER_DRAWING} strokes or fewer.`,
      };
    }

    const strokes: DrawStroke[] = [];
    for (const candidate of parsed) {
      if (typeof candidate !== 'object' || candidate === null) return reject;
      const stroke = candidate as Record<string, unknown>;
      const { points, size, erase } = stroke;

      if (size !== 'thin' && size !== 'thick') return reject;
      if (erase !== undefined && typeof erase !== 'boolean') return reject;
      if (
        !Array.isArray(points) ||
        points.length === 0 ||
        points.length % 2 !== 0 ||
        points.length / 2 > MAX_POINTS_PER_STROKE
      ) {
        return reject;
      }
      if (
        !points.every(
          (coordinate) =>
            typeof coordinate === 'number' &&
            Number.isInteger(coordinate) &&
            coordinate >= 0 &&
            coordinate <= DRAWING_GRID,
        )
      ) {
        return reject;
      }

      strokes.push({ points: points as number[], size, ...(erase ? { erase: true } : {}) });
    }

    return { ok: true, value: JSON.stringify(strokes) };
  }

  private strokesOf(value: string): DrawStroke[] {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? (parsed as DrawStroke[]) : [];
    } catch {
      return [];
    }
  }

  /** Entries in a fixed order that carries no information about submission time. */
  private entries(context: RoundContext): { id: string; strokes: DrawStroke[] }[] {
    return [...context.submissions.values()]
      .map((submission) => ({ id: submission.playerId, strokes: this.strokesOf(submission.value) }))
      .sort((a, b) => a.id.localeCompare(b.id));
  }

  private winnerName(context: RoundContext): string | null {
    if (!context.specialPick) return null;
    return context.players.find((player) => player.id === context.specialPick)?.name ?? null;
  }

  displayView(context: RoundContext): DisplayView {
    const round = this.round(context.roundIndex);
    if (!round) return { kind: 'game_complete', gameName: this.name };

    switch (context.phase) {
      case 'GAME_INTRO':
        return { kind: 'game_intro', gameName: this.name, roundCount: this.roundCount };

      case 'ROUND_INTRO':
        return {
          kind: 'round_intro',
          roundNumber: context.roundIndex + 1,
          roundCount: this.roundCount,
          prompt: round.prompt,
        };

      case 'PLAYER_INPUT':
      case 'SUBMISSIONS_LOCKED':
        return {
          kind: 'question',
          prompt: round.prompt,
          options: [],
          answered: context.submissions.size,
          expected: this.expectedSubmitters(context).length,
          locked: context.phase === 'SUBMISSIONS_LOCKED',
        };

      case 'REVEAL':
        return {
          kind: 'drawing_gallery',
          prompt: round.prompt,
          revealed: false,
          entries: this.entries(context),
          judyDeciding: context.specialPick === null,
        };

      case 'RESULTS': {
        const winnerId = context.specialPick;
        return {
          kind: 'drawing_gallery',
          prompt: round.prompt,
          revealed: true,
          entries: this.entries(context).map((entry) => ({
            ...entry,
            playerName: context.players.find((player) => player.id === entry.id)?.name ?? '?',
            isWinner: entry.id === winnerId,
          })),
          judyDeciding: false,
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

    if (isSpecial) {
      switch (context.phase) {
        case 'SUBMISSIONS_LOCKED':
          return { kind: 'waiting', message: 'Drawings are in. Get ready to judge.' };
        case 'REVEAL':
          return {
            kind: 'judge',
            prompt: round.prompt,
            entries: this.entries(context),
            pickedId: context.specialPick,
          };
        case 'RESULTS':
        case 'PLAYER_INPUT':
          return {
            kind: 'round_result',
            correct: null,
            message:
              context.phase === 'RESULTS'
                ? `You picked ${this.winnerName(context) ?? 'no one'}. Look at the TV.`
                : 'Waiting for drawings.',
          };
        default:
          return { kind: 'waiting', message: 'Waiting for the host.' };
      }
    }

    switch (context.phase) {
      case 'PLAYER_INPUT':
        return {
          kind: 'draw',
          prompt: round.prompt,
          maxStrokes: MAX_STROKES_PER_DRAWING,
          maxPointsPerStroke: MAX_POINTS_PER_STROKE,
          submitted: submission !== undefined,
        };

      case 'SUBMISSIONS_LOCKED':
        return { kind: 'waiting', message: 'Drawings are locked. Look at the TV.' };

      case 'REVEAL':
        return { kind: 'waiting', message: `${context.specialPlayerName} is choosing a winner.` };

      case 'RESULTS': {
        if (!submission) {
          return { kind: 'round_result', correct: false, message: 'You did not submit a drawing.' };
        }
        const won = context.specialPick === player.id;
        return {
          kind: 'round_result',
          correct: won,
          message: won ? `${context.specialPlayerName} picked yours!` : 'Not this time.',
        };
      }

      default:
        return { kind: 'waiting', message: 'Waiting for the host.' };
    }
  }

  scoreRound(context: RoundContext): ScoringEvent[] {
    return awardChosenWinner(context.specialPick, this.winnerPoints());
  }
}
