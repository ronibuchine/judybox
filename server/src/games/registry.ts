import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ViewOption } from '@judybox/shared';
import type { GameDefinition } from '../engine/types.js';
import { CAPTION_THIS_TYPE, CaptionThisGame, type CaptionRound } from './captionThis.js';
import { DRAW_THIS_TYPE, DrawThisGame, type DrawRound } from './drawThis.js';
import { MULTIPLE_CHOICE_TYPE, MultipleChoiceGame, type MultipleChoiceRound } from './multipleChoice.js';
import {
  PredictSpecialGame,
  WHAT_WOULD_JUDY_DO_TYPE,
  WOULD_APPROVE_TYPE,
  type PredictSpecialRound,
} from './predictSpecial.js';
import { ROTTEN_TOMATOES_TYPE, RottenTomatoesGame, type RatingRound } from './rottenTomatoes.js';
import type { ScoringConfig } from '../scoring/strategies.js';

export const KNOWN_GAME_TYPES = [
  MULTIPLE_CHOICE_TYPE,
  WOULD_APPROVE_TYPE,
  WHAT_WOULD_JUDY_DO_TYPE,
  ROTTEN_TOMATOES_TYPE,
  CAPTION_THIS_TYPE,
  DRAW_THIS_TYPE,
] as const;

export class GameContentError extends Error {}

export interface ParseContext {
  /** Absolute path of the assets directory. */
  assetsRoot: string;
  /** Non-fatal problems, surfaced to the host rather than blocking startup. */
  warnings: string[];
}

/** How many options a game type will accept per round. */
export interface OptionLimits {
  min: number;
  max: number;
}

const DEFAULT_OPTION_LIMITS: OptionLimits = { min: 2, max: 8 };

function fail(message: string): never {
  throw new GameContentError(message);
}

/**
 * Options are plain strings in JSON; ids are their zero-based index as a string,
 * which is what `judyAnswer` indexes into.
 */
export function parseOptions(
  value: unknown,
  where: string,
  limits: OptionLimits = DEFAULT_OPTION_LIMITS,
): ViewOption[] {
  if (!Array.isArray(value) || value.length < limits.min) {
    fail(`${where} needs at least ${limits.min} options.`);
  }
  if (value.length > limits.max) {
    fail(`${where} has ${value.length} options; the most that fits is ${limits.max}.`);
  }

  const options = value.map((entry, index) => {
    if (typeof entry !== 'string' || entry.trim() === '') {
      fail(`${where} options[${index}] must be a non-empty string.`);
    }
    return { id: String(index), label: entry.trim() };
  });

  const labels = new Set(options.map((option) => option.label.toLowerCase()));
  if (labels.size !== options.length) fail(`${where} has duplicate option labels.`);

  return options;
}

/** Resolves an image reference to a served URL, warning when the file is absent. */
export function resolveImage(
  value: unknown,
  where: string,
  context: ParseContext,
): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string' || value.trim() === '') {
    fail(`${where} "image" must be a non-empty string when present.`);
  }

  const relative = value.trim().replace(/\\/g, '/');
  if (relative.startsWith('/') || relative.split('/').includes('..')) {
    fail(`${where} "image" must be a path inside assets/, without "..".`);
  }

  if (!existsSync(resolve(context.assetsRoot, relative))) {
    context.warnings.push(`${where}: image not found at assets/${relative}`);
  }
  return `/assets/${relative}`;
}

function parseComment(value: unknown, where: string): string | null {
  if (value !== undefined && value !== null && typeof value !== 'string') {
    fail(`${where} "judyComment" must be a string when present.`);
  }
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function parsePrompt(round: Record<string, unknown>, where: string): string {
  if (typeof round['prompt'] !== 'string' || round['prompt'].trim() === '') {
    fail(`${where} needs a non-empty "prompt".`);
  }
  return round['prompt'].trim();
}

function asObject(value: unknown, where: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null) fail(`${where} must be an object.`);
  return value as Record<string, unknown>;
}

/** Shared by both predict-the-special-player games; only the answer differs. */
function parsePredictSpecialRound(
  value: unknown,
  where: string,
  context: ParseContext,
  limits: OptionLimits,
  requireAnswer: boolean,
): PredictSpecialRound {
  const round = asObject(value, where);
  const prompt = parsePrompt(round, where);
  const options = parseOptions(round['options'], where, limits);
  const answer = round['judyAnswer'];

  let configuredAnswerId: string | null = null;
  if (answer === undefined || answer === null) {
    if (requireAnswer) fail(`${where} needs an integer "judyAnswer".`);
  } else {
    if (typeof answer !== 'number' || !Number.isInteger(answer)) {
      fail(`${where} needs an integer "judyAnswer".`);
    }
    if (answer < 0 || answer >= options.length) {
      fail(
        `${where} "judyAnswer" is ${answer}, but must be 0-${options.length - 1} (zero-based: 0 is "${options[0]?.label}").`,
      );
    }
    configuredAnswerId = String(answer);
  }

  return {
    prompt,
    imageUrl: resolveImage(round['image'], where, context),
    options,
    configuredAnswerId,
    comment: parseComment(round['judyComment'], where),
  };
}

export function parseWouldApproveRound(
  value: unknown,
  where: string,
  context: ParseContext,
): PredictSpecialRound {
  return parsePredictSpecialRound(value, where, context, DEFAULT_OPTION_LIMITS, true);
}

/** Her answer is entered live here, so `judyAnswer` is optional. */
export function parseWhatWouldJudyDoRound(
  value: unknown,
  where: string,
  context: ParseContext,
): PredictSpecialRound {
  return parsePredictSpecialRound(value, where, context, { min: 3, max: 6 }, false);
}

export function parseRatingRound(value: unknown, where: string, context: ParseContext): RatingRound {
  const round = asObject(value, where);
  const prompt = parsePrompt(round, where);

  const meta = round['meta'];
  if (meta !== undefined && meta !== null && typeof meta !== 'string') {
    fail(`${where} "meta" must be a string when present.`);
  }
  // A score in the pack would be visible to anyone who opens the file.
  if (round['judyScore'] !== undefined || round['score'] !== undefined) {
    fail(`${where} must not contain a score. The special player enters it live.`);
  }

  return {
    prompt,
    imageUrl: resolveImage(round['image'], where, context),
    meta: typeof meta === 'string' && meta.trim() !== '' ? meta.trim() : null,
  };
}

export function parseCaptionRound(value: unknown, where: string, context: ParseContext): CaptionRound {
  const round = asObject(value, where);
  const prompt = parsePrompt(round, where);

  // A pre-chosen winner would be visible to anyone who opens the file.
  if (round['winner'] !== undefined || round['judyPick'] !== undefined) {
    fail(`${where} must not contain a winner. The special player picks one live.`);
  }

  return { prompt, imageUrl: resolveImage(round['image'], where, context) };
}

export function parseDrawRound(value: unknown, where: string): DrawRound {
  const round = asObject(value, where);
  const prompt = parsePrompt(round, where);

  if (round['winner'] !== undefined || round['judyPick'] !== undefined) {
    fail(`${where} must not contain a winner. The special player picks one live.`);
  }

  return { prompt };
}

export function parseMultipleChoiceRound(value: unknown, where: string): MultipleChoiceRound {
  const round = asObject(value, where);
  const prompt = parsePrompt(round, where);
  const options = parseOptions(round['options'], where);
  const correct = round['correctOptionIndex'];

  if (correct === undefined || correct === null) {
    return { prompt, options, correctOptionId: null };
  }
  if (typeof correct !== 'number' || !Number.isInteger(correct)) {
    fail(`${where} "correctOptionIndex" must be an integer or null.`);
  }
  if (correct < 0 || correct >= options.length) {
    fail(
      `${where} "correctOptionIndex" is ${correct}, but must be 0-${options.length - 1} (zero-based).`,
    );
  }

  return { prompt, options, correctOptionId: String(correct) };
}

/** Builds a playable game from one entry of a pack's `games` array. */
export function buildGame(
  raw: unknown,
  where: string,
  scoring: ScoringConfig,
  context: ParseContext,
): GameDefinition {
  const game = asObject(raw, where);

  if (typeof game['id'] !== 'string' || game['id'] === '') {
    fail(`${where} needs a non-empty string "id".`);
  }
  if (typeof game['name'] !== 'string' || game['name'] === '') {
    fail(`${where} needs a non-empty string "name".`);
  }
  if (!Array.isArray(game['rounds']) || game['rounds'].length === 0) {
    fail(`${where} needs at least one round.`);
  }

  const id = game['id'];
  const name = game['name'];
  const rounds = game['rounds'];

  switch (game['type']) {
    case MULTIPLE_CHOICE_TYPE:
      return new MultipleChoiceGame({
        id,
        name,
        scoring,
        rounds: rounds.map((round, index) =>
          parseMultipleChoiceRound(round, `${where} rounds[${index}]`),
        ),
      });

    case WOULD_APPROVE_TYPE:
      return new PredictSpecialGame({
        id,
        name,
        scoring,
        rounds: rounds.map((round, index) =>
          parseWouldApproveRound(round, `${where} rounds[${index}]`, context),
        ),
      });

    case WHAT_WOULD_JUDY_DO_TYPE:
      return new PredictSpecialGame({
        id,
        name,
        scoring,
        rounds: rounds.map((round, index) =>
          parseWhatWouldJudyDoRound(round, `${where} rounds[${index}]`, context),
        ),
      });

    case ROTTEN_TOMATOES_TYPE:
      return new RottenTomatoesGame({
        id,
        name,
        scoring,
        rounds: rounds.map((round, index) =>
          parseRatingRound(round, `${where} rounds[${index}]`, context),
        ),
      });

    case CAPTION_THIS_TYPE:
      return new CaptionThisGame({
        id,
        name,
        scoring,
        rounds: rounds.map((round, index) =>
          parseCaptionRound(round, `${where} rounds[${index}]`, context),
        ),
      });

    case DRAW_THIS_TYPE:
      return new DrawThisGame({
        id,
        name,
        scoring,
        rounds: rounds.map((round, index) => parseDrawRound(round, `${where} rounds[${index}]`)),
      });

    default:
      return fail(
        `${where} has unsupported type "${String(game['type'])}". ` +
          `Known types: ${KNOWN_GAME_TYPES.join(', ')}.`,
      );
  }
}
