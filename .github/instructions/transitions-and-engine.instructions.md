---
description: "Use when adding a host action, engine phase, or otherwise changing progression rules in server/src/engine/transitions.ts or engine.ts."
applyTo: "server/src/engine/**"
---

# Phase machine and transitions

`server/src/engine/transitions.ts` is the **one table** of legal phase transitions
(`TRANSITION_RULES`). It drives both the buttons the host UI renders and the server's
validation of incoming `host_action` messages — never add a transition on only one
side (e.g. an ad hoc `if` in `engine.ts` that skips this table).

## Adding a new `HostAction` or `EnginePhase`

Before adding either, check whether an existing action/phase (or a new `from` entry on
an existing `TransitionRule`) already covers the case. If a new one is genuinely
needed, state explicitly why the existing lifecycle doesn't fit.

1. Add it to `HOST_ACTIONS` / `ENGINE_PHASES` in `shared/src/index.ts` first (see
   [wire-protocol.instructions.md](wire-protocol.instructions.md)).
2. Add a `TransitionRule` entry: `action`, `from` (which phases allow it — reuse the
   existing phase-group constants like `IN_GAME_PHASES`, `ROUND_ACTIVE_PHASES`,
   `ANY_PHASE_BUT_FINALE` where the new action logically belongs to one of them),
   `label` (exact host-button text), optional `danger: true` for anything destructive
   (gets a confirmation step in the host UI), and `target()` (may branch on
   `TransitionContext` the way `NEXT_ROUND`/`SKIP_ROUND` branch on `hasNextRound`).
3. Nothing advances on a timer — every rule fires only from an explicit host action.
   Don't add setTimeout-driven phase changes.

## `GameEngine` (`engine.ts`)

- Owns `phase`, `game`, `roundIndex`, `submissions`, `specialNote`, `specialPick`, and
  the session-wide `Scoreboard`. A `GameDefinition` never touches these directly — it
  only receives a read-only `RoundContext` and returns views/scoring events.
- `specialNote` and `specialPick` are each gated by their own phase list
  (`NOTE_EDITABLE_PHASES`, `PICK_EDITABLE_PHASES`) and are cleared per round, the same
  way `submissions` is. A new piece of round-scoped, special-player-entered state
  should follow this exact pattern: a phase-gated setter + clear-on-round-advance.
- `findRule(action)` is the single lookup used both to compute `availableActions` for
  the snapshot and to validate an incoming action — don't reimplement the phase check
  elsewhere.

## Test risk when widening `from` lists

Adding a phase to an existing action's `from` (e.g. making `RESTART_ROUND` available
earlier) widens `availableActions` for that phase. Search `tests/engine.test.ts` for
`toEqual([` assertions over `availableActions().map((a) => a.action)` — these are
exact-match arrays and go stale silently rather than failing loudly with a diff
explanation.
