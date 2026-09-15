import type {
  AvailableAction,
  DisplayView,
  EnginePhase,
  EngineSnapshot,
  HostAction,
  LeaderboardRow,
  PlayerStanding,
  PlayerView,
  PublicPlayer,
  SubmissionRejectionCode,
  ViewOption,
} from '@judybox/shared';
import { MAX_SPECIAL_NOTE_LENGTH } from '@judybox/shared';
import { Scoreboard } from '../scoring/scoreboard.js';
import { manualAward } from '../scoring/strategies.js';
import { findRule, TRANSITION_RULES } from './transitions.js';
import type { GameDefinition, RoundContext, Submission } from './types.js';

/** Phases in which the special player may still write or edit her note. */
const NOTE_EDITABLE_PHASES: readonly EnginePhase[] = [
  'PLAYER_INPUT',
  'SUBMISSIONS_LOCKED',
  'REVEAL',
];

/** Phases in which she may pick a winner: only once there is something to judge. */
const PICK_EDITABLE_PHASES: readonly EnginePhase[] = ['SUBMISSIONS_LOCKED', 'REVEAL'];

export type ActionResult = { ok: true; phase: EnginePhase } | { ok: false; message: string };

export type SubmitResult =
  | { ok: true }
  | { ok: false; code: SubmissionRejectionCode; message: string };

export interface EngineOptions {
  games: readonly GameDefinition[];
  specialPlayerName: string;
}

/**
 * Authoritative session state machine.
 *
 * All progression is host-driven and validated here; nothing advances on a
 * timer and no client can move the phase by asserting it.
 */
export class GameEngine {
  private phase: EnginePhase = 'LOBBY';
  private game: GameDefinition | null = null;
  private roundIndex = 0;
  private submissions = new Map<string, Submission>();
  /** Cleared with the round, like submissions. */
  private specialNote: string | null = null;
  /** Cleared with the round, like submissions. */
  private specialPick: string | null = null;
  /** Session-wide scores, shared by every game. */
  private readonly scoreboard = new Scoreboard();
  private manualAwardSequence = 0;

  constructor(private readonly options: EngineOptions) {}

  currentPhase(): EnginePhase {
    return this.phase;
  }

  currentGame(): GameDefinition | null {
    return this.game;
  }

  currentRoundIndex(): number {
    return this.roundIndex;
  }

  submissionCount(): number {
    return this.submissions.size;
  }

  currentSpecialNote(): string | null {
    return this.specialNote;
  }

  currentSpecialPick(): string | null {
    return this.specialPick;
  }

  /** Records the special player's own remark for this round. */
  setSpecialNote(player: PublicPlayer, text: string): SubmitResult {
    if (player.role !== 'SPECIAL') {
      return { ok: false, code: 'not_playing', message: 'Only the special player can comment.' };
    }
    if (!this.game) {
      return { ok: false, code: 'wrong_phase', message: 'No game is running.' };
    }
    if (!NOTE_EDITABLE_PHASES.includes(this.phase)) {
      return { ok: false, code: 'wrong_phase', message: 'You cannot comment right now.' };
    }
    if (text.length > MAX_SPECIAL_NOTE_LENGTH) {
      return {
        ok: false,
        code: 'invalid_value',
        message: `Keep it under ${MAX_SPECIAL_NOTE_LENGTH} characters.`,
      };
    }

    const trimmed = text.trim();
    this.specialNote = trimmed === '' ? null : trimmed;
    return { ok: true };
  }

  /** True while the special player may still edit her note. */
  noteEditable(): boolean {
    return this.game !== null && NOTE_EDITABLE_PHASES.includes(this.phase);
  }

  /** Records the special player's choice of winner from this round's submissions. */
  setSpecialPick(player: PublicPlayer, targetPlayerId: string): SubmitResult {
    if (player.role !== 'SPECIAL') {
      return { ok: false, code: 'not_playing', message: 'Only the special player can pick a winner.' };
    }
    if (!this.game) {
      return { ok: false, code: 'wrong_phase', message: 'No game is running.' };
    }
    if (!PICK_EDITABLE_PHASES.includes(this.phase)) {
      return { ok: false, code: 'wrong_phase', message: 'You cannot pick a winner right now.' };
    }
    if (targetPlayerId === '') {
      this.specialPick = null;
      return { ok: true };
    }
    // She can only pick among people who actually submitted this round.
    if (!this.submissions.has(targetPlayerId)) {
      return { ok: false, code: 'invalid_value', message: 'That is not a submission from this round.' };
    }
    this.specialPick = targetPlayerId;
    return { ok: true };
  }

  /** True while the special player may still change her pick. */
  pickEditable(): boolean {
    return this.game !== null && PICK_EDITABLE_PHASES.includes(this.phase);
  }

  scoreFor(playerId: string): number {
    return this.scoreboard.scoreFor(playerId);
  }

  standings(players: readonly PublicPlayer[]): LeaderboardRow[] {
    return this.scoreboard.standings(players);
  }

  standingFor(playerId: string, players: readonly PublicPlayer[]): PlayerStanding | null {
    return this.scoreboard.standingFor(playerId, players);
  }

  /** Discretionary host points. Negative values take points away. */
  awardManually(playerId: string, points: number): boolean {
    const events = manualAward(playerId, points);
    if (events.length === 0) return false;
    this.manualAwardSequence += 1;
    return this.scoreboard.apply(`manual:${this.manualAwardSequence}`, events);
  }

  /** Actions the host may take right now. The UI renders exactly this list. */
  availableActions(): AvailableAction[] {
    const context = {
      phase: this.phase,
      roundIndex: this.roundIndex,
      roundCount: this.roundCount(),
    };

    return TRANSITION_RULES.filter((rule) => {
      if (!rule.from.includes(this.phase)) return false;
      if (rule.action === 'START_GAME' && this.options.games.length === 0) return false;
      const target = rule.target(context);
      // Hide actions leading into a phase this game does not use.
      if (this.game && !this.game.phases.includes(target) && target !== 'GAME_SELECT') {
        if (target !== 'LOBBY' && target !== 'GAME_COMPLETE' && target !== 'PARTY_COMPLETE') {
          return false;
        }
      }
      return true;
    }).map((rule) => ({
      action: rule.action,
      label: rule.label,
      ...(rule.danger ? { danger: true } : {}),
    }));
  }

  applyHostAction(action: HostAction, players: readonly PublicPlayer[], gameId?: string): ActionResult {
    const rule = findRule(action);
    if (!rule) return { ok: false, message: `Unknown action ${action}.` };

    const allowed = this.availableActions().some((available) => available.action === action);
    if (!allowed) {
      return { ok: false, message: `${action} is not allowed while in ${this.phase}.` };
    }

    if (action === 'START_GAME') {
      const chosen = gameId
        ? this.options.games.find((candidate) => candidate.id === gameId)
        : this.options.games[0];
      if (!chosen) return { ok: false, message: `No such game: ${gameId ?? '(none)'}.` };
      this.game = chosen;
      this.roundIndex = 0;
      this.clearRound();
    }

    const target = rule.target({
      phase: this.phase,
      roundIndex: this.roundIndex,
      roundCount: this.roundCount(),
    });

    switch (action) {
      case 'NEXT_ROUND':
      case 'SKIP_ROUND':
        if (target === 'ROUND_INTRO') this.roundIndex += 1;
        this.clearRound();
        break;
      case 'RESTART_ROUND':
        // Undo this round's points so replaying it cannot double-count.
        this.scoreboard.revert(this.roundKey());
        this.clearRound();
        break;
      case 'RESTART_GAME':
        this.scoreboard.revertMatching(`${this.game?.id ?? ''}:`);
        this.roundIndex = 0;
        this.clearRound();
        break;
      case 'RETURN_TO_LOBBY':
      case 'RETURN_TO_GAME_SELECT':
        this.game = action === 'RETURN_TO_LOBBY' ? null : this.game;
        this.roundIndex = 0;
        this.clearRound();
        break;
      case 'END_PARTY':
        this.clearRound();
        break;
      default:
        break;
    }

    this.phase = target;

    // Scoring is applied once per round, on first arrival at RESULTS.
    if (target === 'RESULTS') this.applyScoring(players);

    return { ok: true, phase: this.phase };
  }

  submit(player: PublicPlayer, value: string, players: readonly PublicPlayer[]): SubmitResult {
    if (!this.game) {
      return { ok: false, code: 'wrong_phase', message: 'No game is running.' };
    }
    if (this.phase !== 'PLAYER_INPUT') {
      return {
        ok: false,
        code: 'wrong_phase',
        message:
          this.phase === 'SUBMISSIONS_LOCKED'
            ? 'Answers are locked.'
            : 'You cannot answer right now.',
      };
    }

    const context = this.roundContext(players);
    if (!this.game.expectedSubmitters(context).includes(player.id)) {
      return { ok: false, code: 'not_playing', message: 'You are not answering this round.' };
    }
    if (this.submissions.has(player.id)) {
      return { ok: false, code: 'already_submitted', message: 'You already answered.' };
    }

    const checked = this.game.validateSubmission(context, player.id, value);
    if (!checked.ok) return { ok: false, code: checked.code, message: checked.message };

    this.submissions.set(player.id, {
      playerId: player.id,
      value: checked.value,
      submittedAt: Date.now(),
    });
    return { ok: true };
  }

  snapshot(players: readonly PublicPlayer[]): EngineSnapshot {
    const context = this.roundContext(players);
    return {
      phase: this.phase,
      gameId: this.game?.id ?? null,
      gameName: this.game?.name ?? null,
      roundNumber: this.game ? this.roundIndex + 1 : 0,
      roundCount: this.roundCount(),
      submittedCount: this.submissions.size,
      expectedCount: this.game ? this.game.expectedSubmitters(context).length : 0,
      availableActions: this.availableActions(),
      games: this.gameOptions(),
    };
  }

  displayView(players: readonly PublicPlayer[]): DisplayView {
    if (this.phase === 'LOBBY') return { kind: 'lobby' };
    if (this.phase === 'GAME_SELECT') return { kind: 'game_select', games: this.gameOptions() };
    if (this.phase === 'LEADERBOARD') return this.leaderboardView(players);
    if (this.phase === 'PARTY_COMPLETE') return this.partyCompleteView(players);
    if (!this.game) return { kind: 'lobby' };
    return this.game.displayView(this.roundContext(players));
  }

  playerView(player: PublicPlayer, players: readonly PublicPlayer[]): PlayerView {
    if (this.phase === 'PARTY_COMPLETE') return this.partyCompletePlayerView(player, players);
    if (this.phase === 'LOBBY' || this.phase === 'GAME_SELECT' || !this.game) {
      return { kind: 'idle', message: 'Waiting for the host to start a game.' };
    }
    if (this.phase === 'LEADERBOARD') {
      return { kind: 'waiting', message: 'Check the TV for the leaderboard.' };
    }
    if (this.phase === 'GAME_COMPLETE') {
      return { kind: 'idle', message: 'Game over. Waiting for the host.' };
    }
    return this.game.playerView(this.roundContext(players), player);
  }

  private leaderboardView(players: readonly PublicPlayer[]): DisplayView {
    return { kind: 'leaderboard', rows: this.scoreboard.standings(players) };
  }

  /** The real leaderboard, minus the special player: she isn't a competitor. */
  private partyCompleteView(players: readonly PublicPlayer[]): DisplayView {
    const ranked = players.filter((player) => player.role !== 'SPECIAL');
    return {
      kind: 'party_complete',
      rows: this.scoreboard.standings(ranked),
      specialPlayerName: this.options.specialPlayerName,
    };
  }

  private partyCompletePlayerView(
    player: PublicPlayer,
    players: readonly PublicPlayer[],
  ): PlayerView {
    if (player.role === 'SPECIAL') {
      return {
        kind: 'party_complete',
        special: true,
        standing: null,
        message: "You didn't need the points. You were the prize.",
      };
    }
    const standing = this.scoreboard.standingFor(player.id, players);
    return {
      kind: 'party_complete',
      special: false,
      standing,
      message: standing
        ? `Thanks for playing! You finished #${standing.rank} of ${standing.totalPlayers}.`
        : 'Thanks for playing!',
    };
  }

  private gameOptions(): ViewOption[] {
    return this.options.games.map((game) => ({ id: game.id, label: game.name }));
  }

  private roundCount(): number {
    return this.game?.roundCount ?? 0;
  }

  private roundContext(players: readonly PublicPlayer[]): RoundContext {
    return {
      phase: this.phase,
      roundIndex: this.roundIndex,
      roundCount: this.roundCount(),
      players,
      submissions: this.submissions,
      specialPlayerName: this.options.specialPlayerName,
      specialNote: this.specialNote,
      specialPick: this.specialPick,
    };
  }

  private applyScoring(players: readonly PublicPlayer[]): void {
    if (!this.game) return;
    this.scoreboard.apply(this.roundKey(), this.game.scoreRound(this.roundContext(players)));
  }

  private roundKey(): string {
    return `${this.game?.id ?? 'none'}:${this.roundIndex}`;
  }

  private clearRound(): void {
    this.submissions = new Map();
    this.specialNote = null;
    this.specialPick = null;
  }
}
