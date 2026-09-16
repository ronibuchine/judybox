/**
 * Wire protocol shared by server and client.
 *
 * Two distinct identity concepts:
 *  - ConnectionRole  which surface a *socket* is (display/host/player)
 *  - PlayerRole      what a *person* is in the session (PLAYER/SPECIAL)
 * A player outlives their socket, which is what makes refresh and sleep survivable.
 */

export const WS_PATH = '/ws';

/** Which of the three UI surfaces a socket belongs to. */
export const CONNECTION_ROLES = ['display', 'host', 'player'] as const;
export type ConnectionRole = (typeof CONNECTION_ROLES)[number];

export function isConnectionRole(value: unknown): value is ConnectionRole {
  return typeof value === 'string' && (CONNECTION_ROLES as readonly string[]).includes(value);
}

export const PLAYER_ROLES = ['PLAYER', 'SPECIAL'] as const;
export type PlayerRole = (typeof PLAYER_ROLES)[number];

export const MAX_PLAYER_NAME_LENGTH = 20;

/** Keeps a live comment readable on a TV from across the room. */
export const MAX_SPECIAL_NOTE_LENGTH = 140;

/** Keeps an anonymous caption readable on a TV from across the room. */
export const MAX_CAPTION_LENGTH = 140;

/** Bounds of the rating scale used by score-guessing games. */
export const RATING_MIN = 0;
export const RATING_MAX = 100;

/** Bounds a drawing's wire size: point coordinates are integers on this grid. */
export const DRAWING_GRID = 1000;
export const MAX_STROKES_PER_DRAWING = 40;
export const MAX_POINTS_PER_STROKE = 100;

export const DRAWING_COLORS = ['black', 'blue', 'green', 'red', 'yellow'] as const;
export type DrawingColor = (typeof DRAWING_COLORS)[number];

export function isDrawingColor(value: unknown): value is DrawingColor {
  return typeof value === 'string' && (DRAWING_COLORS as readonly string[]).includes(value);
}

/** One drawn line. Points are a flat [x0, y0, x1, y1, ...] list on a 0-1000 grid. */
export interface DrawStroke {
  points: number[];
  size: 'thin' | 'thick';
  /** Omitted color is black for backward-compatible drawing payloads. */
  color?: DrawingColor;
  /** True erases rather than draws, via destination-out compositing. */
  erase?: boolean;
}

/** A free-text remark the special player can add to the current round. */
export interface SpecialNoteInput {
  /** Saved text, echoed back so a refresh or reconnect keeps it. */
  value: string;
  /** Field heading, e.g. "Your comment for the TV". */
  label: string;
  /** One line explaining where the comment ends up and when. */
  hint: string;
  placeholder: string;
  /** False once the host has moved past the reveal. */
  editable: boolean;
  maxLength: number;
}

/** A player as seen by everyone. Never contains the reconnect token. */
export interface PublicPlayer {
  id: string;
  name: string;
  role: PlayerRole;
  connected: boolean;
  joinedAt: number;
}

export interface SessionSnapshot {
  sessionId: string;
  players: PublicPlayer[];
  /** Configured special-player name, so the phone can warn before joining. */
  specialPlayerName: string;
  specialPlayerClaimed: boolean;
  connections: PresenceCounts;
}

export type JoinRejectionCode =
  | 'name_empty'
  | 'name_too_long'
  | 'name_invalid'
  | 'name_taken'
  | 'special_taken'
  | 'already_joined';

/** Canonical lifecycle. Individual games opt into the subset they need. */
export const ENGINE_PHASES = [
  'LOBBY',
  'GAME_SELECT',
  'GAME_INTRO',
  'ROUND_INTRO',
  'PLAYER_INPUT',
  'SUBMISSIONS_LOCKED',
  'REVEAL',
  'RESULTS',
  'LEADERBOARD',
  'GAME_COMPLETE',
  /** Party-wide finale, reachable from any phase. Not owned by any game. */
  'PARTY_COMPLETE',
] as const;
export type EnginePhase = (typeof ENGINE_PHASES)[number];

export const HOST_ACTIONS = [
  'OPEN_GAME_SELECT',
  'START_GAME',
  'CONTINUE',
  'OPEN_INPUT',
  'LOCK_SUBMISSIONS',
  'REVEAL',
  'SHOW_RESULTS',
  'SHOW_LEADERBOARD',
  'NEXT_ROUND',
  'SKIP_ROUND',
  'RESTART_ROUND',
  'RESTART_GAME',
  'RETURN_TO_GAME_SELECT',
  'RETURN_TO_LOBBY',
  'END_PARTY',
] as const;
export type HostAction = (typeof HOST_ACTIONS)[number];

export function isHostAction(value: unknown): value is HostAction {
  return typeof value === 'string' && (HOST_ACTIONS as readonly string[]).includes(value);
}

export interface ViewOption {
  id: string;
  label: string;
}

/** One row of the authoritative leaderboard. Ties share a rank. */
export interface LeaderboardRow {
  playerId: string;
  playerName: string;
  score: number;
  rank: number;
  /** Points gained in the most recently scored round. */
  delta: number;
}

/** A single player's position, shown on their own phone. */
export interface PlayerStanding {
  score: number;
  rank: number;
  delta: number;
  totalPlayers: number;
}

/** An action the host may take right now, with the label to render. */
export interface AvailableAction {
  action: HostAction;
  label: string;
  /** Destructive actions get a confirmation step in the host UI. */
  danger?: boolean;
}

export interface EngineSnapshot {
  phase: EnginePhase;
  gameId: string | null;
  gameName: string | null;
  /** 1-based for display; 0 when no round is active. */
  roundNumber: number;
  roundCount: number;
  submittedCount: number;
  expectedCount: number;
  availableActions: AvailableAction[];
  games: ViewOption[];
}

export type DisplayView =
  | { kind: 'lobby' }
  | { kind: 'game_select'; games: ViewOption[] }
  | { kind: 'game_intro'; gameName: string; roundCount: number }
  | {
      kind: 'round_intro';
      roundNumber: number;
      roundCount: number;
      prompt: string;
      imageUrl?: string | null;
      /** Optional aside from the pack, e.g. a year or a director. */
      meta?: string | null;
    }
  | {
      kind: 'question';
      prompt: string;
      /** Empty for games whose answer is a number rather than a choice. */
      options: ViewOption[];
      answered: number;
      expected: number;
      locked: boolean;
      imageUrl?: string | null;
      /** Whether the special player has answered, without revealing what. */
      specialStatus?: { name: string; answered: boolean } | null;
      /** Present when players answer on a numeric scale. */
      scale?: { min: number; max: number; label: string } | null;
    }
  | {
      kind: 'reveal';
      prompt: string;
      options: ViewOption[];
      correctOptionId: string | null;
      tallies: Record<string, number>;
      imageUrl?: string | null;
      /** Heading above the revealed answer, e.g. "Judy's answer". */
      revealLabel?: string;
      /** Optional aside shown with the reveal. */
      note?: string | null;
    }
  | {
      kind: 'rating_reveal';
      prompt: string;
      imageUrl?: string | null;
      meta?: string | null;
      /** Heading above the revealed score, e.g. "Judy's score". */
      revealLabel: string;
      /** Null when the special player never entered her score. */
      actualScore: number | null;
      min: number;
      max: number;
      /** Nearest first; distance is null until the actual score exists. */
      guesses: { playerName: string; score: number; distance: number | null }[];
      note?: string | null;
    }
  | {
      kind: 'results';
      prompt: string;
      rows: { playerName: string; choiceLabel: string | null; correct: boolean | null }[];
    }
  | {
      kind: 'caption_gallery';
      prompt: string;
      imageUrl?: string | null;
      /** Names and the winner mark appear only once `revealed`. */
      revealed: boolean;
      entries: { id: string; text: string; playerName?: string; isWinner?: boolean }[];
      /** Whether the special player has picked, without saying who. */
      judyDeciding: boolean;
    }
  | {
      kind: 'drawing_gallery';
      prompt: string;
      revealed: boolean;
      entries: { id: string; strokes: DrawStroke[]; playerName?: string; isWinner?: boolean }[];
      judyDeciding: boolean;
    }
  | { kind: 'leaderboard'; rows: LeaderboardRow[] }
  | { kind: 'game_complete'; gameName: string }
  | {
      kind: 'party_complete';
      /** Real standings, ranked, excluding the special player. */
      rows: LeaderboardRow[];
      specialPlayerName: string;
    };

export type PlayerView =
  | { kind: 'idle'; message: string }
  | {
      kind: 'choose';
      prompt: string;
      options: ViewOption[];
      selectedOptionId: string | null;
      locked: boolean;
      /** Instruction above the prompt; differs for the special player. */
      headline?: string;
      imageUrl?: string | null;
      /** Marks this device's input as the private special-player answer. */
      special?: boolean;
      note?: SpecialNoteInput | null;
    }
  | {
      kind: 'rate';
      prompt: string;
      /** Instruction above the prompt; differs for the special player. */
      headline?: string;
      imageUrl?: string | null;
      min: number;
      max: number;
      step: number;
      /** Where the slider sits before anything is submitted. */
      defaultValue: number;
      /** Echoed back so a refresh or reconnect keeps the submitted score. */
      submittedValue: number | null;
      locked: boolean;
      /** Marks this device's input as the private special-player score. */
      special?: boolean;
      note?: SpecialNoteInput | null;
    }
  | { kind: 'waiting'; message: string; note?: SpecialNoteInput | null }
  | {
      kind: 'round_result';
      correct: boolean | null;
      message: string;
      note?: SpecialNoteInput | null;
    }
  | {
      kind: 'caption';
      prompt: string;
      imageUrl?: string | null;
      maxLength: number;
      /** Echoed back so a refresh or reconnect keeps it, and disables the field. */
      submittedText: string | null;
    }
  | {
      kind: 'draw';
      prompt: string;
      maxStrokes: number;
      maxPointsPerStroke: number;
      submitted: boolean;
    }
  | {
      kind: 'judge';
      prompt: string;
      /** Exactly one of `text`/`strokes` is set per entry, depending on the game. */
      entries: { id: string; text?: string; strokes?: DrawStroke[] }[];
      pickedId: string | null;
    }
  | {
      kind: 'party_complete';
      /** True only for the special player, whose message and treatment differ. */
      special: boolean;
      /** Null for the special player, who is not ranked on this screen. */
      standing: PlayerStanding | null;
      message: string;
    };

export type SubmissionRejectionCode =
  | 'not_playing'
  | 'wrong_phase'
  | 'already_submitted'
  | 'invalid_value';

/** Collapses whitespace so "Judy  " and "Judy" are the same person. */
export function normalizePlayerName(raw: string): string {
  return raw.replace(/\s+/gu, ' ').trim();
}

/** Case/whitespace-insensitive key used for duplicate detection. */
export function playerNameKey(raw: string): string {
  return normalizePlayerName(raw).toLocaleLowerCase();
}

export interface NameValidationOk {
  ok: true;
  name: string;
}

export interface NameValidationError {
  ok: false;
  code: Extract<JoinRejectionCode, 'name_empty' | 'name_too_long' | 'name_invalid'>;
  message: string;
}

export function validatePlayerName(raw: string): NameValidationOk | NameValidationError {
  const name = normalizePlayerName(raw);
  if (name.length === 0) {
    return { ok: false, code: 'name_empty', message: 'Enter a name to join.' };
  }
  if (name.length > MAX_PLAYER_NAME_LENGTH) {
    return {
      ok: false,
      code: 'name_too_long',
      message: `Keep it to ${MAX_PLAYER_NAME_LENGTH} characters or fewer.`,
    };
  }
  // Control characters would break the TV layout.
  if (/[\p{Cc}\p{Cf}]/u.test(name)) {
    return { ok: false, code: 'name_invalid', message: 'That name has characters we cannot show.' };
  }
  return { ok: true, name };
}

/** Live counts, so the host can confirm phones are actually attached. */
export interface PresenceCounts {
  display: number;
  host: number;
  player: number;
}

export interface ClientHello {
  type: 'hello';
  role: ConnectionRole;
  /**
   * Previously issued id, replayed after a refresh or reconnect. The server
   * only honours it when its own session id still matches.
   */
  connectionId?: string;
  /** Server session the id was issued by; a mismatch means the server restarted. */
  sessionId?: string;
  /** Reconnect credential from localStorage; restores the player behind this device. */
  playerToken?: string;
}

export interface ClientJoin {
  type: 'join';
  name: string;
}

export interface ClientPong {
  type: 'pong';
}

export interface ClientSubmit {
  type: 'submit';
  value: string;
}

/** The special player's own remark about the current round. */
export interface ClientSpecialNote {
  type: 'special_note';
  text: string;
}

/** The special player picking a winner from this round's submissions. */
export interface ClientSpecialPick {
  type: 'special_pick';
  /** Id of the player whose submission she is picking; empty string clears it. */
  targetPlayerId: string;
}

export interface ClientHostActionMessage {
  type: 'host_action';
  action: HostAction;
  /** Only meaningful for START_GAME. */
  gameId?: string;
}

/** Host-initiated points, for the cases no rule can capture. */
export interface ClientHostAward {
  type: 'host_award';
  playerId: string;
  points: number;
}

export type ClientToServerMessage =
  | ClientHello
  | ClientJoin
  | ClientPong
  | ClientSubmit
  | ClientSpecialNote
  | ClientSpecialPick
  | ClientHostActionMessage
  | ClientHostAward;

export interface ServerWelcome {
  type: 'welcome';
  connectionId: string;
  /** Regenerated on every server start, so clients can detect a restart. */
  sessionId: string;
  role: ConnectionRole;
  /** False when the server issued a fresh id instead of honouring the replayed one. */
  resumed: boolean;
  /** The player restored from the supplied token, if any. */
  self: PublicPlayer | null;
  session: SessionSnapshot;
}

export interface ServerSessionUpdate {
  type: 'session';
  session: SessionSnapshot;
}

export interface ServerJoinAccepted {
  type: 'join_accepted';
  self: PublicPlayer;
  /** Store this; it is how the device proves who it is after a refresh. */
  playerToken: string;
  session: SessionSnapshot;
}

export interface ServerJoinRejected {
  type: 'join_rejected';
  code: JoinRejectionCode;
  message: string;
}

/** Application-level heartbeat; phones answer it to prove the socket is alive. */
export interface ServerPing {
  type: 'ping';
}

export interface ServerError {
  type: 'error';
  code: 'bad_message' | 'bad_role';
  message: string;
}

/** Tailored per connection: TVs and hosts get `display`, phones get `player`. */
export interface ServerViewUpdate {
  type: 'view';
  engine: EngineSnapshot;
  display: DisplayView | null;
  player: PlayerView | null;
  /** This device's own standing, when it belongs to a player. */
  standing: PlayerStanding | null;
  /** Full standings, for the host panel. */
  leaderboard: LeaderboardRow[];
}

export interface ServerActionRejected {
  type: 'action_rejected';
  action: HostAction;
  message: string;
}

export interface ServerSubmissionRejected {
  type: 'submission_rejected';
  code: SubmissionRejectionCode;
  message: string;
}

export type ServerToClientMessage =
  | ServerWelcome
  | ServerSessionUpdate
  | ServerJoinAccepted
  | ServerJoinRejected
  | ServerViewUpdate
  | ServerActionRejected
  | ServerSubmissionRejected
  | ServerPing
  | ServerError;

/** Payload behind `GET /api/connection-info`, used to render the TV join panel. */
export interface ConnectionInfo {
  joinUrl: string;
  /** PNG data URL of `joinUrl`. */
  qrDataUrl: string;
  lanAddress: string;
  port: number;
  sessionId: string;
  partyName: string;
  /** Non-fatal content problems, e.g. a missing image. */
  contentWarnings: string[];
}

/**
 * Parses an untrusted inbound frame. Returns null rather than throwing so the
 * socket handler can answer with a protocol error and stay open.
 */
export function parseClientMessage(raw: string): ClientToServerMessage | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null) return null;

  const candidate = value as Record<string, unknown>;
  switch (candidate['type']) {
    case 'hello': {
      if (!isConnectionRole(candidate['role'])) return null;
      const connectionId = candidate['connectionId'];
      const sessionId = candidate['sessionId'];
      const playerToken = candidate['playerToken'];
      if (connectionId !== undefined && typeof connectionId !== 'string') return null;
      if (sessionId !== undefined && typeof sessionId !== 'string') return null;
      if (playerToken !== undefined && typeof playerToken !== 'string') return null;
      return {
        type: 'hello',
        role: candidate['role'],
        ...(typeof connectionId === 'string' ? { connectionId } : {}),
        ...(typeof sessionId === 'string' ? { sessionId } : {}),
        ...(typeof playerToken === 'string' ? { playerToken } : {}),
      };
    }
    case 'join': {
      if (typeof candidate['name'] !== 'string') return null;
      return { type: 'join', name: candidate['name'] };
    }
    case 'submit': {
      if (typeof candidate['value'] !== 'string') return null;
      return { type: 'submit', value: candidate['value'] };
    }
    case 'special_note': {
      if (typeof candidate['text'] !== 'string') return null;
      return { type: 'special_note', text: candidate['text'] };
    }
    case 'special_pick': {
      if (typeof candidate['targetPlayerId'] !== 'string') return null;
      return { type: 'special_pick', targetPlayerId: candidate['targetPlayerId'] };
    }
    case 'host_action': {
      if (!isHostAction(candidate['action'])) return null;
      const gameId = candidate['gameId'];
      if (gameId !== undefined && typeof gameId !== 'string') return null;
      return {
        type: 'host_action',
        action: candidate['action'],
        ...(typeof gameId === 'string' ? { gameId } : {}),
      };
    }
    case 'host_award': {
      if (typeof candidate['playerId'] !== 'string') return null;
      const points = candidate['points'];
      if (typeof points !== 'number' || !Number.isFinite(points)) return null;
      return { type: 'host_award', playerId: candidate['playerId'], points };
    }
    case 'pong':
      return { type: 'pong' };
    default:
      return null;
  }
}
