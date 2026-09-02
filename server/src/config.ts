export interface ServerConfig {
  port: number;
  /** Interface to bind. 0.0.0.0 accepts phones; 127.0.0.1 would exclude them. */
  bindHost: string;
  /** Explicit advertised LAN address, used when auto-detection picks wrong. */
  hostOverride: string | undefined;
  /** Content pack directory under content/. */
  packId: string;
  /** Non-fatal configuration problems, printed at startup. */
  warnings: string[];
}

const DEFAULT_PORT = 3000;
const DEFAULT_BIND_HOST = '0.0.0.0';

function resolvePort(env: NodeJS.ProcessEnv, warnings: string[]): number {
  const raw = env['JUDYBOX_PORT'] ?? env['PORT'];
  if (raw === undefined || raw.trim() === '') return DEFAULT_PORT;

  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65_535) {
    warnings.push(`Ignoring invalid port "${raw}"; using ${DEFAULT_PORT}.`);
    return DEFAULT_PORT;
  }
  if (parsed < 1024) {
    warnings.push(`Port ${parsed} is privileged and may fail to bind on Windows.`);
  }
  return parsed;
}

function resolveBindHost(env: NodeJS.ProcessEnv, warnings: string[]): string {
  const raw = (env['JUDYBOX_BIND'] ?? env['HOST'])?.trim();
  if (!raw) return DEFAULT_BIND_HOST;

  if (raw === 'localhost' || raw.startsWith('127.')) {
    warnings.push(
      `Binding to ${raw} accepts only this laptop; phones cannot connect. Unset JUDYBOX_BIND to accept LAN traffic.`,
    );
  }
  return raw;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const warnings: string[] = [];
  const port = resolvePort(env, warnings);
  const bindHost = resolveBindHost(env, warnings);
  const hostOverride = env['JUDYBOX_HOST']?.trim();
  const packId = env['JUDYBOX_PACK']?.trim() || 'judy-30';

  return {
    port,
    bindHost,
    hostOverride: hostOverride ? hostOverride : undefined,
    packId,
    warnings,
  };
}
