---
description: "Use when adding or changing anything in shared/src/index.ts: new EnginePhase, HostAction, DisplayView/PlayerView kind, message type, or other wire-protocol shape shared by server and client."
applyTo: "shared/src/**"
---

# Wire protocol conventions

`shared/src/index.ts` is the single file defining the protocol. Both `server` and
`client` import `@judybox/shared` from it, so a shape change here is a compile error
everywhere it's used until every consumer is updated — that's the intended guardrail,
not a bug to work around.

## Order of work for a protocol change

1. Add/change the type in `shared/src/index.ts` first.
2. Update `server/src/engine/` (types, engine, transitions) to produce it.
3. Update `client/src/` (the surface that renders it) to consume it.
4. Run `npm run typecheck` — it will point at every remaining consumer.

## Existing shape patterns to follow

- **Discriminated unions on `kind`**: `DisplayView` and `PlayerView` are tagged unions.
  A new game needs a new `kind` variant, not a reuse of an existing one with optional
  fields bolted on — see how `caption_gallery` and `drawing_gallery` are separate
  variants despite being visually similar. That said, prefer extending an existing
  `kind` (adding an optional field) over adding a new one when the rendering is
  genuinely the same shape — and if a new `kind`/type/constant is added, explain to
  the developer why extending an existing shape wasn't sufficient.
- **Zero leakage of hidden state**: never add a field to a display-facing view that
  reveals the special player's private answer/score before reveal (see how `question`
  only exposes `specialStatus.answered`, never the value).
- **Constants live next to what they bound**: e.g. `MAX_CAPTION_LENGTH`,
  `RATING_MIN`/`RATING_MAX`, `DRAWING_GRID`, `MAX_STROKES_PER_DRAWING`. Add new limits
  here, not hardcoded in `server/` or `client/`, so both sides enforce the same number.
- **`ENGINE_PHASES` and `HOST_ACTIONS`** are the canonical lifecycle lists. Adding a
  phase or action here is only half the change — see
  [transitions.instructions.md](transitions.instructions.md) for the other half
  (`server/src/engine/transitions.ts`), which is what actually makes it reachable.
- Helper functions like `normalizePlayerName`, `playerNameKey`, `validatePlayerName`
  are exported from shared specifically so server and client validate identically —
  don't duplicate this logic locally.

## Stale-test risk

Widening a `HOST_ACTIONS`-driven `from` list, or adding a new phase/action, can make
exact-match assertions like `toEqual([...])` over `availableActions` in
`tests/engine.test.ts` go stale silently (they'll just fail, not warn). Search
`tests/` for `toEqual` near `HostAction`/`availableActions` when doing this.
