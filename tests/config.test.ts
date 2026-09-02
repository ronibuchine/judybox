import { describe, expect, it } from 'vitest';
import { loadConfig } from '../server/src/config';

describe('loadConfig', () => {
  it('defaults to port 3000 on all interfaces', () => {
    const config = loadConfig({});
    expect(config.port).toBe(3000);
    expect(config.bindHost).toBe('0.0.0.0');
    expect(config.hostOverride).toBeUndefined();
    expect(config.warnings).toEqual([]);
  });

  it('reads JUDYBOX_PORT', () => {
    expect(loadConfig({ JUDYBOX_PORT: '4000' }).port).toBe(4000);
  });

  it('falls back to PORT when JUDYBOX_PORT is absent', () => {
    expect(loadConfig({ PORT: '8080' }).port).toBe(8080);
  });

  it('prefers JUDYBOX_PORT over PORT', () => {
    expect(loadConfig({ JUDYBOX_PORT: '4000', PORT: '8080' }).port).toBe(4000);
  });

  it.each([['not-a-number'], ['0'], ['70000'], ['3000.5'], ['-1']])(
    'warns and falls back on invalid port %s',
    (value) => {
      const config = loadConfig({ JUDYBOX_PORT: value });
      expect(config.port).toBe(3000);
      expect(config.warnings.join(' ')).toContain('invalid port');
    },
  );

  it('warns that a privileged port may not bind', () => {
    const config = loadConfig({ JUDYBOX_PORT: '80' });
    expect(config.port).toBe(80);
    expect(config.warnings.join(' ')).toContain('privileged');
  });

  it('warns when bound to loopback, since phones would be excluded', () => {
    const config = loadConfig({ JUDYBOX_BIND: '127.0.0.1' });
    expect(config.bindHost).toBe('127.0.0.1');
    expect(config.warnings.join(' ')).toContain('phones cannot connect');
  });

  it('accepts a specific bind address without complaint', () => {
    const config = loadConfig({ JUDYBOX_BIND: '192.168.1.50' });
    expect(config.bindHost).toBe('192.168.1.50');
    expect(config.warnings).toEqual([]);
  });

  it('trims the advertised address override', () => {
    expect(loadConfig({ JUDYBOX_HOST: '  192.168.1.42  ' }).hostOverride).toBe('192.168.1.42');
  });

  it('treats blank values as unset', () => {
    const config = loadConfig({ JUDYBOX_HOST: '   ', JUDYBOX_PORT: '' });
    expect(config.hostOverride).toBeUndefined();
    expect(config.port).toBe(3000);
    expect(config.warnings).toEqual([]);
  });
});
