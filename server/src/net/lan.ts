import { networkInterfaces } from 'node:os';

export interface NetworkAddress {
  iface: string;
  address: string;
  family: 'IPv4' | 'IPv6';
  internal: boolean;
}

export interface LanCandidate extends NetworkAddress {
  score: number;
  reason: string;
}

/**
 * Windows laptops are full of adapters that look routable but are not reachable
 * from a phone: Hyper-V switches, WSL, VPN clients, VM bridges.
 */
const VIRTUAL_IFACE_PATTERNS: readonly RegExp[] = [
  /vethernet/i,
  /virtualbox/i,
  /vmware/i,
  /hyper-?v/i,
  /docker/i,
  /\bwsl\b/i,
  /tailscale/i,
  /zerotier/i,
  /hamachi/i,
  /\btap\b/i,
  /\btun\b/i,
  /loopback/i,
  /bluetooth/i,
  /npcap/i,
  /nordlynx/i,
  /wireguard/i,
  /openvpn/i,
];

const WIRELESS_IFACE_PATTERNS: readonly RegExp[] = [/wi-?fi/i, /wlan/i, /wireless/i, /\ben0\b/i];

function isPrivate192(address: string): boolean {
  return address.startsWith('192.168.');
}

function isPrivate10(address: string): boolean {
  return address.startsWith('10.');
}

function isPrivate172(address: string): boolean {
  const parts = address.split('.');
  if (parts[0] !== '172') return false;
  const second = Number(parts[1]);
  return Number.isInteger(second) && second >= 16 && second <= 31;
}

function isLinkLocal(address: string): boolean {
  return address.startsWith('169.254.');
}

function isCarrierGradeNat(address: string): boolean {
  const parts = address.split('.');
  if (parts[0] !== '100') return false;
  const second = Number(parts[1]);
  return Number.isInteger(second) && second >= 64 && second <= 127;
}

function matchesAny(iface: string, patterns: readonly RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(iface));
}

/**
 * Ranks an address by how likely a phone on the venue Wi-Fi can reach it.
 * Higher is better; negative scores are treated as unusable.
 */
export function scoreAddress(candidate: NetworkAddress): { score: number; reason: string } {
  if (candidate.internal) return { score: -100, reason: 'loopback' };
  if (candidate.family !== 'IPv4') return { score: -100, reason: 'not IPv4' };
  if (isLinkLocal(candidate.address)) return { score: -100, reason: 'link-local (no DHCP lease)' };

  let score = 0;
  const reasons: string[] = [];

  if (isPrivate192(candidate.address)) {
    score += 40;
    reasons.push('192.168.x home/venue range');
  } else if (isPrivate10(candidate.address)) {
    score += 30;
    reasons.push('10.x private range');
  } else if (isPrivate172(candidate.address)) {
    score += 20;
    reasons.push('172.16-31.x private range');
  } else if (isCarrierGradeNat(candidate.address)) {
    score += 5;
    reasons.push('carrier-grade NAT range');
  } else {
    score += 5;
    reasons.push('public address');
  }

  if (matchesAny(candidate.iface, VIRTUAL_IFACE_PATTERNS)) {
    score -= 60;
    reasons.push('virtual/VPN adapter');
  }

  if (matchesAny(candidate.iface, WIRELESS_IFACE_PATTERNS)) {
    score += 10;
    reasons.push('wireless adapter');
  }

  return { score, reason: reasons.join(', ') };
}

/** Ranks every address best-first. Exported for the host diagnostics output. */
export function rankAddresses(addresses: readonly NetworkAddress[]): LanCandidate[] {
  return addresses
    .map((address) => ({ ...address, ...scoreAddress(address) }))
    .sort((a, b) => b.score - a.score || a.address.localeCompare(b.address));
}

/** Reads the real adapters off this machine. */
export function readNetworkAddresses(): NetworkAddress[] {
  const result: NetworkAddress[] = [];
  for (const [iface, infos] of Object.entries(networkInterfaces())) {
    for (const info of infos ?? []) {
      if (info.family !== 'IPv4' && info.family !== 'IPv6') continue;
      result.push({ iface, address: info.address, family: info.family, internal: info.internal });
    }
  }
  return result;
}

export interface LanSelection {
  address: string;
  candidates: LanCandidate[];
  /** True when the address came from an explicit override rather than detection. */
  forced: boolean;
}

/**
 * Chooses the address to advertise. `override` wins unconditionally so a bad
 * guess is always recoverable on party day via JUDYBOX_HOST.
 */
export function selectLanAddress(
  addresses: readonly NetworkAddress[] = readNetworkAddresses(),
  override?: string,
): LanSelection {
  const candidates = rankAddresses(addresses);
  if (override) return { address: override, candidates, forced: true };

  const best = candidates[0];
  if (!best || best.score < 0) {
    // No usable adapter: fall back to loopback so the host UI still works.
    return { address: '127.0.0.1', candidates, forced: false };
  }
  return { address: best.address, candidates, forced: false };
}
