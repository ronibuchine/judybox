import { describe, expect, it, vi } from 'vitest';
import type { WebSocket } from 'ws';
import { ConnectionRegistry } from '../server/src/connections';

function fakeSocket(): WebSocket {
  return { readyState: 1, OPEN: 1, send: vi.fn() } as unknown as WebSocket;
}

describe('ConnectionRegistry', () => {
  it('issues a fresh id to a first-time device', () => {
    const registry = new ConnectionRegistry();
    const { connection, resumed } = registry.attach(fakeSocket(), 'player', undefined, undefined);

    expect(resumed).toBe(false);
    expect(connection.id).toMatch(/[0-9a-f-]{36}/);
    expect(registry.presence()).toEqual({ display: 0, host: 0, player: 1 });
  });

  it('restores the same id after a phone refresh', () => {
    const registry = new ConnectionRegistry();
    const first = registry.attach(fakeSocket(), 'player', undefined, undefined);
    registry.detach(first.connection.id);

    const second = registry.attach(fakeSocket(), 'player', first.connection.id, registry.sessionId);

    expect(second.resumed).toBe(true);
    expect(second.connection.id).toBe(first.connection.id);
    expect(registry.presence().player).toBe(1);
  });

  it('refuses to resume an id from a previous server run', () => {
    const registry = new ConnectionRegistry();
    const first = registry.attach(fakeSocket(), 'player', undefined, undefined);
    registry.detach(first.connection.id);

    const second = registry.attach(fakeSocket(), 'player', first.connection.id, 'stale-session-id');

    expect(second.resumed).toBe(false);
    expect(second.connection.id).not.toBe(first.connection.id);
  });

  it('refuses to hand an id to a second device while it is still live', () => {
    const registry = new ConnectionRegistry();
    const first = registry.attach(fakeSocket(), 'player', undefined, undefined);

    const impostor = registry.attach(fakeSocket(), 'player', first.connection.id, registry.sessionId);

    expect(impostor.resumed).toBe(false);
    expect(impostor.connection.id).not.toBe(first.connection.id);
    expect(registry.presence().player).toBe(2);
  });

  it('counts each surface separately', () => {
    const registry = new ConnectionRegistry();
    registry.attach(fakeSocket(), 'display', undefined, undefined);
    registry.attach(fakeSocket(), 'host', undefined, undefined);
    registry.attach(fakeSocket(), 'player', undefined, undefined);
    registry.attach(fakeSocket(), 'player', undefined, undefined);

    expect(registry.presence()).toEqual({ display: 1, host: 1, player: 2 });
  });

  it('drops a disconnected device from presence', () => {
    const registry = new ConnectionRegistry();
    const { connection } = registry.attach(fakeSocket(), 'player', undefined, undefined);
    registry.detach(connection.id);

    expect(registry.presence().player).toBe(0);
    expect(registry.get(connection.id)).toBeUndefined();
  });

  it('only sends to open sockets', () => {
    const registry = new ConnectionRegistry();
    const closed = { readyState: 3, OPEN: 1, send: vi.fn() } as unknown as WebSocket;
    const open = fakeSocket();
    registry.attach(closed, 'player', undefined, undefined);
    registry.attach(open, 'player', undefined, undefined);

    registry.broadcast({ type: 'ping' });

    expect(open.send).toHaveBeenCalledTimes(1);
    expect(closed.send).not.toHaveBeenCalled();
  });
});
