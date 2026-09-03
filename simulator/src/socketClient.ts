import WebSocket from 'ws';
import {
  WS_PATH,
  type ClientToServerMessage,
  type ConnectionRole,
  type ServerToClientMessage,
} from '@judybox/shared';

export type MessageHandler = (message: ServerToClientMessage) => void;

/**
 * A single WebSocket connection speaking the real client/server protocol.
 * Used for fake player phones and for the simulated host driver alike, so
 * both exercise exactly the same wire format real devices use.
 */
export class SocketClient {
  private socket: WebSocket | null = null;
  private readonly handlers = new Set<MessageHandler>();
  private intentionalClose = false;
  connectionId: string | null = null;
  sessionId: string | null = null;
  /** Set when the socket drops without us asking it to. */
  closedUnexpectedly = false;

  constructor(
    private readonly url: string,
    private readonly role: ConnectionRole,
  ) {}

  onMessage(handler: MessageHandler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  /** Opens (or reopens, after a reconnect) the socket and completes the hello handshake. */
  async open(playerToken?: string): Promise<Extract<ServerToClientMessage, { type: 'welcome' }>> {
    this.intentionalClose = false;
    this.closedUnexpectedly = false;
    const socket = new WebSocket(this.url);
    this.socket = socket;

    await new Promise<void>((resolve, reject) => {
      socket.once('open', () => resolve());
      socket.once('error', reject);
    });

    socket.on('message', (data) => {
      let message: ServerToClientMessage;
      try {
        message = JSON.parse(data.toString()) as ServerToClientMessage;
      } catch {
        return;
      }
      if (message.type === 'ping') this.send({ type: 'pong' });
      for (const handler of this.handlers) handler(message);
    });

    socket.on('close', () => {
      if (!this.intentionalClose) this.closedUnexpectedly = true;
    });

    const welcomePromise = this.waitForAny(['welcome'], 5_000);
    this.send({
      type: 'hello',
      role: this.role,
      ...(this.connectionId ? { connectionId: this.connectionId } : {}),
      ...(this.sessionId ? { sessionId: this.sessionId } : {}),
      ...(playerToken ? { playerToken } : {}),
    });
    const welcome = (await welcomePromise) as Extract<ServerToClientMessage, { type: 'welcome' }>;
    this.connectionId = welcome.connectionId;
    this.sessionId = welcome.sessionId;
    return welcome;
  }

  send(message: ClientToServerMessage): void {
    if (!this.socket || this.socket.readyState !== this.socket.OPEN) return;
    this.socket.send(JSON.stringify(message));
  }

  close(): void {
    this.intentionalClose = true;
    this.socket?.close();
  }

  /** Resolves with the first message whose type is in `types`. */
  waitForAny<T extends ServerToClientMessage['type']>(
    types: readonly T[],
    timeoutMs: number,
  ): Promise<Extract<ServerToClientMessage, { type: T }>> {
    return new Promise((resolve, reject) => {
      let unsubscribe: () => void = () => {};
      const timer = setTimeout(() => {
        unsubscribe();
        reject(new Error(`timed out waiting for one of: ${types.join(', ')}`));
      }, timeoutMs);
      unsubscribe = this.onMessage((message) => {
        if (!(types as readonly string[]).includes(message.type)) return;
        clearTimeout(timer);
        unsubscribe();
        resolve(message as Extract<ServerToClientMessage, { type: T }>);
      });
    });
  }
}
