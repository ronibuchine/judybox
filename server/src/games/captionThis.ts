import {
  MAX_CAPTION_LENGTH,
  type DisplayView,
  type PlayerView,
  type PublicPlayer,
} from '@judybox/shared';
import type { GameDefinition, RoundContext, SubmissionCheck } from '../engine/types.js';
import type { ScoringEvent } from '../scoring/scoreboard.js';
import { awardChosenWinner, DEFAULT_SCORING, type ScoringConfig } from '../scoring/strategies.js';

export const CAPTION_THIS_TYPE = 'caption-this';

export interface CaptionRound {
  prompt: string;
  /** Served path such as `/assets/placeholder/judy-photo-01.svg`; null when absent. */
  imageUrl: string | null;
}

export interface CaptionThisConfig {
  id: string;
  name: string;
  rounds: CaptionRound[];
  scoring?: ScoringConfig;
}

/**
 * Everyone but the special player writes an anonymous caption; she reads them
 * without names attached and picks a winner. Her pick is entered live via
 * `GameEngine.setSpecialPick`, never in content.
 */
export class CaptionThisGame implements GameDefinition {
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

  constructor(private readonly config: CaptionThisConfig) {}

  get id(): string {
    return this.config.id;
  }

  get name(): string {
    return this.config.name;
  }

  get roundCount(): number {
    return this.config.rounds.length;
  }

  private round(index: number): CaptionRound | undefined {
    return this.config.rounds[index];
  }

  private winnerPoints(): number {
    return this.config.scoring?.specialPick ?? DEFAULT_SCORING.specialPick;
  }

  /** She judges; she does not write a caption herself. */
  expectedSubmitters(context: RoundContext): string[] {
    return context.players.filter((player) => player.role !== 'SPECIAL').map((player) => player.id);
  }

  validateSubmission(context: RoundContext, _playerId: string, value: string): SubmissionCheck {
    const round = this.round(context.roundIndex);
    if (!round) return { ok: false, code: 'wrong_phase', message: 'No round is active.' };

    const trimmed = value.trim();
    if (trimmed === '') {
      return { ok: false, code: 'invalid_value', message: 'Write something first.' };
    }
    if (trimmed.length > MAX_CAPTION_LENGTH) {
      return {
        ok: false,
        code: 'invalid_value',
        message: `Keep it under ${MAX_CAPTION_LENGTH} characters.`,
      };
    }
    return { ok: true, value: trimmed };
  }

  /** Entries in a fixed order that carries no information about submission time. */
  private entries(context: RoundContext): { id: string; text: string }[] {
    return [...context.submissions.values()]
      .map((submission) => ({ id: submission.playerId, text: submission.value }))
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
          imageUrl: round.imageUrl,
        };

      case 'PLAYER_INPUT':
      case 'SUBMISSIONS_LOCKED':
        return {
          kind: 'question',
          prompt: round.prompt,
          imageUrl: round.imageUrl,
          options: [],
          answered: context.submissions.size,
          expected: this.expectedSubmitters(context).length,
          locked: context.phase === 'SUBMISSIONS_LOCKED',
        };

      case 'REVEAL':
        return {
          kind: 'caption_gallery',
          prompt: round.prompt,
          imageUrl: round.imageUrl,
          revealed: false,
          entries: this.entries(context),
          judyDeciding: context.specialPick === null,
        };

      case 'RESULTS': {
        const winnerId = context.specialPick;
        return {
          kind: 'caption_gallery',
          prompt: round.prompt,
          imageUrl: round.imageUrl,
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
          return { kind: 'waiting', message: 'Captions are in. Get ready to judge.' };
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
                : 'Waiting for captions.',
          };
        default:
          return { kind: 'waiting', message: 'Waiting for the host.' };
      }
    }

    switch (context.phase) {
      case 'PLAYER_INPUT':
        return {
          kind: 'caption',
          prompt: round.prompt,
          imageUrl: round.imageUrl,
          maxLength: MAX_CAPTION_LENGTH,
          submittedText: submission?.value ?? null,
        };

      case 'SUBMISSIONS_LOCKED':
        return { kind: 'waiting', message: 'Captions are locked. Look at the TV.' };

      case 'REVEAL':
        return { kind: 'waiting', message: `${context.specialPlayerName} is choosing a winner.` };

      case 'RESULTS': {
        if (!submission) {
          return { kind: 'round_result', correct: false, message: 'You did not submit a caption.' };
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
