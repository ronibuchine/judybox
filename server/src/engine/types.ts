import type {
  DisplayView,
  EnginePhase,
  PlayerView,
  PublicPlayer,
  SubmissionRejectionCode,
} from '@judybox/shared';
import type { ScoringEvent } from '../scoring/scoreboard.js';

export interface Submission {
  playerId: string;
  value: string;
  submittedAt: number;
}

export type { ScoringEvent } from '../scoring/scoreboard.js';

/** Everything a game is allowed to see. Deliberately no sockets or session. */
export interface RoundContext {
  phase: EnginePhase;
  roundIndex: number;
  roundCount: number;
  players: readonly PublicPlayer[];
  submissions: ReadonlyMap<string, Submission>;
  specialPlayerName: string;
  /** Free-text remark the special player added this round, if any. */
  specialNote: string | null;
  /** Id of the player whose submission she picked as winner this round, if any. */
  specialPick: string | null;
}

export type SubmissionCheck =
  | { ok: true; value: string }
  | { ok: false; code: SubmissionRejectionCode; message: string };

/**
 * A game mechanic. Implementations are pure with respect to engine state:
 * they receive a context and return views, never touching networking,
 * the player roster, or global navigation.
 */
export interface GameDefinition {
  readonly id: string;
  readonly name: string;
  /** Phases this mechanic uses; the engine hides actions targeting others. */
  readonly phases: readonly EnginePhase[];
  readonly roundCount: number;

  /** Players expected to answer this round, by id. */
  expectedSubmitters(context: RoundContext): string[];
  validateSubmission(context: RoundContext, playerId: string, value: string): SubmissionCheck;
  displayView(context: RoundContext): DisplayView;
  playerView(context: RoundContext, player: PublicPlayer): PlayerView;
  /** Called once when a round reaches RESULTS. */
  scoreRound(context: RoundContext): ScoringEvent[];
}
