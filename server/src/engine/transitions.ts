import type { EnginePhase, HostAction } from '@judybox/shared';
import { ENGINE_PHASES } from '@judybox/shared';

export interface TransitionContext {
  phase: EnginePhase;
  roundIndex: number;
  roundCount: number;
}

export interface TransitionRule {
  action: HostAction;
  /**
   * Phases this action may be taken from. Listing several predecessors is how a
   * game that skips a phase (e.g. no REVEAL) still reaches the next one.
   */
  from: readonly EnginePhase[];
  label: string;
  danger?: boolean;
  target: (context: TransitionContext) => EnginePhase;
}

const IN_GAME_PHASES: readonly EnginePhase[] = [
  'GAME_INTRO',
  'ROUND_INTRO',
  'PLAYER_INPUT',
  'SUBMISSIONS_LOCKED',
  'REVEAL',
  'RESULTS',
  'LEADERBOARD',
  'GAME_COMPLETE',
];

const ROUND_ACTIVE_PHASES: readonly EnginePhase[] = [
  'ROUND_INTRO',
  'PLAYER_INPUT',
  'SUBMISSIONS_LOCKED',
  'REVEAL',
  'RESULTS',
  'LEADERBOARD',
];

/** Every phase except the finale itself: the host can end the party from anywhere. */
const ANY_PHASE_BUT_FINALE: readonly EnginePhase[] = ENGINE_PHASES.filter(
  (phase) => phase !== 'PARTY_COMPLETE',
);

/** Whether another round exists after the current one. */
function hasNextRound({ roundIndex, roundCount }: TransitionContext): boolean {
  return roundIndex + 1 < roundCount;
}

/**
 * Every legal host-driven transition, in one place.
 *
 * Nothing advances on a timer: each entry needs an explicit host action.
 */
export const TRANSITION_RULES: readonly TransitionRule[] = [
  {
    action: 'OPEN_GAME_SELECT',
    from: ['LOBBY'],
    label: 'Choose a game',
    target: () => 'GAME_SELECT',
  },
  {
    action: 'START_GAME',
    from: ['GAME_SELECT'],
    label: 'Start game',
    target: () => 'GAME_INTRO',
  },
  {
    action: 'CONTINUE',
    from: ['GAME_INTRO'],
    label: 'Continue',
    target: () => 'ROUND_INTRO',
  },
  {
    action: 'OPEN_INPUT',
    from: ['ROUND_INTRO'],
    label: 'Open answering',
    target: () => 'PLAYER_INPUT',
  },
  {
    action: 'LOCK_SUBMISSIONS',
    from: ['PLAYER_INPUT'],
    label: 'Lock answers',
    target: () => 'SUBMISSIONS_LOCKED',
  },
  {
    action: 'REVEAL',
    from: ['SUBMISSIONS_LOCKED'],
    label: 'Reveal',
    target: () => 'REVEAL',
  },
  {
    action: 'SHOW_RESULTS',
    from: ['SUBMISSIONS_LOCKED', 'REVEAL'],
    label: 'Show results',
    target: () => 'RESULTS',
  },
  {
    action: 'SHOW_LEADERBOARD',
    from: ['RESULTS'],
    label: 'Show leaderboard',
    target: () => 'LEADERBOARD',
  },
  {
    action: 'NEXT_ROUND',
    from: ['RESULTS', 'LEADERBOARD'],
    label: 'Next round',
    target: (context) => (hasNextRound(context) ? 'ROUND_INTRO' : 'GAME_COMPLETE'),
  },
  {
    action: 'SKIP_ROUND',
    from: ['ROUND_INTRO', 'PLAYER_INPUT', 'SUBMISSIONS_LOCKED', 'REVEAL'],
    label: 'Skip round',
    danger: true,
    target: (context) => (hasNextRound(context) ? 'ROUND_INTRO' : 'GAME_COMPLETE'),
  },
  {
    action: 'RESTART_ROUND',
    from: ROUND_ACTIVE_PHASES,
    label: 'Restart round',
    danger: true,
    target: () => 'ROUND_INTRO',
  },
  {
    action: 'RESTART_GAME',
    from: IN_GAME_PHASES,
    label: 'Restart game',
    danger: true,
    target: () => 'GAME_INTRO',
  },
  {
    action: 'RETURN_TO_GAME_SELECT',
    from: [...IN_GAME_PHASES, 'PARTY_COMPLETE'],
    label: 'Back to game select',
    danger: true,
    target: () => 'GAME_SELECT',
  },
  {
    action: 'RETURN_TO_LOBBY',
    from: [...IN_GAME_PHASES, 'GAME_SELECT', 'PARTY_COMPLETE'],
    label: 'Return to lobby',
    danger: true,
    target: () => 'LOBBY',
  },
  {
    // Not `danger`: this is a deliberate, happy action, not a mistake to guard
    // against. The host UI gives it its own gold treatment instead.
    action: 'END_PARTY',
    from: ANY_PHASE_BUT_FINALE,
    label: 'End the party',
    target: () => 'PARTY_COMPLETE',
  },
];

export function findRule(action: HostAction): TransitionRule | undefined {
  return TRANSITION_RULES.find((rule) => rule.action === action);
}
