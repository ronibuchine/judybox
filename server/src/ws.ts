import type { Server } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import { WS_PATH, parseClientMessage, type ServerToClientMessage } from '@judybox/shared';
import type { ConnectionRegistry } from './connections.js';
import type { GameEngine } from './engine/engine.js';
import { toPublicPlayer, type Session } from './session.js';

const HEARTBEAT_INTERVAL_MS = 15_000;
const MAX_MISSED_PONGS = 2;
/** A socket that never identifies itself is closed rather than left to leak. */
const HELLO_TIMEOUT_MS = 10_000;

function sendRaw(socket: WebSocket, message: ServerToClientMessage): void {
  if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(message));
}

export function attachWebSocketServer(
  httpServer: Server,
  registry: ConnectionRegistry,
  session: Session,
  engine: GameEngine,
): WebSocketServer {
  const wss = new WebSocketServer({ server: httpServer, path: WS_PATH });

  const snapshot = (): ReturnType<Session['snapshot']> => session.snapshot(registry.presence());
  const broadcastSession = (): void => {
    registry.broadcast({ type: 'session', session: snapshot() });
  };

  /** Each surface gets only the view it needs. */
  const broadcastViews = (): void => {
    const players = session.all().map(toPublicPlayer);
    const engineSnapshot = engine.snapshot(players);
    const displayView = engine.displayView(players);
    const leaderboard = engine.standings(players);

    for (const connection of registry.all()) {
      const player = session.playerByConnection(connection.id);
      const isPlayer = connection.role === 'player' && player !== undefined;
      registry.send(connection, {
        type: 'view',
        engine: engineSnapshot,
        display: connection.role === 'player' ? null : displayView,
        player: isPlayer ? engine.playerView(toPublicPlayer(player), players) : null,
        standing: isPlayer ? engine.standingFor(player.id, players) : null,
        leaderboard: connection.role === 'host' ? leaderboard : [],
      });
    }
  };

  wss.on('connection', (socket) => {
    let connectionId: string | null = null;

    const helloTimer = setTimeout(() => {
      if (!connectionId) socket.close(4000, 'no hello');
    }, HELLO_TIMEOUT_MS);

    socket.on('message', (data) => {
      const message = parseClientMessage(data.toString());
      if (!message) {
        sendRaw(socket, { type: 'error', code: 'bad_message', message: 'Unrecognised message.' });
        return;
      }

      if (message.type === 'hello') {
        if (connectionId) return; // A second hello on one socket is ignored, not fatal.
        clearTimeout(helloTimer);

        const { connection, resumed } = registry.attach(
          socket,
          message.role,
          message.connectionId,
          message.sessionId,
        );
        connectionId = connection.id;

        // Only phones own players; a host/display token must never claim one.
        const player =
          connection.role === 'player' && message.playerToken
            ? session.resume(message.playerToken, connection.id)
            : null;

        registry.send(connection, {
          type: 'welcome',
          connectionId: connection.id,
          sessionId: registry.sessionId,
          role: connection.role,
          resumed,
          self: player ? toPublicPlayer(player) : null,
          session: snapshot(),
        });
        broadcastSession();
        broadcastViews();

        console.log(
          player
            ? `[ws] resumed player ${player.name}`
            : `[ws] ${resumed ? 'resumed' : 'joined'} ${connection.role} ${connection.id.slice(0, 8)}`,
        );
        return;
      }

      if (message.type === 'join') {
        if (!connectionId) {
          sendRaw(socket, { type: 'error', code: 'bad_message', message: 'Say hello first.' });
          return;
        }
        const connection = registry.get(connectionId);
        if (!connection) return;

        const result = session.join(message.name, connectionId);
        if (!result.ok) {
          registry.send(connection, {
            type: 'join_rejected',
            code: result.code,
            message: result.message,
          });
          return;
        }

        registry.send(connection, {
          type: 'join_accepted',
          self: toPublicPlayer(result.player),
          playerToken: result.token,
          session: snapshot(),
        });
        broadcastSession();
        broadcastViews();
        console.log(`[session] ${result.player.name} joined as ${result.player.role}`);
        return;
      }

      if (message.type === 'submit') {
        if (!connectionId) return;
        const connection = registry.get(connectionId);
        const player = session.playerByConnection(connectionId);
        if (!connection) return;
        if (!player) {
          registry.send(connection, {
            type: 'submission_rejected',
            code: 'not_playing',
            message: 'Join the game first.',
          });
          return;
        }

        const players = session.all().map(toPublicPlayer);
        const result = engine.submit(toPublicPlayer(player), message.value, players);
        if (!result.ok) {
          registry.send(connection, {
            type: 'submission_rejected',
            code: result.code,
            message: result.message,
          });
          return;
        }
        broadcastViews();
        return;
      }

      if (message.type === 'special_note') {
        if (!connectionId) return;
        const connection = registry.get(connectionId);
        const player = session.playerByConnection(connectionId);
        if (!connection) return;
        if (!player) {
          registry.send(connection, {
            type: 'submission_rejected',
            code: 'not_playing',
            message: 'Join the game first.',
          });
          return;
        }

        const result = engine.setSpecialNote(toPublicPlayer(player), message.text);
        if (!result.ok) {
          registry.send(connection, {
            type: 'submission_rejected',
            code: result.code,
            message: result.message,
          });
          return;
        }
        broadcastViews();
        return;
      }

      if (message.type === 'special_pick') {
        if (!connectionId) return;
        const connection = registry.get(connectionId);
        const player = session.playerByConnection(connectionId);
        if (!connection) return;
        if (!player) {
          registry.send(connection, {
            type: 'submission_rejected',
            code: 'not_playing',
            message: 'Join the game first.',
          });
          return;
        }

        const result = engine.setSpecialPick(toPublicPlayer(player), message.targetPlayerId);
        if (!result.ok) {
          registry.send(connection, {
            type: 'submission_rejected',
            code: result.code,
            message: result.message,
          });
          return;
        }
        broadcastViews();
        return;
      }

      if (message.type === 'host_action') {
        if (!connectionId) return;
        const connection = registry.get(connectionId);
        if (!connection) return;

        // Only the host surface may drive progression.
        if (connection.role !== 'host') {
          registry.send(connection, {
            type: 'action_rejected',
            action: message.action,
            message: 'Only the host can control the game.',
          });
          return;
        }

        const players = session.all().map(toPublicPlayer);
        const result = engine.applyHostAction(message.action, players, message.gameId);
        if (!result.ok) {
          registry.send(connection, {
            type: 'action_rejected',
            action: message.action,
            message: result.message,
          });
          return;
        }
        console.log(`[engine] ${message.action} -> ${result.phase}`);
        broadcastViews();
        return;
      }

      if (message.type === 'host_award') {
        if (!connectionId) return;
        const connection = registry.get(connectionId);
        if (!connection) return;

        if (connection.role !== 'host') {
          registry.send(connection, {
            type: 'action_rejected',
            action: 'RESTART_ROUND',
            message: 'Only the host can award points.',
          });
          return;
        }

        if (engine.awardManually(message.playerId, message.points)) {
          console.log(`[scoring] host awarded ${message.points} to ${message.playerId.slice(0, 8)}`);
        }
        broadcastViews();
        return;
      }

      if (message.type === 'pong' && connectionId) {
        const connection = registry.get(connectionId);
        if (connection) connection.missedPongs = 0;
      }
    });

    socket.on('close', () => {
      clearTimeout(helloTimer);
      if (!connectionId) return;
      const player = session.disconnect(connectionId);
      registry.detach(connectionId);
      broadcastSession();
      broadcastViews();
      console.log(
        player ? `[session] ${player.name} went offline` : `[ws] left ${connectionId.slice(0, 8)}`,
      );
    });

    socket.on('error', (error) => {
      console.warn('[ws] socket error:', error.message);
    });
  });

  const heartbeat = setInterval(() => {
    for (const connection of registry.all()) {
      if (connection.missedPongs >= MAX_MISSED_PONGS) {
        connection.socket.terminate();
        continue;
      }
      connection.missedPongs += 1;
      registry.send(connection, { type: 'ping' });
    }
  }, HEARTBEAT_INTERVAL_MS);

  wss.on('close', () => clearInterval(heartbeat));
  return wss;
}
