# JudyBox — Agent Instructions

A local-network party game platform (no internet, no accounts, no database).
Laptop runs the server, TV shows the game, phones are controllers.

## Core Principle: Reuse Before Creating

Across every part of this codebase (game mechanics, scoring strategies, UI components, wire-protocol shapes, engine state), the default is to **reuse or extend an existing piece rather than add a new one** — see how Quiplash reuses `CaptionThisGame` and `Button` is the only button in the app. If a task genuinely requires something new (a new `GameDefinition`, a new UI primitive, a new `DisplayView`/`PlayerView` kind, a new phase/action, a new scoring strategy), **explicitly tell the developer why the existing options don't fit** before creating it — don't create it silently.

## Architecture

- npm workspaces: `shared`, `server`, `client`, `simulator` (see [package.json](package.json)).
- `shared/` is the single source of truth for the wire protocol — types are consumed by both server and client. Add new message/view shapes there first.
- `server/src/engine/transitions.ts` is the one table of legal phase transitions. It drives both the host UI's available buttons and the server's validation — never implement transition logic only on one side.
- Progression is entirely host-driven; nothing advances on a timer.
- `server/src/games/` implements one `GameDefinition` per mechanic, registered in `registry.ts`. Reuse an existing mechanic for near-identical games instead of duplicating logic (e.g. Quiplash reuses `CaptionThisGame`).
- `server/src/scoring/` (`Scoreboard` + `ScoringEvent`) does all points accounting. Points are applied in named per-round batches (`gameId:roundIndex`), so double-scoring is structurally impossible and a batch can be reverted (restart round/game) without corrupting the rest of the leaderboard.
- `content/*/party.json` is data-driven game content — editable without touching code. Indexing is zero-based everywhere (e.g. `judyAnswer: 0` is the first option).
- `client/src/styles/` uses design tokens (`tokens.css`) split by concern (`base`/`components`/`display`/`player`/`host`) — no monolithic stylesheet.

## Build and Test

- `npm run typecheck` — `tsc` across `shared`/`server`/`client`/`simulator` + the tests project.
- `npm test` — `vitest run` (suite lives in `tests/`).
- `npm run dev` — server + client concurrently for local dev.
- `npm run build` — builds client then server.
- `npm run simulate -- --players 20 --include-judy` — the `--` separator before flags is **required**. Without it, npm swallows the flags as its own config and the simulator silently runs with wrong/default args (symptom: far fewer players join, and/or Judy doesn't join).

## Known Environment Friction Points

- **PowerShell execution policy**: new terminals in this workspace fail with `... is not digitally signed. You cannot run this script...` because of a restricted profile script. Prefix the first command in any new terminal with:
  `Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass -Force`
- **VPN shadows the LAN**: a Cisco AnyConnect adapter can share the same subnet as the real LAN adapter (e.g. `192.168.1.0/24`), breaking phone/QR join discovery in a way that looks like a server bug. If joining fails, check active network adapters for a VPN before debugging server/LAN code.
- **Manual QA requires explicit approval**: never start a manual QA / visual verification pass over the UI (checking screens, styling, flows) on your own initiative — ask the user first and wait for approval. Once approved, give the user a list of screens/states to check themselves rather than attaching many screenshots (session attachment slots are limited and will run out mid-pass).

## Conventions

- Zero-based indexing in all content JSON.
- New shared wire-protocol members (phases, actions, view kinds) go in `shared/src/index.ts` first, then are consumed by `server/src/engine/` and `client/src/`.
- When widening an always-available host action's `from` list, search for exact-match action-list assertions (`toEqual([...])`) in `tests/` — they can go stale silently.

## Deeper Conventions

These auto-attach when editing matching files, or on-demand when the task matches their description — see `.github/instructions/`:

- [wire-protocol.instructions.md](.github/instructions/wire-protocol.instructions.md) — changing `shared/src/index.ts` (phases, actions, view kinds, message shapes).
- [transitions-and-engine.instructions.md](.github/instructions/transitions-and-engine.instructions.md) — adding a host action/phase, or changing `server/src/engine/`.
- [games-and-scoring.instructions.md](.github/instructions/games-and-scoring.instructions.md) — adding a `GameDefinition`, editing `party.json` parsing, or scoring strategies.
- [client-ui.instructions.md](.github/instructions/client-ui.instructions.md) — React components, design tokens, and rendering a new view kind.
- [simulator.instructions.md](.github/instructions/simulator.instructions.md) — CLI flags, fake-player behaviour, chaos scenarios, and rehearsal-tool conventions in `simulator/`.
- [content-writing.instructions.md](.github/instructions/content-writing.instructions.md) — writing/editing rounds and games in `content/*/party.json`.
