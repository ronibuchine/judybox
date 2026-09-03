import type { PlayerView } from '@judybox/shared';
import { generateDrawing } from './drawing.js';

export type PlayerAction =
  | { type: 'submit'; value: string }
  | { type: 'special_pick'; targetPlayerId: string };

export interface DecisionContext {
  rng: () => number;
  playerIndex: number;
}

/** Answers a fixed-choice question: trivia, "Would Judy Approve?", "What Would Judy Do?". */
function multipleChoiceSimulator(
  view: Extract<PlayerView, { kind: 'choose' }>,
  ctx: DecisionContext,
): PlayerAction | null {
  if (view.locked || view.selectedOptionId !== null || view.options.length === 0) return null;
  const index = Math.floor(ctx.rng() * view.options.length);
  const option = view.options[index] ?? view.options[0];
  return option ? { type: 'submit', value: option.id } : null;
}

/** Answers a numeric slider question: Judy's Rotten Tomatoes. */
function numericSimulator(
  view: Extract<PlayerView, { kind: 'rate' }>,
  ctx: DecisionContext,
): PlayerAction | null {
  if (view.locked || view.submittedValue !== null) return null;
  const score = view.min + Math.floor(ctx.rng() * (view.max - view.min + 1));
  return { type: 'submit', value: String(score) };
}

/** Submits deterministic free text: Caption This. */
function textSimulator(
  view: Extract<PlayerView, { kind: 'caption' }>,
  ctx: DecisionContext,
): PlayerAction | null {
  if (view.submittedText !== null) return null;
  const caption = `Simulated caption ${String(ctx.playerIndex + 1).padStart(2, '0')}`;
  return { type: 'submit', value: caption.slice(0, view.maxLength) };
}

/** Submits a small deterministic stroke drawing: Draw This. */
function drawingSimulator(
  view: Extract<PlayerView, { kind: 'draw' }>,
  ctx: DecisionContext,
): PlayerAction | null {
  if (view.submitted) return null;
  return { type: 'submit', value: JSON.stringify(generateDrawing(ctx.playerIndex)) };
}

/** The special player judging everyone else's locked, anonymous submissions. */
function specialPlayerSimulator(
  view: Extract<PlayerView, { kind: 'judge' }>,
  ctx: DecisionContext,
): PlayerAction | null {
  if (view.pickedId !== null || view.entries.length === 0) return null;
  const index = Math.floor(ctx.rng() * view.entries.length);
  const entry = view.entries[index] ?? view.entries[0];
  return entry ? { type: 'special_pick', targetPlayerId: entry.id } : null;
}

/**
 * Dispatches on the view kind the server already sends real phones, rather
 * than on any particular game id. New games only need a new `PlayerView`
 * kind and a matching branch here, never a per-game switch elsewhere.
 */
export function decideAction(view: PlayerView, ctx: DecisionContext): PlayerAction | null {
  switch (view.kind) {
    case 'choose':
      return multipleChoiceSimulator(view, ctx);
    case 'rate':
      return numericSimulator(view, ctx);
    case 'caption':
      return textSimulator(view, ctx);
    case 'draw':
      return drawingSimulator(view, ctx);
    case 'judge':
      return specialPlayerSimulator(view, ctx);
    default:
      return null;
  }
}
