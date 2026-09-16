---
description: "Use when writing or editing party pack content: content/<pack>/party.json, adding rounds/games, or referencing images in assets/."
applyTo: "content/**/*.json"
---

# Writing party pack content

Content is data, not code — adding rounds, games, or a whole new pack never requires
a server/client change. Prefer editing/extending `party.json` over touching
`server/src/games/` for anything that's just new prompts, images, or options; only
reach for [games-and-scoring.instructions.md](games-and-scoring.instructions.md) if
the mechanic itself (input type, judging flow) doesn't exist yet.

## Universal rules

- **Zero-based indexing everywhere.** `judyAnswer: 0` / `correctOptionIndex: 0` means
  the *first* option in `options`. This is enforced by the parser, not just a
  convention — an out-of-range index fails startup with the valid range and the label
  index 0 resolves to.
- **2–8 options** for most game types (`multiple-choice`, `would-approve`); **3–6**
  for `what-would-judy-do`. Duplicate option labels (case-insensitive) fail startup.
- **`image` paths** are relative to `assets/`, e.g. `"placeholder/room-01.svg"` →
  served at `/assets/placeholder/room-01.svg`. No leading `/`, no `..`. A missing file
  is a **warning**, not a fatal error — the party still starts, but fix it before the
  real event.
- Every round needs a non-empty `prompt`.
- Malformed JSON, an unknown game `type`, a bad index, too few options, or a
  forbidden field (see below) **stops startup entirely**, with a message naming the
  exact file/game/round — validate locally before committing rather than relying on
  a party-night failure.

## Fields that must NOT appear in content (rejected at startup)

These are entered live by the special player specifically so they aren't readable by
anyone who opens the JSON file:

| Game `type` | Forbidden field(s) | Why |
|---|---|---|
| `what-would-judy-do` | `judyAnswer` | Hers is entered live; supplying it is rejected |
| `rotten-tomatoes` | `judyScore`, `score` | Her score would be visible in the file |
| `caption-this`, `quiplash`, `draw-this` | `winner`, `judyPick` | She judges live, never scripted |

`would-approve` is the one predict-the-special-player type where `judyAnswer` **is**
required (used only as a fallback if she never answers live).

## Per-type cheat sheet

**`multiple-choice`** — plain trivia, answer known in advance:
```jsonc
{ "prompt": "...", "options": ["3", "4", "5", "22"], "correctOptionIndex": 1 }
```
`correctOptionIndex` may be omitted/`null` for an opinion question that still scores
nothing automatically.

**`would-approve`** — everyone predicts her answer; she also answers live:
```jsonc
{
  "prompt": "Would Judy approve of this room?",
  "image": "placeholder/room-01.svg",
  "options": ["LOVE", "MAYBE", "NO", "THIS OFFENDS ME"],
  "judyAnswer": 1,
  "judyComment": "Why would anyone put that there?"
}
```

**`what-would-judy-do`** — same mechanic, scenario-based, no fallback answer:
```jsonc
{ "prompt": "Judy has three free hours in Paris. What does she do?",
  "options": ["Go shopping", "Find a museum", "Find a restaurant", "Walk around"] }
```

**`rotten-tomatoes`** — numeric 0–100 guess vs. her live score:
```jsonc
{ "prompt": "How would Judy rate this room?", "image": "placeholder/room-01.svg",
  "meta": "Listed at a price nobody should pay" }
```
`meta` is an optional aside shown on the TV (e.g. a year, a price, a director) — plain
string, no markup.

**`caption-this` / `quiplash`** — anonymous free text, she judges live:
```jsonc
{ "prompt": "Judy when she sees a kitchen island that is 15cm too short.",
  "image": "judy-photo-01.jpg" }
```
Entries are capped at 140 characters at submission time — keep prompts short enough
to leave room for a witty answer within that budget. Quiplash is the same mechanic
without an image, themed as a punchline prompt.

**`draw-this`** — same judged-live pattern, a drawing instead of text:
```jsonc
{ "prompt": "Design Judy's dream living room if it were inside Hogwarts." }
```

## Scoring block

Each game's `scoring` object overrides `DEFAULT_SCORING` per-key; omit any key you
don't need to change. Common keys: `correctAnswer`, `predictSpecial`, `specialPick`,
`manualStep` (host +/- award step). `rotten-tomatoes` instead uses tolerance bands:
```jsonc
"scoring": { "exact": 500, "within5": 400, "within10": 300, "within20": 150, "otherwise": 0 }
```
Bands are matched nearest-first; write them the way a host would describe them
("within 5 points"), not as raw thresholds.

## Adding a new pack vs. new rounds in an existing pack

- New rounds/games in an existing theme: edit `content/<pack>/party.json` directly.
- A whole new pack: create `content/<new-pack-id>/party.json` with `id`, `name`,
  `specialPlayer.name`, and a `games` array — select it at runtime with
  `JUDYBOX_PACK=<new-pack-id>`. Put any new images under `assets/`, not inside the
  pack folder.
