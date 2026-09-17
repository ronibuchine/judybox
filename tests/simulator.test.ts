import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe, expect, it } from 'vitest';
import { ConnectionRegistry } from '../server/src/connections';
import type { GameDefinition } from '../server/src/engine/types';
import { GameEngine } from '../server/src/engine/engine';
import { CaptionThisGame } from '../server/src/games/captionThis';
import { DrawThisGame } from '../server/src/games/drawThis';
import { MultipleChoiceGame } from '../server/src/games/multipleChoice';
import { RottenTomatoesGame } from '../server/src/games/rottenTomatoes';
import { Session } from '../server/src/session';
import { attachWebSocketServer } from '../server/src/ws';
import { runSimulation } from '../simulator/src/simulate';
import type { SimulatorOptions } from '../simulator/src/types';
import { HostClient } from '../simulator/src/hostClient';

const TRIVIA = new MultipleChoiceGame({
  id: 'trivia',
  name: 'Trivia',
  rounds: [
    { prompt: 'Q1', options: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }], correctOptionId: 'a' },
    { prompt: 'Q2', options: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }], correctOptionId: 'b' },
  ],
});

const RATE_THIS = new RottenTomatoesGame({
  id: 'rate-this',
  name: 'Rate This',
  rounds: [{ prompt: 'Rate it', imageUrl: null, meta: null }],
});

const CAPTION = new CaptionThisGame({
  id: 'caption-this',
  name: 'Caption This',
  rounds: [{ prompt: 'Caption it', imageUrl: null }],
});

const DRAW = new DrawThisGame({
  id: 'draw-this',
  name: 'Draw This',
  rounds: [{ prompt: 'Draw it' }],
});

interface RunningServer {
  url: string;
  session: Session;
  close: () => Promise<void>;
}

async function startServer(games: GameDefinition[], specialPlayerName = 'Judy'): Promise<RunningServer> {
  const registry = new ConnectionRegistry();
  const session = new Session(specialPlayerName);
  const engine = new GameEngine({ games, specialPlayerName });
  const httpServer: Server = createServer();
  attachWebSocketServer(httpServer, registry, session, engine);
  await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
  const port = (httpServer.address() as AddressInfo).port;
  return {
    url: `http://127.0.0.1:${port}`,
    session,
    close: () => new Promise<void>((resolve) => httpServer.close(() => resolve())),
  };
}

function options(overrides: Partial<SimulatorOptions> & { host: string }): SimulatorOptions {
  return {
    players: 1,
    chaos: false,
    verbose: false,
    seed: 1,
    includeJudy: false,
    manualHost: false,
    ...overrides,
  };
}

async function waitFor(predicate: () => boolean, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error(`timed out after ${timeoutMs}ms waiting for condition`);
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }
}

describe('simulator', () => {
  it('plays a single-player session end to end', async () => {
    const server = await startServer([TRIVIA]);
    try {
      const result = await runSimulation(options({ host: server.url, players: 1 }));
      expect(result.ok).toBe(true);
      expect(result.failures).toEqual([]);
      expect(result.players).toBe(1);
      expect(result.rounds).toBe(2);
    } finally {
      await server.close();
    }
  });

  it('plays a 5-player session end to end', async () => {
    const server = await startServer([TRIVIA]);
    try {
      const result = await runSimulation(options({ host: server.url, players: 5 }));
      expect(result.ok).toBe(true);
      expect(result.players).toBe(5);
    } finally {
      await server.close();
    }
  });

  it('plays a 20-player session with simultaneous submissions', async () => {
    const server = await startServer([TRIVIA]);
    try {
      const result = await runSimulation(options({ host: server.url, players: 20 }));
      expect(result.ok).toBe(true);
      expect(result.failures).toEqual([]);
      expect(result.players).toBe(20);
    } finally {
      await server.close();
    }
  });

  it('includes and exercises the special player (Judy)', async () => {
    const server = await startServer([RATE_THIS], 'Judy');
    try {
      const result = await runSimulation(
        options({ host: server.url, players: 4, includeJudy: true }),
      );
      expect(result.ok).toBe(true);
      expect(result.players).toBe(5);
    } finally {
      await server.close();
    }
  });

  it('has the special player judge a winner (Caption This)', async () => {
    const server = await startServer([CAPTION], 'Judy');
    try {
      const result = await runSimulation(
        options({ host: server.url, players: 4, includeJudy: true }),
      );
      expect(result.ok).toBe(true);
      expect(result.failures).toEqual([]);
    } finally {
      await server.close();
    }
  });

  it('produces a valid Draw This submission over the wire', async () => {
    const server = await startServer([DRAW], 'Judy');
    try {
      const result = await runSimulation(
        options({ host: server.url, players: 4, includeJudy: true }),
      );
      expect(result.ok).toBe(true);
      expect(result.failures).toEqual([]);
    } finally {
      await server.close();
    }
  });

  it('reconnects a player mid-round under chaos', async () => {
    const server = await startServer([TRIVIA]);
    try {
      const result = await runSimulation(
        options({ host: server.url, players: 6, chaos: true, seed: 7 }),
      );
      expect(result.ok).toBe(true);
      expect(result.reconnects).toBeGreaterThan(0);
    } finally {
      await server.close();
    }
  }, 15_000);

  it('deliberately attempts a duplicate submission under chaos, without failing', async () => {
    const server = await startServer([TRIVIA]);
    try {
      const result = await runSimulation(
        options({ host: server.url, players: 6, chaos: true, seed: 7 }),
      );
      expect(result.ok).toBe(true);
      expect(result.duplicateAttempts).toBeGreaterThan(0);
    } finally {
      await server.close();
    }
  }, 15_000);

  it('tolerates a player that never submits under chaos', async () => {
    const server = await startServer([TRIVIA]);
    try {
      const result = await runSimulation(
        options({ host: server.url, players: 6, chaos: true, seed: 99 }),
      );
      // The round still completes and scores despite the deliberate no-show.
      expect(result.ok).toBe(true);
      expect(result.rounds).toBe(2);
    } finally {
      await server.close();
    }
  }, 15_000);

  it('progresses through multiple different games in one run', async () => {
    const server = await startServer([TRIVIA, CAPTION, DRAW]);
    try {
      const result = await runSimulation(
        options({ host: server.url, players: 4, includeJudy: true }),
      );
      expect(result.ok).toBe(true);
      // 2 trivia rounds + 1 caption round + 1 draw round.
      expect(result.rounds).toBe(4);
    } finally {
      await server.close();
    }
  });

  it('is reproducible: the same seed under chaos yields the same reconnect/duplicate counts', async () => {
    const serverA = await startServer([TRIVIA]);
    const resultA = await runSimulation(
      options({ host: serverA.url, players: 8, chaos: true, seed: 555 }),
    );
    await serverA.close();

    const serverB = await startServer([TRIVIA]);
    const resultB = await runSimulation(
      options({ host: serverB.url, players: 8, chaos: true, seed: 555 }),
    );
    await serverB.close();

    expect(resultA.ok).toBe(true);
    expect(resultB.ok).toBe(true);
    expect(resultB.reconnects).toBe(resultA.reconnects);
    expect(resultB.duplicateAttempts).toBe(resultA.duplicateAttempts);
    expect(resultB.rounds).toBe(resultA.rounds);
  }, 20_000);

  it('restricts the run to a single requested game via --game', async () => {
    const server = await startServer([TRIVIA, RATE_THIS]);
    try {
      const result = await runSimulation(
        options({ host: server.url, players: 3, gameId: 'rate-this' }),
      );
      expect(result.ok).toBe(true);
      expect(result.rounds).toBe(1);
    } finally {
      await server.close();
    }
  });

  it('fails loudly with a non-ok result when a player cannot join', async () => {
    const server = await startServer([TRIVIA]);
    try {
      // First run claims the generated names; the second, identical run
      // collides on every one of them and must report the failure.
      await runSimulation(options({ host: server.url, players: 3 }));
      const resultB = await runSimulation(options({ host: server.url, players: 3 }));
      expect(resultB.ok).toBe(false);
      expect(resultB.failures.length).toBeGreaterThan(0);
    } finally {
      await server.close();
    }
  });

  it('keeps fake players connected while an external host controls manual mode', async () => {
    const server = await startServer([TRIVIA]);
    const externalHost = new HostClient(server.url.replace(/^http/, 'ws') + '/ws');
    const controller = new AbortController();
    const simulation = runSimulation(
      options({ host: server.url, players: 20, manualHost: true }),
      { stopSignal: controller.signal },
    );
    try {
      await externalHost.connect();
      await waitFor(() => server.session.connectedCount() === 20, 5_000);

      await externalHost.action('OPEN_GAME_SELECT');
      await externalHost.action('START_GAME', { gameId: 'trivia' });
      await externalHost.action('CONTINUE');
      await externalHost.action('OPEN_INPUT');
      const submissions = await externalHost.waitForSubmissions(20, 5_000);
      expect(submissions.settled).toBe(true);
      expect(submissions.submittedCount).toBe(20);

      controller.abort();
      const result = await simulation;
      expect(result.ok).toBe(true);
      expect(result.players).toBe(20);
      expect(result.failures).toEqual([]);
      expect(result.rounds).toBe(0);
    } finally {
      controller.abort();
      externalHost.close();
      await server.close();
      await simulation;
    }
  }, 15_000);

  it('rejects manual mode without a stop signal', async () => {
    const server = await startServer([TRIVIA]);
    try {
      const result = await runSimulation(options({ host: server.url, manualHost: true }));
      expect(result.ok).toBe(false);
      expect(result.failures).toContain('manual host mode requires a stop signal');
    } finally {
      await server.close();
    }
  });
});
