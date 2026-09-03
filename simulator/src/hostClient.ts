import type { DisplayView, EngineSnapshot, HostAction } from '@judybox/shared';
import { SocketClient } from './socketClient.js';

/** Bounds how long the simulated host waits for a phase to change or for judging. */
const DEFAULT_ACTION_TIMEOUT_MS = 5_000;

/**
 * Drives the game exactly the way the real host UI does: by sending
 * `host_action` and waiting for the resulting broadcast. Progression is
 * never assumed or forced past what the server actually allows.
 */
export class HostClient {
  readonly client: SocketClient;
  latestSnapshot: EngineSnapshot | null = null;
  latestDisplay: DisplayView | null = null;
  specialPlayerName = '';

  constructor(hostUrl: string) {
    this.client = new SocketClient(hostUrl, 'host');
    this.client.onMessage((message) => {
      if (message.type === 'view') {
        this.latestSnapshot = message.engine;
        this.latestDisplay = message.display;
      }
    });
  }

  async connect(): Promise<void> {
    // Subscribe before sending hello: the first `view` broadcast can arrive
    // immediately after `welcome`, in either order on the wire.
    const firstView = this.client.waitForAny(['view'], 5_000);
    const welcome = await this.client.open();
    this.specialPlayerName = welcome.session.specialPlayerName;
    await firstView;
  }

  /** Sends one host action and waits for the phase it produces (or its rejection). */
  action(action: HostAction, options: { gameId?: string; timeoutMs?: number } = {}): Promise<EngineSnapshot> {
    const timeoutMs = options.timeoutMs ?? DEFAULT_ACTION_TIMEOUT_MS;
    const previousPhase = this.latestSnapshot?.phase ?? null;

    return new Promise((resolve, reject) => {
      let unsubscribe: () => void = () => {};
      const timer = setTimeout(() => {
        unsubscribe();
        reject(new Error(`host action ${action} timed out (stuck at phase ${previousPhase})`));
      }, timeoutMs);

      unsubscribe = this.client.onMessage((message) => {
        if (message.type === 'action_rejected' && message.action === action) {
          clearTimeout(timer);
          unsubscribe();
          reject(new Error(`host action ${action} rejected: ${message.message}`));
          return;
        }
        if (message.type === 'view' && message.engine.phase !== previousPhase) {
          clearTimeout(timer);
          unsubscribe();
          resolve(message.engine);
        }
      });

      this.client.send({ type: 'host_action', action, ...(options.gameId ? { gameId: options.gameId } : {}) });
    });
  }

  /**
   * Waits until `expectedCount` submissions land, or gives up after
   * `timeoutMs`. A real host does not wait forever either: this models the
   * bounded patience the party will actually have.
   */
  waitForSubmissions(
    expectedCount: number,
    timeoutMs: number,
  ): Promise<{ settled: boolean; submittedCount: number }> {
    return new Promise((resolve) => {
      if ((this.latestSnapshot?.submittedCount ?? 0) >= expectedCount) {
        resolve({ settled: true, submittedCount: this.latestSnapshot?.submittedCount ?? 0 });
        return;
      }
      let unsubscribe: () => void = () => {};
      const timer = setTimeout(() => {
        unsubscribe();
        resolve({ settled: false, submittedCount: this.latestSnapshot?.submittedCount ?? 0 });
      }, timeoutMs);
      unsubscribe = this.client.onMessage((message) => {
        if (message.type === 'view' && message.engine.submittedCount >= expectedCount) {
          clearTimeout(timer);
          unsubscribe();
          resolve({ settled: true, submittedCount: message.engine.submittedCount });
        }
      });
    });
  }

  /** True once the special player has picked (or immediately, for non-judge games). */
  waitForJudyPick(timeoutMs: number): Promise<boolean> {
    const decided = (view: DisplayView | null): boolean =>
      view === null || (view.kind !== 'caption_gallery' && view.kind !== 'drawing_gallery')
        ? true
        : !view.judyDeciding;

    return new Promise((resolve) => {
      if (decided(this.latestDisplay)) {
        resolve(true);
        return;
      }
      let unsubscribe: () => void = () => {};
      const timer = setTimeout(() => {
        unsubscribe();
        resolve(false);
      }, timeoutMs);
      unsubscribe = this.client.onMessage((message) => {
        if (message.type === 'view' && decided(message.display)) {
          clearTimeout(timer);
          unsubscribe();
          resolve(true);
        }
      });
    });
  }

  close(): void {
    this.client.close();
  }
}
