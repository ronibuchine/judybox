import { describe, expect, it } from 'vitest';
import { rankAddresses, scoreAddress, selectLanAddress, type NetworkAddress } from '../server/src/net/lan';

const wifi: NetworkAddress = {
  iface: 'Wi-Fi',
  address: '192.168.1.42',
  family: 'IPv4',
  internal: false,
};
const hyperV: NetworkAddress = {
  iface: 'vEthernet (Default Switch)',
  address: '172.20.16.1',
  family: 'IPv4',
  internal: false,
};
const wsl: NetworkAddress = {
  iface: 'vEthernet (WSL)',
  address: '172.28.0.1',
  family: 'IPv4',
  internal: false,
};
const loopback: NetworkAddress = {
  iface: 'Loopback Pseudo-Interface 1',
  address: '127.0.0.1',
  family: 'IPv4',
  internal: true,
};
const linkLocal: NetworkAddress = {
  iface: 'Ethernet 2',
  address: '169.254.10.5',
  family: 'IPv4',
  internal: false,
};
const ipv6: NetworkAddress = {
  iface: 'Wi-Fi',
  address: 'fe80::1',
  family: 'IPv6',
  internal: false,
};

describe('scoreAddress', () => {
  it('rejects loopback, link-local and IPv6', () => {
    expect(scoreAddress(loopback).score).toBeLessThan(0);
    expect(scoreAddress(linkLocal).score).toBeLessThan(0);
    expect(scoreAddress(ipv6).score).toBeLessThan(0);
  });

  it('ranks a real Wi-Fi adapter above a Hyper-V switch', () => {
    expect(scoreAddress(wifi).score).toBeGreaterThan(scoreAddress(hyperV).score);
  });
});

describe('selectLanAddress', () => {
  it('picks the Wi-Fi adapter on a typical Windows laptop', () => {
    const selection = selectLanAddress([loopback, hyperV, wsl, wifi, linkLocal, ipv6]);
    expect(selection.address).toBe('192.168.1.42');
    expect(selection.forced).toBe(false);
  });

  it('falls back to loopback when nothing is reachable', () => {
    expect(selectLanAddress([loopback, linkLocal]).address).toBe('127.0.0.1');
  });

  it('always honours an explicit override', () => {
    const selection = selectLanAddress([wifi], '10.0.0.9');
    expect(selection.address).toBe('10.0.0.9');
    expect(selection.forced).toBe(true);
  });

  it('reports every candidate for host diagnostics', () => {
    expect(rankAddresses([loopback, hyperV, wifi])).toHaveLength(3);
  });
});
