---
description: "Use when adding or styling a React component/screen in client/src, adding a new PlayerView/DisplayView renderer, or touching design tokens."
applyTo: "client/src/**"
---

# Client UI conventions

## Design tokens (`client/src/styles/tokens.css`)

Every colour, size, radius, shadow and duration used anywhere in the app must come
from a token defined here (`--c-*`, `--t-*`, `--tv-*`, `--s-*`, `--r-*`, `--shadow-*`,
`--dur-*`). Never hardcode a hex colour, px size, or ad hoc `rem` value in a component
stylesheet — add a token if the value you need doesn't exist yet. The `--tv-*` fluid
sizes exist specifically for TV-distance readability; use them (not `--t-*`) for
anything rendered on the `display` surface.

Stylesheets are split by concern, not by component:
`base.css` / `components.css` / `display.css` / `host.css` / `player.css`. Put a new
rule in the file matching which surface(s) it affects, not a new per-component file.

## Component conventions

- `client/src/components/ui/` holds the shared primitives (`Button`, `Panel`, `Badge`,
  `Media`, `Meter`, `Stage`, `Roster`, `Confetti`, `AnswerOption`, `Paged`,
  `WaitingState`, `QrJoinPanel`) exported via `index.ts`. Reuse one of these before
  writing new markup — e.g. `Button` is deliberately **the only button in the app**;
  hierarchy is expressed via its `variant` prop (`primary`/`secondary`/`ghost`/
  `danger`/`special`), not by a one-off styled element. A destructive action must use
  `variant="danger"`, never a custom style that merely looks dangerous.
- Only add a new primitive under `ui/` when none of the existing ones can be extended
  with a prop/variant to cover the new case — and explain that gap to the developer
  (e.g. "no existing primitive supports X, so...") rather than adding one silently.
- BEM-ish class naming via array-join-filter, e.g. `btn`, `btn--primary`,
  `btn--active` — follow this pattern for new primitives instead of CSS modules or
  inline styles.
- The three top-level surfaces are `screens/DisplayScreen.tsx`, `screens/HostScreen.tsx`,
  `screens/PlayerScreen.tsx`. All state and networking flows through the single hook
  `client/src/net/useJudyBox.ts` (`JudyBoxState`) — screens consume it, they don't open
  their own WebSocket or hold parallel copies of server state.

## Adding a renderer for a new `DisplayView`/`PlayerView` kind

Every `kind` in the `DisplayView`/`PlayerView` unions (`shared/src/index.ts`) needs a
corresponding render branch — check the `switch (view.kind)` in
`DisplayViewPanel.tsx` (display surface) and the `if (view.kind === ...)` chain in
`PlayerScreen.tsx` (player surface) and add a case/branch there. See
[wire-protocol.instructions.md](wire-protocol.instructions.md) for adding the `kind`
itself. A new kind with no renderer will silently fall through — verify both surfaces
are updated together, in the same change as the protocol addition.
