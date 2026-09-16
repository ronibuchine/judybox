import { describe, expect, it } from 'vitest';
import { loadPartyPack, parsePartyPack, PartyPackError } from '../server/src/content';

describe('loadPartyPack', () => {
  it('loads the real judy-30 pack from disk', () => {
    const pack = loadPartyPack('judy-30');
    expect(pack.id).toBe('judy-30');
    expect(pack.specialPlayerName).toBe('Judy');
  });

  it('loads the demo pack', () => {
    expect(loadPartyPack('demo').specialPlayerName).toBe('Star');
  });

  it('finds every image referenced by the shipped packs', () => {
    expect(loadPartyPack('judy-30').warnings).toEqual([]);
    expect(loadPartyPack('demo').warnings).toEqual([]);
  });

  it('builds the two new games from the judy-30 pack', () => {
    const games = loadPartyPack('judy-30').games;
    expect(games.find((entry) => entry.id === 'what-would-judy-do')?.name).toBe('WWJD');
  });

  it('builds Caption This and Draw This from the judy-30 pack', () => {
    const games = loadPartyPack('judy-30').games;
    expect(games.find((entry) => entry.id === 'caption-this')?.name).toBe('Caption This');
  });

  it('builds Quiplash from the judy-30 pack', () => {
    const games = loadPartyPack('judy-30').games;
    const quiplash = games.find((entry) => entry.id === 'quiplash');
    expect(quiplash?.name).toBe('Quiplash');
  });

  it('reports a missing pack with an actionable message', () => {
    expect(() => loadPartyPack('does-not-exist')).toThrow(PartyPackError);
    expect(() => loadPartyPack('does-not-exist')).toThrow(/JUDYBOX_PACK/);
  });

  it('rejects a pack id that could escape the content directory', () => {
    expect(() => loadPartyPack('../../etc')).toThrow(PartyPackError);
  });
});

describe('parsePartyPack', () => {
  const source = 'party.json';

  it('accepts a minimal valid pack', () => {
    const pack = parsePartyPack(
      { id: 'x', name: 'X Party', specialPlayer: { name: 'Judy' } },
      'fallback',
      source,
    );
    expect(pack).toEqual({
      id: 'x',
      name: 'X Party',
      specialPlayerName: 'Judy',
      games: [],
      warnings: [],
    });
  });

  it('falls back to the directory name when id and name are absent', () => {
    const pack = parsePartyPack({ specialPlayer: { name: 'Judy' } }, 'fallback', source);
    expect(pack.id).toBe('fallback');
    expect(pack.name).toBe('fallback');
  });

  it.each([
    ['a non-object', 42],
    ['a missing specialPlayer', { id: 'x' }],
    ['a non-string special name', { specialPlayer: { name: 5 } }],
    ['an empty special name', { specialPlayer: { name: '   ' } }],
  ])('rejects %s', (_label, value) => {
    expect(() => parsePartyPack(value, 'fallback', source)).toThrow(PartyPackError);
  });
});
