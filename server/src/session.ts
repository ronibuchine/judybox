import { randomUUID } from 'node:crypto';
import {
  playerNameKey,
  validatePlayerName,
  type JoinRejectionCode,
  type PlayerRole,
  type PresenceCounts,
  type PublicPlayer,
  type SessionSnapshot,
} from '@judybox/shared';

export interface Player {
  id: string;
  name: string;
  role: PlayerRole;
  connected: boolean;
  joinedAt: number;
  /** Reconnect credential. Never sent to anyone but its owner. */
  token: string;
  /** Socket currently carrying this player, if any. */
  connectionId: string | null;
}

export type JoinResult =
  | { ok: true; player: Player; token: string }
  | { ok: false; code: JoinRejectionCode; message: string };

/**
 * Authoritative in-memory roster for one run of the server.
 *
 * Players are never deleted on disconnect, only marked offline: that is what
 * lets a refreshed or slept phone come back as the same person. Nothing is
 * persisted, so restarting the process starts an empty party.
 */
export class Session {
  readonly id = randomUUID();

  private readonly players = new Map<string, Player>();
  private readonly playerIdByToken = new Map<string, string>();
  private readonly playerIdByConnection = new Map<string, string>();

  constructor(readonly specialPlayerName: string) {}

  /** Registers a new player. Names are unique per session, case-insensitively. */
  join(rawName: string, connectionId: string): JoinResult {
    if (this.playerIdByConnection.has(connectionId)) {
      return {
        ok: false,
        code: 'already_joined',
        message: 'This device has already joined.',
      };
    }

    const validated = validatePlayerName(rawName);
    if (!validated.ok) {
      return { ok: false, code: validated.code, message: validated.message };
    }
    const name = validated.name;
    const key = playerNameKey(name);

    const isSpecial = key === playerNameKey(this.specialPlayerName);
    if (isSpecial && this.specialPlayer() !== undefined) {
      return {
        ok: false,
        code: 'special_taken',
        message: `${this.specialPlayerName} has already joined on another device.`,
      };
    }
    if (!isSpecial) {
      const existing = this.findByName(key);
      if (existing !== undefined) {
        // Echo the name already in the lobby, so a case-only clash reads clearly.
        return {
          ok: false,
          code: 'name_taken',
          message: `Someone already joined as ${existing.name}. Pick another name.`,
        };
      }
    }

    const player: Player = {
      id: randomUUID(),
      name,
      role: isSpecial ? 'SPECIAL' : 'PLAYER',
      connected: true,
      joinedAt: Date.now(),
      token: randomUUID(),
      connectionId,
    };

    this.players.set(player.id, player);
    this.playerIdByToken.set(player.token, player.id);
    this.playerIdByConnection.set(connectionId, player.id);

    return { ok: true, player, token: player.token };
  }

  /** Rebinds an existing player to a new socket after a refresh or reconnect. */
  resume(token: string, connectionId: string): Player | null {
    const playerId = this.playerIdByToken.get(token);
    if (playerId === undefined) return null;

    const player = this.players.get(playerId);
    if (!player) return null;

    if (player.connectionId && player.connectionId !== connectionId) {
      this.playerIdByConnection.delete(player.connectionId);
    }
    player.connected = true;
    player.connectionId = connectionId;
    this.playerIdByConnection.set(connectionId, player.id);
    return player;
  }

  /** Marks the player behind a dropped socket offline, keeping their identity. */
  disconnect(connectionId: string): Player | null {
    const playerId = this.playerIdByConnection.get(connectionId);
    if (playerId === undefined) return null;
    this.playerIdByConnection.delete(connectionId);

    const player = this.players.get(playerId);
    if (!player) return null;
    // A newer socket may already own this player; do not knock it offline.
    if (player.connectionId !== connectionId) return player;

    player.connected = false;
    player.connectionId = null;
    return player;
  }

  playerByConnection(connectionId: string): Player | undefined {
    const playerId = this.playerIdByConnection.get(connectionId);
    return playerId === undefined ? undefined : this.players.get(playerId);
  }

  specialPlayer(): Player | undefined {
    return this.all().find((player) => player.role === 'SPECIAL');
  }

  all(): Player[] {
    return [...this.players.values()].sort((a, b) => a.joinedAt - b.joinedAt);
  }

  connectedCount(): number {
    return this.all().filter((player) => player.connected).length;
  }

  snapshot(connections: PresenceCounts): SessionSnapshot {
    return {
      sessionId: this.id,
      players: this.all().map(toPublicPlayer),
      specialPlayerName: this.specialPlayerName,
      specialPlayerClaimed: this.specialPlayer() !== undefined,
      connections,
    };
  }

  private findByName(key: string): Player | undefined {
    return this.all().find((player) => playerNameKey(player.name) === key);
  }
}

export function toPublicPlayer(player: Player): PublicPlayer {
  return {
    id: player.id,
    name: player.name,
    role: player.role,
    connected: player.connected,
    joinedAt: player.joinedAt,
  };
}
