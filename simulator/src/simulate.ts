import { FakePlayer } from './fakePlayer.js';
import { HostClient } from './hostClient.js';
import { Logger } from './logger.js';
import type { SimulationControl, SimulationResult, SimulatorOptions } from './types.js';

const SUBMIT_SETTLE_TIMEOUT_MS = { calm: 1_200, chaos: 3_000 };
const JUDY_PICK_TIMEOUT_MS = { calm: 1_500, chaos: 3_000 };

function resolveWsUrl(hostArg: string): string {
  const url = new URL(hostArg);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.pathname = url.pathname === '/' || url.pathname === '' ? '' : url.pathname;
  return `${url.origin}/ws`;
}

function playerName(index: number, total: number): string {
  const width = Math.max(2, String(total).length);
  return `Sim${String(index + 1).padStart(width, '0')}`;
}

/**
 * Runs one simulated party session over the real WebSocket protocol: N fake
 * player phones (plus, optionally, the special player) join a real running
 * server, and a simulated host drives every legal transition, exactly like
 * the real host UI would.
 */
export async function runSimulation(
  options: SimulatorOptions,
  control: SimulationControl = {},
): Promise<SimulationResult> {
  const startedAt = Date.now();
  const logger = new Logger(options.verbose);
  const failures: string[] = [];
  const recordFailure = (message: string): void => {
    failures.push(message);
    logger.warn(message);
  };

  logger.info('Simulator starting');
  logger.info(`Players: ${options.players}`);
  logger.info(`Judy: ${options.includeJudy ? 'enabled' : 'disabled'}`);
  logger.info(`Chaos: ${options.chaos ? 'enabled' : 'disabled'}`);
  logger.info(`Manual host: ${options.manualHost ? 'enabled' : 'disabled'}`);
  logger.info(`Server: ${options.host}`);
  logger.info('');

  const wsUrl = resolveWsUrl(options.host);
  const host = new HostClient(wsUrl);

  let roundsPlayed = 0;
  let totalReconnects = 0;
  let totalDuplicateAttempts = 0;
  const fakePlayers: FakePlayer[] = [];

  try {
    await host.connect();

    const totalPlayers = options.players + (options.includeJudy ? 1 : 0);
    for (let index = 0; index < options.players; index += 1) {
      fakePlayers.push(
        new FakePlayer(wsUrl, {
          name: playerName(index, options.players),
          wantsSpecial: false,
          index,
          totalPlayers,
          seed: options.seed,
          chaos: options.chaos,
          logger,
          recordFailure,
        }),
      );
    }
    if (options.includeJudy) {
      fakePlayers.push(
        new FakePlayer(wsUrl, {
          name: host.specialPlayerName,
          wantsSpecial: true,
          index: options.players,
          totalPlayers,
          seed: options.seed,
          chaos: options.chaos,
          logger,
          recordFailure,
        }),
      );
    }

    const joinResults = await Promise.allSettled(fakePlayers.map((player) => player.join()));
    let joined = 0;
    joinResults.forEach((result, i) => {
      if (result.status === 'fulfilled') {
        joined += 1;
      } else {
        recordFailure(`${fakePlayers[i]?.name ?? `player ${i}`} failed to join: ${result.reason}`);
      }
    });
    logger.info(`${fakePlayers.length} players connected`);
    logger.info(`${joined} players joined`);

    if (host.latestSnapshot === null) {
      throw new Error('did not receive an initial engine snapshot from the server');
    }

    if (options.manualHost) {
      if (!control.stopSignal) {
        throw new Error('manual host mode requires a stop signal');
      }
      logger.info('Manual host mode ready; use the browser host to control the game.');
      logger.info('Press Ctrl+C to stop the simulator.');
      await waitForAbort(control.stopSignal);
    } else {
    const availableGames = host.latestSnapshot.games;
    const targetGameIds = options.gameId
      ? availableGames.filter((game) => game.id === options.gameId).map((game) => game.id)
      : availableGames.map((game) => game.id);

    if (targetGameIds.length === 0) {
      throw new Error(
        options.gameId
          ? `no such game: ${options.gameId} (available: ${availableGames.map((g) => g.id).join(', ') || 'none'})`
          : 'party pack has no games configured',
      );
    }

    if (host.latestSnapshot.phase === 'LOBBY') {
      await host.action('OPEN_GAME_SELECT');
    }

    for (const gameId of targetGameIds) {
      await host.action('START_GAME', { gameId });
      logger.info(`Game started: ${gameId}`);
      await host.action('CONTINUE');

      const roundCount = host.latestSnapshot?.roundCount ?? 0;
      for (let round = 0; round < roundCount; round += 1) {
        const roundNumber = round + 1;
        await host.action('OPEN_INPUT');

        const expected = host.latestSnapshot?.expectedCount ?? 0;
        const settleTimeout = options.chaos ? SUBMIT_SETTLE_TIMEOUT_MS.chaos : SUBMIT_SETTLE_TIMEOUT_MS.calm;
        const { settled, submittedCount } = await host.waitForSubmissions(expected, settleTimeout);
        if (!settled) {
          const shortfall = expected - submittedCount;
          const tolerable = options.chaos ? 1 : 0;
          if (shortfall > tolerable) {
            recordFailure(
              `${gameId} round ${roundNumber}: only ${submittedCount}/${expected} submissions landed`,
            );
          }
        }
        logger.info(`Round ${roundNumber}: ${submittedCount} submissions`);

        await host.action('LOCK_SUBMISSIONS');
        await host.action('REVEAL');
        logger.info(`Round ${roundNumber}: revealed`);

        if (options.includeJudy) {
          const pickTimeout = options.chaos ? JUDY_PICK_TIMEOUT_MS.chaos : JUDY_PICK_TIMEOUT_MS.calm;
          await host.waitForJudyPick(pickTimeout);
        }

        await host.action('SHOW_RESULTS');
        logger.info(`Round ${roundNumber}: scored`);
        await host.action('SHOW_LEADERBOARD');
        await host.action('NEXT_ROUND');
        roundsPlayed += 1;
      }

      if (host.latestSnapshot?.phase !== 'GAME_COMPLETE') {
        recordFailure(`${gameId}: expected GAME_COMPLETE after its last round, got ${host.latestSnapshot?.phase}`);
      }
      await host.action('RETURN_TO_GAME_SELECT');
    }
    }

    for (const player of fakePlayers) {
      const stats = player.statsSnapshot();
      totalReconnects += stats.reconnects;
      totalDuplicateAttempts += stats.duplicateAttempts;
    }
  } catch (error) {
    recordFailure(error instanceof Error ? error.message : String(error));
  } finally {
    for (const player of fakePlayers) player.close();
    host.close();
  }

  logger.info('Simulation complete');
  logger.info('');
  logger.info('Result:');
  logger.info(`  players: ${fakePlayers.length}`);
  logger.info(`  rounds: ${roundsPlayed}`);
  logger.info(`  reconnects: ${totalReconnects}`);
  logger.info(`  duplicate attempts: ${totalDuplicateAttempts}`);
  logger.info(`  failures: ${failures.length}`);

  return {
    ok: failures.length === 0,
    players: fakePlayers.length,
    rounds: roundsPlayed,
    reconnects: totalReconnects,
    duplicateAttempts: totalDuplicateAttempts,
    failures,
    durationMs: Date.now() - startedAt,
  };
}

function waitForAbort(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => signal.addEventListener('abort', () => resolve(), { once: true }));
}
