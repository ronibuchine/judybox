import { describe, expect, it } from 'vitest';
import { parseClientMessage, validatePlayerName, playerNameKey } from '../shared/src/index';

describe('parseClientMessage', () => {
  it('accepts a hello with a resumable identity', () => {
    const message = parseClientMessage(
      JSON.stringify({ type: 'hello', role: 'player', connectionId: 'abc', sessionId: 'sess' }),
    );
    expect(message).toEqual({
      type: 'hello',
      role: 'player',
      connectionId: 'abc',
      sessionId: 'sess',
    });
  });

  it('accepts a hello carrying a player token', () => {
    expect(
      parseClientMessage(JSON.stringify({ type: 'hello', role: 'player', playerToken: 'tok' })),
    ).toEqual({ type: 'hello', role: 'player', playerToken: 'tok' });
  });

  it('accepts a join', () => {
    expect(parseClientMessage(JSON.stringify({ type: 'join', name: 'Sarah' }))).toEqual({
      type: 'join',
      name: 'Sarah',
    });
  });

  it('accepts a hello with no prior identity', () => {
    expect(parseClientMessage(JSON.stringify({ type: 'hello', role: 'display' }))).toEqual({
      type: 'hello',
      role: 'display',
    });
  });

  it('accepts a pong', () => {
    expect(parseClientMessage(JSON.stringify({ type: 'pong' }))).toEqual({ type: 'pong' });
  });

  it.each([
    ['not json', 'definitely not json'],
    ['null', 'null'],
    ['unknown type', JSON.stringify({ type: 'launch_missiles' })],
    ['unknown role', JSON.stringify({ type: 'hello', role: 'admin' })],
    ['missing role', JSON.stringify({ type: 'hello' })],
    ['wrong id type', JSON.stringify({ type: 'hello', role: 'player', connectionId: 7 })],
    ['wrong token type', JSON.stringify({ type: 'hello', role: 'player', playerToken: 7 })],
    ['join without a name', JSON.stringify({ type: 'join' })],
    ['join with a non-string name', JSON.stringify({ type: 'join', name: 42 })],
  ])('rejects %s', (_label, raw) => {
    expect(parseClientMessage(raw)).toBeNull();
  });
});

describe('player names', () => {
  it('trims and collapses whitespace', () => {
    expect(validatePlayerName('  Sa   rah ')).toEqual({ ok: true, name: 'Sa rah' });
  });

  it('treats case and spacing differences as the same person', () => {
    expect(playerNameKey(' JUDY ')).toBe(playerNameKey('judy'));
  });

  it('rejects blank, overlong and control-character names', () => {
    expect(validatePlayerName('   ').ok).toBe(false);
    expect(validatePlayerName('x'.repeat(21)).ok).toBe(false);
    expect(validatePlayerName('Sa\u0000rah').ok).toBe(false);
  });
});
