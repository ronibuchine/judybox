import type { PlayerRole, ServerToClientMessage } from '@judybox/shared';
import { Logger } from './logger.js';
import { deriveRng, pickIndex } from './rng.js';
import { SocketClient } from './socketClient.js';
import { decideAction } from './strategies.js';

export interface FakePlayerConfig {
  name: string;
  /** This player will attempt to join under the pack's special-player name. */
  wantsSpecial: boolean;
  index: number;
  totalPlayers: number;
  seed: number;
  chaos: boolean;
  logger: Logger;
  recordFailure: (message: string) => void;
}

export interface FakePlayerStats {
  submitted: number;
  reconnects: number;
  duplicateAttempts: number;
  neverSubmitted: number;
}

/** Non-chaos submissions land within this spread, enough to overlap without a real thundering herd. */
const CALM_SPREAD_MS = 150;
/** Chaos submissions spread much wider, including some right at the lock deadline. */
const CHAOS_SPREAD_MS = 1_400;
/** Extra lag applied to the special player in chaos mode ("Judy answers later than normal"). */
const CHAOS_JUDY_EXTRA_MS = 500;

export class FakePlayer {
  readonly client: SocketClient;
  publicId: string | null = null;
  role: PlayerRole | null = null;
  private token: string | null = null;
  private currentRoundKey: string | null = null;
  private submittedThisRound = false;
  private readonly stats: FakePlayerStats = {
    submitted: 0,
    reconnects: 0,
    duplicateAttempts: 0,
    neverSubmitted: 0,
  };

  constructor(
    private readonly hostUrl: string,
    private readonly config: FakePlayerConfig,
  ) {
    this.client = new SocketClient(hostUrl, 'player');
    this.client.onMessage((message) => this.handleMessage(message));
  }

  get name(): string {
    return this.config.name;
  }

  statsSnapshot(): FakePlayerStats {
    return { ...this.stats };
  }

  async join(): Promise<void> {
    await this.client.open();
    const accepted = this.client.waitForAny(['join_accepted', 'join_rejected'], 5_000);
    this.client.send({ type: 'join', name: this.config.name });
    const result = await accepted;
    if (result.type === 'join_rejected') {
      throw new Error(`${this.config.name} was rejected joining: ${result.message}`);
    }
    this.publicId = result.self.id;
    this.role = result.self.role;
    this.token = result.playerToken;
    this.config.logger.detail(`${this.config.name} joined as ${this.role}`);
  }

  async disconnectForTest(): Promise<void> {
    this.client.close();
  }

  private async reconnect(): Promise<void> {
    this.client.close();
    await delay(50);
    await this.client.open(this.token ?? undefined);
    this.stats.reconnects += 1;
    this.config.logger.detail(`${this.config.name} reconnected`);
  }

  private handleMessage(message: ServerToClientMessage): void {
    if (message.type === 'submission_rejected') {
      if (this.submittedThisRound) {
        // Expected outcome of a deliberate duplicate-submission chaos test.
        this.config.logger.detail(`${this.config.name} duplicate correctly rejected (${message.code})`);
      } else {
        this.config.recordFailure(
          `${this.config.name}: primary submission unexpectedly rejected (${message.code}: ${message.message})`,
        );
      }
      return;
    }
    if (message.type !== 'view' || !message.player) return;

    const roundKey = `${message.engine.gameId ?? 'none'}:${message.engine.roundNumber}`;
    if (roundKey !== this.currentRoundKey) {
      this.currentRoundKey = roundKey;
      this.submittedThisRound = false;
    }

    if (this.submittedThisRound) return;

    const totalPlayers = this.config.totalPlayers;
    const skipIndex = this.config.chaos ? pickIndex(deriveRng(this.config.seed, roundKey, 'skip'), totalPlayers) : -1;
    if (this.config.chaos && this.config.index === skipIndex) {
      this.stats.neverSubmitted += 1;
      return; // Deliberately never answers this round.
    }

    const rng = deriveRng(this.config.seed, roundKey, this.config.index, 'action');
    const action = decideAction(message.player, { rng, playerIndex: this.config.index });
    if (!action) return;

    // Marked immediately: further `view` pushes arrive before our delayed
    // send resolves (other players submitting triggers its own broadcast),
    // and must not schedule a second, duplicate action for this round.
    this.submittedThisRound = true;

    const delayRng = deriveRng(this.config.seed, roundKey, this.config.index, 'delay');
    const spread = this.config.chaos ? CHAOS_SPREAD_MS : CALM_SPREAD_MS;
    const extra = this.config.chaos && this.config.wantsSpecial ? CHAOS_JUDY_EXTRA_MS : 0;
    const delayMs = Math.floor(delayRng() * spread) + extra;

    const reconnectIndex = this.config.chaos
      ? pickIndex(deriveRng(this.config.seed, roundKey, 'reconnect'), totalPlayers)
      : -1;
    const duplicateIndex = this.config.chaos
      ? pickIndex(deriveRng(this.config.seed, roundKey, 'duplicate'), totalPlayers)
      : -1;

    const wantsReconnect = this.config.chaos && this.config.index === reconnectIndex;
    const wantsDuplicate = this.config.chaos && this.config.index === duplicateIndex;

    void this.act(action, delayMs, wantsReconnect, wantsDuplicate);
  }

  private async act(
    action: ReturnType<typeof decideAction>,
    delayMs: number,
    wantsReconnect: boolean,
    wantsDuplicate: boolean,
  ): Promise<void> {
    if (!action) return;
    try {
      if (wantsReconnect) {
        await delay(Math.max(0, Math.floor(delayMs / 2)));
        await this.reconnect();
      }
      await delay(wantsReconnect ? Math.ceil(delayMs / 2) : delayMs);

      this.send(action);
      this.stats.submitted += 1;
      this.config.logger.detail(`${this.config.name} submitted`);

      if (wantsDuplicate) {
        await delay(250);
        this.stats.duplicateAttempts += 1;
        this.send(action);
        this.config.logger.detail(`${this.config.name} deliberately re-sent the same submission`);
      }
    } catch (error) {
      this.config.recordFailure(
        `${this.config.name}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private send(action: NonNullable<ReturnType<typeof decideAction>>): void {
    if (action.type === 'submit') {
      this.client.send({ type: 'submit', value: action.value });
    } else {
      this.client.send({ type: 'special_pick', targetPlayerId: action.targetPlayerId });
    }
  }

  close(): void {
    this.client.close();
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
