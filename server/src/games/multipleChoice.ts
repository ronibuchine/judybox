import type { DisplayView, PlayerView, PublicPlayer, ViewOption } from '@judybox/shared';
import type { GameDefinition, RoundContext, SubmissionCheck } from '../engine/types.js';
import type { ScoringEvent } from '../scoring/scoreboard.js';
import { awardCorrectAnswer, DEFAULT_SCORING, type ScoringConfig } from '../scoring/strategies.js';

export interface MultipleChoiceRound {
  prompt: string;
  options: ViewOption[];
  /** Null for opinion questions with no right answer. */
  correctOptionId: string | null;
}

export interface MultipleChoiceConfig {
  id: string;
  name: string;
  rounds: MultipleChoiceRound[];
  /** Omitted in tests and simple packs; DEFAULT_SCORING applies. */
  scoring?: ScoringConfig;
}

export const MULTIPLE_CHOICE_TYPE = 'multiple-choice';

/**
 * Generic single-answer question round. Content lives entirely in JSON, so
 * adding questions never requires touching this file.
 */
export class MultipleChoiceGame implements GameDefinition {
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

  constructor(private readonly config: MultipleChoiceConfig) {}

  get id(): string {
    return this.config.id;
  }

  get name(): string {
    return this.config.name;
  }

  get roundCount(): number {
    return this.config.rounds.length;
  }

  private round(index: number): MultipleChoiceRound | undefined {
    return this.config.rounds[index];
  }

  expectedSubmitters(context: RoundContext): string[] {
    return context.players.map((player) => player.id);
  }

  validateSubmission(context: RoundContext, playerId: string, value: string): SubmissionCheck {
    const round = this.round(context.roundIndex);
    if (!round) {
      return { ok: false, code: 'wrong_phase', message: 'No round is active.' };
    }
    if (!round.options.some((option) => option.id === value)) {
      return { ok: false, code: 'invalid_value', message: 'That is not one of the options.' };
    }
    return { ok: true, value };
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
          options: round.options,
          answered: context.submissions.size,
          expected: this.expectedSubmitters(context).length,
          locked: context.phase === 'SUBMISSIONS_LOCKED',
        };
      case 'REVEAL':
        return {
          kind: 'reveal',
          prompt: round.prompt,
          options: round.options,
          correctOptionId: round.correctOptionId,
          tallies: this.tallies(context, round),
        };
      case 'RESULTS':
        return {
          kind: 'results',
          prompt: round.prompt,
          rows: context.players.map((player) => {
            const submission = context.submissions.get(player.id);
            const option = round.options.find((candidate) => candidate.id === submission?.value);
            return {
              playerName: player.name,
              choiceLabel: option?.label ?? null,
              correct:
                round.correctOptionId === null || submission === undefined
                  ? null
                  : submission.value === round.correctOptionId,
            };
          }),
        };
      case 'GAME_COMPLETE':
        return { kind: 'game_complete', gameName: this.name };
      default:
        return { kind: 'game_intro', gameName: this.name, roundCount: this.roundCount };
    }
  }

  playerView(context: RoundContext, player: PublicPlayer): PlayerView {
    const round = this.round(context.roundIndex);
    if (!round) return { kind: 'idle', message: 'Waiting for the host.' };

    const submission = context.submissions.get(player.id);

    switch (context.phase) {
      case 'PLAYER_INPUT':
        return {
          kind: 'choose',
          prompt: round.prompt,
          options: round.options,
          selectedOptionId: submission?.value ?? null,
          locked: false,
        };
      case 'SUBMISSIONS_LOCKED':
        return { kind: 'waiting', message: 'Answers are locked. Look at the TV.' };
      case 'REVEAL':
      case 'RESULTS': {
        if (round.correctOptionId === null) {
          return { kind: 'round_result', correct: null, message: 'Look at the TV.' };
        }
        if (!submission) {
          return { kind: 'round_result', correct: false, message: 'You did not answer.' };
        }
        const correct = submission.value === round.correctOptionId;
        return {
          kind: 'round_result',
          correct,
          message: correct ? 'Correct.' : 'Not this time.',
        };
      }
      default:
        return { kind: 'waiting', message: 'Waiting for the host.' };
    }
  }

  scoreRound(context: RoundContext): ScoringEvent[] {
    const round = this.round(context.roundIndex);
    if (!round) return [];
    const points = this.config.scoring?.correctAnswer ?? DEFAULT_SCORING.correctAnswer;
    return awardCorrectAnswer(context.submissions, round.correctOptionId, points);
  }

  private tallies(context: RoundContext, round: MultipleChoiceRound): Record<string, number> {
    const tallies: Record<string, number> = {};
    for (const option of round.options) tallies[option.id] = 0;
    for (const submission of context.submissions.values()) {
      if (submission.value in tallies) {
        tallies[submission.value] = (tallies[submission.value] ?? 0) + 1;
      }
    }
    return tallies;
  }
}
