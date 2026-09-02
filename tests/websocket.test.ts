import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { WS_PATH, type ServerToClientMessage } from '../shared/src/index';
import { ConnectionRegistry } from '../server/src/connections';
import { Session } from '../server/src/session';
import { GameEngine } from '../server/src/engine/engine';
import { MultipleChoiceGame } from '../server/src/games/multipleChoice';
import { attachWebSocketServer } from '../server/src/ws';

const DEMO_GAME = new MultipleChoiceGame({
  id: 'demo-quiz',
  name: 'Demo Game',
  rounds: [
    {
      prompt: 'What is 2 + 2?',
      options: [
        { id: 'a', label: '3' },
        { id: 'b', label: '4' },
      ],
      correctOptionId: 'b',
    },
  ],
});

let httpServer: Server;
let registry: ConnectionRegistry;
let session: Session;
let engine: GameEngine;
let port: number;

beforeEach(async () => {
  registry = new ConnectionRegistry();
  session = new Session('Judy');
  engine = new GameEngine({ games: [DEMO_GAME], specialPlayerName: 'Judy' });
  httpServer = createServer();
  attachWebSocketServer(httpServer, registry, session, engine);
  await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
  port = (httpServer.address() as AddressInfo).port;
});

afterEach(async () => {
  await new Promise<void>((resolve) => httpServer.close(() => resolve()));
});

function open(): Promise<WebSocket> {
  const socket = new WebSocket(`ws://127.0.0.1:${port}${WS_PATH}`);
  return new Promise((resolve, reject) => {
    socket.once('open', () => resolve(socket));
    socket.once('error', reject);
  });
}

/** Waits for the next frame of a given type, ignoring unrelated traffic. */
function next<T extends ServerToClientMessage['type']>(
  socket: WebSocket,
  type: T,
): Promise<Extract<ServerToClientMessage, { type: T }>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out waiting for "${type}"`)), 2_000);
    const onMessage = (data: WebSocket.RawData): void => {
      const message = JSON.parse(data.toString()) as ServerToClientMessage;
      if (message.type !== type) return;
      clearTimeout(timer);
      socket.off('message', onMessage);
      resolve(message as Extract<ServerToClientMessage, { type: T }>);
    };
    socket.on('message', onMessage);
  });
}

function closed(socket: WebSocket): Promise<void> {
  return new Promise((resolve) => socket.once('close', () => resolve()));
}

type ViewMessage = Extract<ServerToClientMessage, { type: 'view' }>;

/**
 * Waits for a view frame satisfying `predicate`. Actions can produce more than
 * one broadcast, so matching on content is more reliable than counting frames.
 */
function waitForView(socket: WebSocket, predicate: (view: ViewMessage) => boolean): Promise<ViewMessage> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timed out waiting for a matching view')), 2_000);
    const onMessage = (data: WebSocket.RawData): void => {
      const message = JSON.parse(data.toString()) as ServerToClientMessage;
      if (message.type !== 'view' || !predicate(message)) return;
      clearTimeout(timer);
      socket.off('message', onMessage);
      resolve(message);
    };
    socket.on('message', onMessage);
  });
}

const OPENING_STEPS: readonly [string, string][] = [
  ['OPEN_GAME_SELECT', 'GAME_SELECT'],
  ['START_GAME', 'GAME_INTRO'],
  ['CONTINUE', 'ROUND_INTRO'],
  ['OPEN_INPUT', 'PLAYER_INPUT'],
];

/** Drives the host through the given steps, waiting for each phase to land. */
async function drive(host: WebSocket, steps: readonly [string, string][]): Promise<void> {
  for (const [action, phase] of steps) {
    const settled = waitForView(host, (view) => view.engine.phase === phase);
    host.send(JSON.stringify({ type: 'host_action', action }));
    await settled;
  }
}

/** Opens a socket, says hello, and waits for the welcome. */
async function connectAs(
  role: 'player' | 'display' | 'host',
  playerToken?: string,
): Promise<{ socket: WebSocket; welcome: Extract<ServerToClientMessage, { type: 'welcome' }> }> {
  const socket = await open();
  const welcomePromise = next(socket, 'welcome');
  socket.send(JSON.stringify({ type: 'hello', role, ...(playerToken ? { playerToken } : {}) }));
  return { socket, welcome: await welcomePromise };
}

describe('websocket transport', () => {
  it('welcomes a phone with an empty session', async () => {
    const { socket, welcome } = await connectAs('player');

    expect(welcome.role).toBe('player');
    expect(welcome.self).toBeNull();
    expect(welcome.session.players).toEqual([]);
    expect(welcome.session.specialPlayerName).toBe('Judy');

    socket.close();
    await closed(socket);
  });

  it('answers garbage with an error instead of dropping the socket', async () => {
    const socket = await open();
    const error = next(socket, 'error');
    socket.send('}{ not json');

    expect((await error).code).toBe('bad_message');
    expect(socket.readyState).toBe(WebSocket.OPEN);

    socket.close();
    await closed(socket);
  });

  it('refuses a join before hello', async () => {
    const socket = await open();
    const error = next(socket, 'error');
    socket.send(JSON.stringify({ type: 'join', name: 'Sarah' }));

    expect((await error).message).toContain('hello');

    socket.close();
    await closed(socket);
  });

  it('closes a socket that never identifies itself', async () => {
    const socket = await open();
    expect(registry.presence()).toEqual({ display: 0, host: 0, player: 0 });
    socket.close();
    await closed(socket);
  });
});

describe('lobby over the wire', () => {
  it('accepts a join and tells the TV about it', async () => {
    const display = await connectAs('display');
    const sessionUpdate = next(display.socket, 'session');

    const player = await connectAs('player');
    const accepted = next(player.socket, 'join_accepted');
    player.socket.send(JSON.stringify({ type: 'join', name: 'Sarah' }));

    const result = await accepted;
    expect(result.self.name).toBe('Sarah');
    expect(result.self.role).toBe('PLAYER');
    expect(result.playerToken).toBeTruthy();

    await sessionUpdate; // TV was notified
    expect(session.all().map((p) => p.name)).toEqual(['Sarah']);

    player.socket.close();
    display.socket.close();
    await Promise.all([closed(player.socket), closed(display.socket)]);
  });

  it('rejects a duplicate name without disturbing the first player', async () => {
    const first = await connectAs('player');
    const firstAccepted = next(first.socket, 'join_accepted');
    first.socket.send(JSON.stringify({ type: 'join', name: 'Sarah' }));
    await firstAccepted;

    const second = await connectAs('player');
    const rejected = next(second.socket, 'join_rejected');
    second.socket.send(JSON.stringify({ type: 'join', name: 'sarah' }));

    expect((await rejected).code).toBe('name_taken');
    expect(session.all()).toHaveLength(1);

    first.socket.close();
    second.socket.close();
    await Promise.all([closed(first.socket), closed(second.socket)]);
  });

  it('marks the special player and blocks a second claim', async () => {
    const judy = await connectAs('player');
    const accepted = next(judy.socket, 'join_accepted');
    judy.socket.send(JSON.stringify({ type: 'join', name: 'Judy' }));
    expect((await accepted).self.role).toBe('SPECIAL');

    const impostor = await connectAs('player');
    const rejected = next(impostor.socket, 'join_rejected');
    impostor.socket.send(JSON.stringify({ type: 'join', name: 'Judy' }));
    expect((await rejected).code).toBe('special_taken');

    judy.socket.close();
    impostor.socket.close();
    await Promise.all([closed(judy.socket), closed(impostor.socket)]);
  });

  it('returns the same player after a refresh, using the token', async () => {
    const first = await connectAs('player');
    const accepted = next(first.socket, 'join_accepted');
    first.socket.send(JSON.stringify({ type: 'join', name: 'Sarah' }));
    const { playerToken, self } = await accepted;

    first.socket.close();
    await closed(first.socket);

    const second = await connectAs('player', playerToken);
    expect(second.welcome.self?.id).toBe(self.id);
    expect(second.welcome.self?.name).toBe('Sarah');
    expect(second.welcome.session.players).toHaveLength(1);

    second.socket.close();
    await closed(second.socket);
  });

  it('shows a player as offline when their phone drops', async () => {
    const player = await connectAs('player');
    const accepted = next(player.socket, 'join_accepted');
    player.socket.send(JSON.stringify({ type: 'join', name: 'Sarah' }));
    await accepted;

    const display = await connectAs('display');
    const update = next(display.socket, 'session');
    player.socket.close();
    await closed(player.socket);

    const snapshot = (await update).session;
    expect(snapshot.players).toHaveLength(1);
    expect(snapshot.players[0]?.connected).toBe(false);

    display.socket.close();
    await closed(display.socket);
  });

  it('ignores a token the server never issued', async () => {
    const { socket, welcome } = await connectAs('player', 'bogus-token');
    expect(welcome.self).toBeNull();

    socket.close();
    await closed(socket);
  });

  it('does not let a host or display token claim a player', async () => {
    const player = await connectAs('player');
    const accepted = next(player.socket, 'join_accepted');
    player.socket.send(JSON.stringify({ type: 'join', name: 'Sarah' }));
    const { playerToken, self } = await accepted;

    // The host page shares an origin (and localStorage) with the player page.
    const host = await connectAs('host', playerToken);
    expect(host.welcome.self).toBeNull();

    // Sarah must still be attached to her phone, not the host socket.
    const stillHers = session.playerByConnection(player.welcome.connectionId);
    expect(stillHers?.id).toBe(self.id);
    expect(session.playerByConnection(host.welcome.connectionId)).toBeUndefined();

    player.socket.close();
    host.socket.close();
    await Promise.all([closed(player.socket), closed(host.socket)]);
  });
});

describe('host authority over the wire', () => {
  it('refuses host actions sent from a phone', async () => {
    const player = await connectAs('player');
    const accepted = next(player.socket, 'join_accepted');
    player.socket.send(JSON.stringify({ type: 'join', name: 'Sarah' }));
    await accepted;

    const rejected = next(player.socket, 'action_rejected');
    player.socket.send(JSON.stringify({ type: 'host_action', action: 'OPEN_GAME_SELECT' }));

    expect((await rejected).message).toContain('Only the host');
    expect(engine.currentPhase()).toBe('LOBBY');

    player.socket.close();
    await closed(player.socket);
  });

  it('rejects an out-of-order host action', async () => {
    const host = await connectAs('host');
    const rejected = next(host.socket, 'action_rejected');
    host.socket.send(JSON.stringify({ type: 'host_action', action: 'REVEAL' }));

    expect((await rejected).message).toContain('not allowed');
    expect(engine.currentPhase()).toBe('LOBBY');

    host.socket.close();
    await closed(host.socket);
  });

  it('drives a full round and pushes tailored views', async () => {
    const host = await connectAs('host');
    const player = await connectAs('player');
    const joined = next(player.socket, 'join_accepted');
    player.socket.send(JSON.stringify({ type: 'join', name: 'Sarah' }));
    await joined;

    await drive(host.socket, OPENING_STEPS);

    const playerUpdate = waitForView(player.socket, (view) => view.engine.submittedCount === 1);
    player.socket.send(JSON.stringify({ type: 'submit', value: 'b' }));
    const view = await playerUpdate;

    // Phones never receive the TV view, and vice versa.
    expect(view.display).toBeNull();
    expect(view.player?.kind).toBe('choose');

    host.socket.close();
    player.socket.close();
    await Promise.all([closed(host.socket), closed(player.socket)]);
  });

  it('rejects a late submission after the host locks', async () => {
    const host = await connectAs('host');
    const player = await connectAs('player');
    const joined = next(player.socket, 'join_accepted');
    player.socket.send(JSON.stringify({ type: 'join', name: 'Sarah' }));
    await joined;

    await drive(host.socket, [
      ...OPENING_STEPS,
      ['LOCK_SUBMISSIONS', 'SUBMISSIONS_LOCKED'],
    ]);

    const rejected = next(player.socket, 'submission_rejected');
    player.socket.send(JSON.stringify({ type: 'submit', value: 'b' }));

    expect((await rejected).code).toBe('wrong_phase');

    host.socket.close();
    player.socket.close();
    await Promise.all([closed(host.socket), closed(player.socket)]);
  });

  it('restores an answer to a player who reconnects mid-round', async () => {
    const host = await connectAs('host');
    const player = await connectAs('player');
    const joined = next(player.socket, 'join_accepted');
    player.socket.send(JSON.stringify({ type: 'join', name: 'Sarah' }));
    const { playerToken } = await joined;

    await drive(host.socket, OPENING_STEPS);

    const submitted = waitForView(player.socket, (view) => view.engine.submittedCount === 1);
    player.socket.send(JSON.stringify({ type: 'submit', value: 'b' }));
    await submitted;

    player.socket.close();
    await closed(player.socket);

    // Listen before saying hello: welcome and the first view arrive together.
    const back = await open();
    const restored = waitForView(back, (view) => view.player?.kind === 'choose');
    back.send(JSON.stringify({ type: 'hello', role: 'player', playerToken }));

    const view = await restored;
    expect(view.player?.kind).toBe('choose');
    if (view.player?.kind === 'choose') {
      expect(view.player.selectedOptionId).toBe('b');
    }

    host.socket.close();
    back.close();
    await Promise.all([closed(host.socket), closed(back)]);
  });
});
