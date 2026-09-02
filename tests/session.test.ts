import { describe, expect, it } from 'vitest';
import { Session } from '../server/src/session';

const NO_CONNECTIONS = { display: 0, host: 0, player: 0 };

function newSession(): Session {
  return new Session('Judy');
}

describe('Session join', () => {
  it('adds a normal player', () => {
    const session = newSession();
    const result = session.join('Sarah', 'conn-1');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.player.name).toBe('Sarah');
    expect(result.player.role).toBe('PLAYER');
    expect(result.player.connected).toBe(true);
    expect(result.token).toBeTruthy();
  });

  it('normalises surrounding and repeated whitespace', () => {
    const session = newSession();
    const result = session.join('  Da  vid  ', 'conn-1');
    expect(result.ok && result.player.name).toBe('Da vid');
  });

  it.each([
    ['empty', '   ', 'name_empty'],
    ['too long', 'x'.repeat(21), 'name_too_long'],
    ['control characters', 'Sa\u0000rah', 'name_invalid'],
  ])('rejects %s names', (_label, name, code) => {
    const session = newSession();
    const result = session.join(name, 'conn-1');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe(code);
  });

  it('rejects a device that tries to join twice', () => {
    const session = newSession();
    session.join('Sarah', 'conn-1');
    const second = session.join('Sarah2', 'conn-1');

    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.code).toBe('already_joined');
  });
});

describe('Session duplicate names', () => {
  it('rejects an exact duplicate', () => {
    const session = newSession();
    session.join('Sarah', 'conn-1');
    const second = session.join('Sarah', 'conn-2');

    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.code).toBe('name_taken');
    expect(second.message).toContain('Sarah');
  });

  it('rejects a duplicate that differs only by case or spacing', () => {
    const session = newSession();
    session.join('Sarah', 'conn-1');

    expect(session.join('sarah', 'conn-2').ok).toBe(false);
    expect(session.join('  SARAH ', 'conn-3').ok).toBe(false);
  });

  it('still holds the name while that player is offline', () => {
    const session = newSession();
    session.join('Sarah', 'conn-1');
    session.disconnect('conn-1');

    const second = session.join('Sarah', 'conn-2');
    expect(second.ok).toBe(false);
  });
});

describe('Session special player', () => {
  it('assigns the SPECIAL role to the configured name', () => {
    const session = newSession();
    const result = session.join('Judy', 'conn-1');

    expect(result.ok && result.player.role).toBe('SPECIAL');
    expect(session.snapshot(NO_CONNECTIONS).specialPlayerClaimed).toBe(true);
  });

  it('matches the special name case-insensitively', () => {
    const session = newSession();
    expect(session.join('judy', 'conn-1').ok && session.specialPlayer()?.role).toBe('SPECIAL');
  });

  it('lets only one device be the special player', () => {
    const session = newSession();
    session.join('Judy', 'conn-1');
    const second = session.join('Judy', 'conn-2');

    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.code).toBe('special_taken');
  });

  it('reports the special name before anyone claims it', () => {
    const snapshot = newSession().snapshot(NO_CONNECTIONS);
    expect(snapshot.specialPlayerName).toBe('Judy');
    expect(snapshot.specialPlayerClaimed).toBe(false);
  });

  it('treats normal players as PLAYER', () => {
    const session = newSession();
    expect(session.join('Michael', 'conn-1').ok && session.all()[0]?.role).toBe('PLAYER');
  });
});

describe('Session reconnect', () => {
  it('restores the same player from a token', () => {
    const session = newSession();
    const joined = session.join('Sarah', 'conn-1');
    if (!joined.ok) throw new Error('setup failed');

    session.disconnect('conn-1');
    expect(session.all()[0]?.connected).toBe(false);

    const resumed = session.resume(joined.token, 'conn-2');
    expect(resumed?.id).toBe(joined.player.id);
    expect(resumed?.connected).toBe(true);
    expect(session.all()).toHaveLength(1);
  });

  it('does not create a duplicate record on refresh', () => {
    const session = newSession();
    const joined = session.join('Sarah', 'conn-1');
    if (!joined.ok) throw new Error('setup failed');

    session.disconnect('conn-1');
    session.resume(joined.token, 'conn-2');
    session.disconnect('conn-2');
    session.resume(joined.token, 'conn-3');

    expect(session.all()).toHaveLength(1);
    expect(session.snapshot(NO_CONNECTIONS).players).toHaveLength(1);
  });

  it('ignores an unknown token', () => {
    expect(newSession().resume('not-a-real-token', 'conn-1')).toBeNull();
  });

  it('keeps the player online when a stale socket closes after they moved', () => {
    const session = newSession();
    const joined = session.join('Sarah', 'conn-1');
    if (!joined.ok) throw new Error('setup failed');

    session.resume(joined.token, 'conn-2');
    session.disconnect('conn-1'); // old socket closes late

    expect(session.all()[0]?.connected).toBe(true);
  });
});

describe('Session disconnect and counts', () => {
  it('keeps the player but marks them offline', () => {
    const session = newSession();
    session.join('Sarah', 'conn-1');

    const player = session.disconnect('conn-1');
    expect(player?.connected).toBe(false);
    expect(session.all()).toHaveLength(1);
    expect(session.connectedCount()).toBe(0);
  });

  it('counts only connected players', () => {
    const session = newSession();
    session.join('Sarah', 'conn-1');
    session.join('David', 'conn-2');
    session.join('Judy', 'conn-3');
    session.disconnect('conn-2');

    expect(session.all()).toHaveLength(3);
    expect(session.connectedCount()).toBe(2);
  });

  it('ignores a disconnect for an unknown connection', () => {
    expect(newSession().disconnect('nope')).toBeNull();
  });

  it('orders the roster by join time', () => {
    const session = newSession();
    session.join('First', 'conn-1');
    session.join('Second', 'conn-2');

    expect(session.snapshot(NO_CONNECTIONS).players.map((player) => player.name)).toEqual([
      'First',
      'Second',
    ]);
  });

  it('never leaks reconnect tokens in the snapshot', () => {
    const session = newSession();
    const joined = session.join('Sarah', 'conn-1');
    if (!joined.ok) throw new Error('setup failed');

    const serialised = JSON.stringify(session.snapshot(NO_CONNECTIONS));
    expect(serialised).not.toContain(joined.token);
  });
});

describe('Session isolation between server runs', () => {
  it('starts empty and issues a fresh session id', () => {
    const first = newSession();
    first.join('Sarah', 'conn-1');

    const second = newSession();
    expect(second.all()).toHaveLength(0);
    expect(second.id).not.toBe(first.id);
  });

  it('does not honour a token from a previous run', () => {
    const first = newSession();
    const joined = first.join('Sarah', 'conn-1');
    if (!joined.ok) throw new Error('setup failed');

    expect(newSession().resume(joined.token, 'conn-1')).toBeNull();
  });
});
