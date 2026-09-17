import { runSimulation } from './simulate.js';
import type { SimulatorOptions } from './types.js';

const DEFAULT_HOST = 'http://127.0.0.1:3000';
const DEFAULT_PLAYERS = 6;
const DEFAULT_SEED = 42;

interface RawArgs {
  players?: string;
  host?: string;
  game?: string;
  chaos: boolean;
  verbose: boolean;
  seed?: string;
  includeJudy: boolean;
  manualHost: boolean;
}

function parseArgs(argv: string[]): RawArgs {
  const args: RawArgs = { chaos: false, verbose: false, includeJudy: false, manualHost: false };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    switch (token) {
      case '--':
        break;
      case '--players':
        args.players = argv[(i += 1)];
        break;
      case '--host':
        args.host = argv[(i += 1)];
        break;
      case '--game':
        args.game = argv[(i += 1)];
        break;
      case '--seed':
        args.seed = argv[(i += 1)];
        break;
      case '--chaos':
        args.chaos = true;
        break;
      case '--verbose':
        args.verbose = true;
        break;
      case '--include-judy':
        args.includeJudy = true;
        break;
      case '--manual-host':
        args.manualHost = true;
        break;
      default:
        console.warn(`[simulate] ignoring unknown argument: ${token}`);
    }
  }
  return args;
}

function resolveOptions(raw: RawArgs): SimulatorOptions {
  const players = raw.players !== undefined ? Number(raw.players) : DEFAULT_PLAYERS;
  if (!Number.isInteger(players) || players < 1) {
    throw new Error(`--players must be a positive integer, got "${raw.players}"`);
  }
  const seed = raw.seed !== undefined ? Number(raw.seed) : DEFAULT_SEED;
  if (!Number.isFinite(seed)) {
    throw new Error(`--seed must be a number, got "${raw.seed}"`);
  }
  if (raw.manualHost && raw.game !== undefined) {
    throw new Error('--manual-host cannot be combined with --game because the browser host selects the game');
  }

  return {
    players,
    host: raw.host ?? DEFAULT_HOST,
    gameId: raw.game,
    chaos: raw.chaos,
    verbose: raw.verbose,
    seed,
    includeJudy: raw.includeJudy,
    manualHost: raw.manualHost,
  };
}

async function main(): Promise<void> {
  const options = resolveOptions(parseArgs(process.argv.slice(2)));
  const controller = new AbortController();
  const handleSignal = (): void => controller.abort();
  process.once('SIGINT', handleSignal);
  process.once('SIGTERM', handleSignal);
  try {
    const result = await runSimulation(options, { stopSignal: controller.signal });
    process.exitCode = result.ok ? 0 : 1;
  } finally {
    process.removeListener('SIGINT', handleSignal);
    process.removeListener('SIGTERM', handleSignal);
  }
}

main().catch((error: unknown) => {
  console.error('[simulate] fatal:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
