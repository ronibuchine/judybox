/** FNV-1a style string hash, used to turn arbitrary context keys into a seed. */
function hashString(input: string): number {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/** mulberry32: tiny, fast, good enough for bounded test chaos (not cryptographic). */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function next(): number {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Derives an independent, reproducible RNG for one decision point (e.g. "should
 * player 3 skip round 2 of caption-this?") from the run seed and a context key.
 * Decisions therefore do not depend on message arrival order or call sequence.
 */
export function deriveRng(seed: number, ...parts: (string | number)[]): () => number {
  return mulberry32(hashString(`${seed}:${parts.join(':')}`));
}

/** Picks a deterministic index in [0, count) from a derived RNG. */
export function pickIndex(rng: () => number, count: number): number {
  if (count <= 0) return -1;
  return Math.floor(rng() * count);
}
