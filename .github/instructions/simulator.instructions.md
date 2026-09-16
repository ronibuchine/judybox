---
description: "Use when adding simulator CLI flags, extending fake-player behaviour, adding chaos scenarios, or supporting a new PlayerView kind in simulator/src/."
applyTo: "simulator/src/**"
---

# Simulator conventions

`simulator/` is a rehearsal tool, not a mock: it drives a **real** running server over
the **real** WebSocket protocol (`FakePlayer`/`HostClient` send the same
`hello`/`join`/`submit`/`special_pick`/`host_action` messages a real phone or host UI
sends). Never bypass the engine, session, or scoring by talking to server internals
directly — a bug the simulator finds must be a bug a real phone would hit too.

## Reuse before adding new simulator logic

- **No game-specific branching.** `strategies.ts` (`decideAction`) dispatches purely
  on `PlayerView.kind` (`choose`/`rate`/`caption`/`draw`/`judge`), never on a game id.
  A new `GameDefinition` should work automatically as long as it reuses an existing
  `PlayerView` kind (see [games-and-scoring.instructions.md](../games-and-scoring.instructions.md)
  for when a new kind is actually justified). Only add a new function to
  `strategies.ts` when the protocol genuinely has a new `PlayerView.kind` — and when
  you do, explain why an existing strategy function couldn't be adapted.
- **Chaos decisions are pure functions of `--seed` + context, not shared mutable
  state or timing.** `rng.ts`'s `deriveRng(seed, ...parts)` hashes the seed with
  context keys (player index, game id, round) via `mulberry32` so a run is exactly
  reproducible regardless of real network jitter. Any new chaos behaviour (a new way
  to skip/duplicate/delay) must derive its randomness the same way — never
  `Math.random()` or a single shared RNG instance threaded through call order.
- **The special player's name is never hardcoded.** `HostClient` learns it from the
  real `welcome` message (`specialPlayerName`), the same way a real phone would — see
  `host.specialPlayerName` in `simulate.ts`. Don't assume `"Judy"` in new code.

## Adding a CLI flag (`cli.ts`)

1. Add the field to `SimulatorOptions` in `types.ts`.
2. Add parsing in `parseArgs()` (`RawArgs` + the `switch` in `parseArgs`) and
   validation/defaulting in `resolveOptions()` — invalid input should throw a message
   naming the flag and the bad value, the same way `--players`/`--seed` do.
3. Thread the option through `runSimulation()` in `simulate.ts` to wherever it's
   consumed (`FakePlayer`, `HostClient`, chaos timing constants).
4. Update the flag table and an example invocation in [README.md](../../../README.md)
   (`## Multiplayer simulator` section) — flags are documented there, not just in code.

## `HostClient` / progression

`HostClient.action()` sends one `host_action` and waits for the resulting `view`
broadcast (phase change) or an `action_rejected` — it never assumes a transition
succeeds. Follow this wait-for-broadcast pattern for any new host-driven step instead
of assuming success after sending.

## Timeouts and constants

Bounded-patience constants (`SUBMIT_SETTLE_TIMEOUT_MS`, `JUDY_PICK_TIMEOUT_MS` in
`simulate.ts`; `CALM_SPREAD_MS`/`CHAOS_SPREAD_MS`/`CHAOS_JUDY_EXTRA_MS` in
`fakePlayer.ts`) model realistic patience, not just "wait a while" — a real host also
gives up eventually. When adding a new wait, add a named constant near the others
rather than an inline magic number, and pick separate calm/chaos values if the
behaviour differs between modes.

## Failures vs. expected rejections

`recordFailure` (threaded from `simulate.ts` into every `FakePlayer`/`HostClient`)
is for *unexpected* problems only — a rejected primary submission, a stuck host
action, a player that never reached the expected state. Deliberate chaos rejections
(a duplicate-submit attempt that the server correctly rejects) are counted separately
(`duplicateAttempts`, not `failures`) — don't conflate "the server correctly said no"
with "something is broken".
