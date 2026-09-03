/** CLI-resolved options for one simulation run. Never a hardcoded LAN address. */
export interface SimulatorOptions {
  /** Number of normal-role fake players. */
  players: number;
  /** Base HTTP(S) URL of the real running server, e.g. http://127.0.0.1:3000. */
  host: string;
  /** Restrict the run to a single game id; omit to play every game in the pack. */
  gameId?: string;
  /** Enables bounded, seed-reproducible disruption (delays, drops, duplicates). */
  chaos: boolean;
  /** Per-player event logging, in addition to the concise default summary. */
  verbose: boolean;
  /** Seeds every derived random decision, so a run can be reproduced exactly. */
  seed: number;
  /** Also joins one fake player under the pack's configured special-player name. */
  includeJudy: boolean;
}

export interface SimulationResult {
  ok: boolean;
  players: number;
  rounds: number;
  reconnects: number;
  duplicateAttempts: number;
  failures: string[];
  durationMs: number;
}
