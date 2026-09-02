import {
  MAX_SPECIAL_NOTE_LENGTH,
  type DisplayView,
  type PlayerView,
  type PublicPlayer,
  type SpecialNoteInput,
  type ViewOption,
} from '@judybox/shared';
import type { GameDefinition, RoundContext, SubmissionCheck } from '../engine/types.js';
import type { ScoringEvent } from '../scoring/scoreboard.js';
import { awardPredictedSpecial, DEFAULT_SCORING, type ScoringConfig } from '../scoring/strategies.js';

/** Phases in which she may still write or change her comment. */
const NOTE_EDITABLE: readonly string[] = ['PLAYER_INPUT', 'SUBMISSIONS_LOCKED', 'REVEAL'];

/** Rooms and objects, with a scripted fallback answer in the pack. */
export const WOULD_APPROVE_TYPE = 'would-approve';

/** Scenarios with no scripted answer: hers is entered live or not at all. */
export const WHAT_WOULD_JUDY_DO_TYPE = 'what-would-judy-do';

export interface PredictSpecialRound {
  prompt: string;
  /** Served path such as `/assets/placeholder/room-01.svg`; null when absent. */
  imageUrl: string | null;
  options: ViewOption[];
  /** Option id from the pack's zero-based `judyAnswer`; null when unscripted. */
  configuredAnswerId: string | null;
  comment: string | null;
}

export interface PredictSpecialConfig {
  id: string;
  name: string;
  rounds: PredictSpecialRound[];
  scoring?: ScoringConfig;
}

/**
 * Predict-the-special-player mechanic, shared by "Would Judy Approve?" and
 * "What Would Judy Do?".
 *
 * Everyone answers, including the special player, whose choice stays private
 * until REVEAL. Her live answer is always the truth; a pack's configured answer
 * is only a fallback for when she has not answered (phone asleep, joined late).
 * Packs that omit `judyAnswer` have no fallback, so an unanswered round simply
 * scores nothing and the host can restart it.
 */
export class PredictSpecialGame implements GameDefinition {
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

  constructor(private readonly config: PredictSpecialConfig) {}

  get id(): string {
    return this.config.id;
  }

  get name(): string {
    return this.config.name;
  }

  get roundCount(): number {
    return this.config.rounds.length;
  }

  private round(index: number): PredictSpecialRound | undefined {
    return this.config.rounds[index];
  }

  private points(): number {
    return this.config.scoring?.predictSpecial ?? DEFAULT_SCORING.predictSpecial;
  }

  private specialPlayer(context: RoundContext): PublicPlayer | undefined {
    return context.players.find((player) => player.role === 'SPECIAL');
  }

  /** Her live answer if she gave one, otherwise the configured fallback. */
  private resolvedAnswerId(context: RoundContext, round: PredictSpecialRound): string | null {
    const special = this.specialPlayer(context);
    const submitted = special ? context.submissions.get(special.id) : undefined;
    return submitted?.value ?? round.configuredAnswerId;
  }

  /** Anything she typed this round wins over the pack's scripted comment. */
  private resolvedComment(context: RoundContext, round: PredictSpecialRound): string | null {
    return context.specialNote ?? round.comment;
  }

  /** The comment box shown on her phone, with copy explaining what it does. */
  private noteInput(context: RoundContext): SpecialNoteInput {
    const editable = NOTE_EDITABLE.includes(context.phase);
    return {
      value: context.specialNote ?? '',
      label: 'Your comment for the TV',
      hint: editable
        ? 'Optional. Everyone sees this on the TV when the host reveals your answer.'
        : 'This was shown on the TV with your answer.',
      placeholder: 'Say what you actually think\u2026',
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
    if (!round.options.some((option) => option.id === value)) {
      return { ok: false, code: 'invalid_value', message: 'That is not one of the options.' };
    }
    return { ok: true, value };
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
        };

      case 'PLAYER_INPUT':
      case 'SUBMISSIONS_LOCKED': {
        const special = this.specialPlayer(context);
        return {
          kind: 'question',
          prompt: round.prompt,
          imageUrl: round.imageUrl,
          options: round.options,
          answered: context.submissions.size,
          expected: this.expectedSubmitters(context).length,
          locked: context.phase === 'SUBMISSIONS_LOCKED',
          // Shows only whether she has answered, never which option.
          specialStatus: special
            ? { name: special.name, answered: context.submissions.has(special.id) }
            : null,
        };
      }

      case 'REVEAL':
        return {
          kind: 'reveal',
          prompt: round.prompt,
          imageUrl: round.imageUrl,
          options: round.options,
          correctOptionId: this.resolvedAnswerId(context, round),
          revealLabel: `${specialName}'s answer`,
          note: this.resolvedComment(context, round),
          tallies: this.tallies(context, round),
        };

      case 'RESULTS': {
        const answerId = this.resolvedAnswerId(context, round);
        const special = this.specialPlayer(context);
        return {
          kind: 'results',
          prompt: round.prompt,
          rows: context.players
            .filter((player) => player.id !== special?.id)
            .map((player) => {
              const submission = context.submissions.get(player.id);
              const option = round.options.find((candidate) => candidate.id === submission?.value);
              return {
                playerName: player.name,
                choiceLabel: option?.label ?? null,
                correct:
                  answerId === null || submission === undefined
                    ? null
                    : submission.value === answerId,
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
          kind: 'choose',
          headline: isSpecial ? 'What is YOUR answer?' : `Which answer will ${specialName} choose?`,
          prompt: round.prompt,
          imageUrl: round.imageUrl,
          options: round.options,
          selectedOptionId: submission?.value ?? null,
          locked: false,
          special: isSpecial,
          note: isSpecial ? this.noteInput(context) : null,
        };

      case 'SUBMISSIONS_LOCKED':
        return {
          kind: 'waiting',
          message: isSpecial
            ? 'Your answer is in. Look at the TV.'
            : 'Answers locked. Look at the TV.',
          note: isSpecial ? this.noteInput(context) : null,
        };

      case 'REVEAL':
      case 'RESULTS': {
        const answerId = this.resolvedAnswerId(context, round);
        if (isSpecial) {
          return {
            kind: 'round_result',
            correct: null,
            message: 'Your answer is on the TV.',
            note: this.noteInput(context),
          };
        }
        if (answerId === null) {
          return {
            kind: 'round_result',
            correct: null,
            message: `${specialName} did not answer this one.`,
          };
        }
        if (!submission) {
          return { kind: 'round_result', correct: false, message: 'You did not answer.' };
        }
        const correct = submission.value === answerId;
        return {
          kind: 'round_result',
          correct,
          message: correct ? `You read ${specialName} perfectly.` : `Not what ${specialName} picked.`,
        };
      }

      default:
        return { kind: 'waiting', message: 'Waiting for the host.' };
    }
  }

  scoreRound(context: RoundContext): ScoringEvent[] {
    const round = this.round(context.roundIndex);
    if (!round) return [];

    const special = this.specialPlayer(context);
    if (special && context.submissions.has(special.id)) {
      return awardPredictedSpecial(context.submissions, special.id, this.points());
    }
    if (round.configuredAnswerId === null) return [];

    // She never answered, so fall back to the configured answer.
    const events: ScoringEvent[] = [];
    for (const submission of context.submissions.values()) {
      if (submission.playerId === special?.id) continue;
      if (submission.value === round.configuredAnswerId) {
        events.push({
          playerId: submission.playerId,
          reason: 'predicted_special',
          points: this.points(),
        });
      }
    }
    return events;
  }

  private tallies(context: RoundContext, round: PredictSpecialRound): Record<string, number> {
    const special = this.specialPlayer(context);
    const tallies: Record<string, number> = {};
    for (const option of round.options) tallies[option.id] = 0;

    for (const submission of context.submissions.values()) {
      // Her own answer is shown separately, not counted in the crowd tally.
      if (submission.playerId === special?.id) continue;
      if (submission.value in tallies) {
        tallies[submission.value] = (tallies[submission.value] ?? 0) + 1;
      }
    }
    return tallies;
  }
}
