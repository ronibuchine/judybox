import { randomUUID } from 'node:crypto';
import type { WebSocket } from 'ws';
import type { ConnectionRole, PresenceCounts, ServerToClientMessage } from '@judybox/shared';

export interface Connection {
  id: string;
  role: ConnectionRole;
  socket: WebSocket;
  missedPongs: number;
  connectedAt: number;
}

/** How long a refreshed phone keeps its identity before the id is dropped. */
const RECONNECT_GRACE_MS = 60_000;

interface RetiredConnection {
  role: ConnectionRole;
  retiredAt: number;
}

/**
 * Tracks live sockets and the ids they may resume with.
 *
 * Only connection identity lives here. Player names and scores arrive in a
 * later milestone and will be keyed off these ids.
 */
export class ConnectionRegistry {
  /** New on every process start, so clients can detect a server restart. */
  readonly sessionId = randomUUID();

  private readonly live = new Map<string, Connection>();
  private readonly retired = new Map<string, RetiredConnection>();

  /**
   * Attaches a socket, reusing `requestedId` when it was issued by this server
   * process and is not currently in use by another live socket.
   */
  attach(
    socket: WebSocket,
    role: ConnectionRole,
    requestedId: string | undefined,
    requestedSessionId: string | undefined,
  ): { connection: Connection; resumed: boolean } {
    this.pruneRetired();

    const canResume =
      requestedId !== undefined &&
      requestedSessionId === this.sessionId &&
      !this.live.has(requestedId) &&
      this.retired.has(requestedId);

    const id = canResume && requestedId ? requestedId : randomUUID();
    if (canResume) this.retired.delete(id);

    const connection: Connection = {
      id,
      role,
      socket,
      missedPongs: 0,
      connectedAt: Date.now(),
    };
    this.live.set(id, connection);
    return { connection, resumed: canResume };
  }

  detach(id: string): void {
    const connection = this.live.get(id);
    if (!connection) return;
    this.live.delete(id);
    this.retired.set(id, { role: connection.role, retiredAt: Date.now() });
  }

  get(id: string): Connection | undefined {
    return this.live.get(id);
  }

  presence(): PresenceCounts {
    const counts: PresenceCounts = { display: 0, host: 0, player: 0 };
    for (const connection of this.live.values()) counts[connection.role] += 1;
    return counts;
  }

  all(): Connection[] {
    return [...this.live.values()];
  }

  send(connection: Connection, message: ServerToClientMessage): void {
    if (connection.socket.readyState !== connection.socket.OPEN) return;
    connection.socket.send(JSON.stringify(message));
  }

  broadcast(message: ServerToClientMessage): void {
    const payload = JSON.stringify(message);
    for (const connection of this.live.values()) {
      if (connection.socket.readyState === connection.socket.OPEN) connection.socket.send(payload);
    }
  }

  private pruneRetired(): void {
    const cutoff = Date.now() - RECONNECT_GRACE_MS;
    for (const [id, entry] of this.retired) {
      if (entry.retiredAt < cutoff) this.retired.delete(id);
    }
  }
}
