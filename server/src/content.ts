import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validatePlayerName } from '@judybox/shared';
import type { GameDefinition } from './engine/types.js';
import { buildGame, GameContentError, type ParseContext } from './games/registry.js';
import {
  DEFAULT_SCORING,
  type DistanceBand,
  type DistanceScoring,
  type ScoringConfig,
} from './scoring/strategies.js';

export interface PartyPack {
  id: string;
  name: string;
  specialPlayerName: string;
  games: GameDefinition[];
  /** Non-fatal problems, e.g. a missing image. Shown to the host. */
  warnings: string[];
}

export const DEFAULT_PACK_ID = 'judy-30';

const here = dirname(fileURLToPath(import.meta.url));

/** Resolves to <repo>/content from either src (tsx) or dist (bundled). */
export const DEFAULT_CONTENT_ROOT = resolve(here, '../../content');
export const DEFAULT_ASSETS_ROOT = resolve(here, '../../assets');

/** Thrown for any bad pack so startup can print something a non-developer can act on. */
export class PartyPackError extends Error {}

export function loadPartyPack(
  packId: string = DEFAULT_PACK_ID,
  contentRoot: string = DEFAULT_CONTENT_ROOT,
  assetsRoot: string = DEFAULT_ASSETS_ROOT,
): PartyPack {
  if (!/^[a-z0-9-]+$/i.test(packId)) {
    throw new PartyPackError(`Invalid pack id "${packId}". Use letters, numbers and dashes.`);
  }

  const file = resolve(contentRoot, packId, 'party.json');

  let raw: string;
  try {
    raw = readFileSync(file, 'utf8');
  } catch {
    throw new PartyPackError(`No party pack at ${file}. Check JUDYBOX_PACK.`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : 'unknown parse error';
    throw new PartyPackError(`${file} is not valid JSON: ${detail}`);
  }

  return parsePartyPack(parsed, packId, file, assetsRoot);
}

export function parsePartyPack(
  value: unknown,
  fallbackId: string,
  source: string,
  assetsRoot: string = DEFAULT_ASSETS_ROOT,
): PartyPack {
  if (typeof value !== 'object' || value === null) {
    throw new PartyPackError(`${source} must contain a JSON object.`);
  }
  const pack = value as Record<string, unknown>;

  const special = pack['specialPlayer'];
  if (typeof special !== 'object' || special === null) {
    throw new PartyPackError(`${source} is missing "specialPlayer": { "name": "..." }.`);
  }

  const specialName = (special as Record<string, unknown>)['name'];
  if (typeof specialName !== 'string') {
    throw new PartyPackError(`${source} needs a string "specialPlayer.name".`);
  }

  const validated = validatePlayerName(specialName);
  if (!validated.ok) {
    throw new PartyPackError(`${source} has an unusable specialPlayer.name: ${validated.message}`);
  }

  const id = typeof pack['id'] === 'string' && pack['id'] ? pack['id'] : fallbackId;
  const name = typeof pack['name'] === 'string' && pack['name'] ? pack['name'] : id;

  const context: ParseContext = { assetsRoot, warnings: [] };
  const games = parseGames(pack['games'], source, context);

  return { id, name, specialPlayerName: validated.name, games, warnings: context.warnings };
}

function parseGames(value: unknown, source: string, context: ParseContext): GameDefinition[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    throw new PartyPackError(`${source} has a "games" field that is not an array.`);
  }

  return value.map((entry, index) => {
    const where = `${source} games[${index}]`;
    const scoring = parseScoring(
      typeof entry === 'object' && entry !== null
        ? (entry as Record<string, unknown>)['scoring']
        : undefined,
      where,
    );
    try {
      return buildGame(entry, where, scoring, context);
    } catch (cause) {
      // A game problem is a pack problem from the host's point of view.
      if (cause instanceof GameContentError) throw new PartyPackError(cause.message);
      throw cause;
    }
  });
}

/** Point values are optional; anything omitted falls back to the defaults. */
export function parseScoring(value: unknown, where: string): ScoringConfig {
  if (value === undefined) return { ...DEFAULT_SCORING };
  if (typeof value !== 'object' || value === null) {
    throw new PartyPackError(`${where} "scoring" must be an object.`);
  }
  const raw = value as Record<string, unknown>;

  const number = (key: keyof ScoringConfig, fallback: number): number => {
    const candidate = raw[key];
    if (candidate === undefined) return fallback;
    if (typeof candidate !== 'number' || !Number.isFinite(candidate)) {
      throw new PartyPackError(`${where} scoring.${key} must be a finite number.`);
    }
    return candidate;
  };

  let closestPlaces = [...DEFAULT_SCORING.closestPlaces];
  if (raw['closestPlaces'] !== undefined) {
    if (
      !Array.isArray(raw['closestPlaces']) ||
      raw['closestPlaces'].some((entry) => typeof entry !== 'number' || !Number.isFinite(entry))
    ) {
      throw new PartyPackError(`${where} scoring.closestPlaces must be an array of numbers.`);
    }
    closestPlaces = raw['closestPlaces'] as number[];
  }

  return {
    correctAnswer: number('correctAnswer', DEFAULT_SCORING.correctAnswer),
    closestPlaces,
    predictSpecial: number('predictSpecial', DEFAULT_SCORING.predictSpecial),
    specialPick: number('specialPick', DEFAULT_SCORING.specialPick),
    distance: parseDistanceScoring(raw, where),
    manualStep: number('manualStep', DEFAULT_SCORING.manualStep),
  };
}

/**
 * Reads tolerance bands written the way a host would write them:
 * `{ "exact": 500, "within5": 400, "within10": 300, "otherwise": 0 }`.
 * Omitting all of them keeps the defaults.
 */
export function parseDistanceScoring(
  raw: Record<string, unknown>,
  where: string,
): DistanceScoring {
  const bands: DistanceBand[] = [];
  let otherwise: number | undefined;

  const points = (key: string): number => {
    const candidate = raw[key];
    if (typeof candidate !== 'number' || !Number.isFinite(candidate)) {
      throw new PartyPackError(`${where} scoring.${key} must be a finite number.`);
    }
    return candidate;
  };

  for (const key of Object.keys(raw)) {
    if (key === 'exact') {
      bands.push({ within: 0, points: points(key) });
      continue;
    }
    if (key === 'otherwise') {
      otherwise = points(key);
      continue;
    }
    const match = /^within(\d+)$/.exec(key);
    if (match) bands.push({ within: Number(match[1]), points: points(key) });
  }

  if (bands.length === 0 && otherwise === undefined) {
    return {
      bands: DEFAULT_SCORING.distance.bands.map((band) => ({ ...band })),
      otherwise: DEFAULT_SCORING.distance.otherwise,
    };
  }

  bands.sort((a, b) => a.within - b.within);
  return { bands, otherwise: otherwise ?? 0 };
}
