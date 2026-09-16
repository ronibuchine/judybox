---
description: "Use when adding a new game mechanic (GameDefinition) under server/src/games/, changing party.json parsing/validation, or adding a scoring strategy."
applyTo: "server/src/games/**,server/src/scoring/**"
---

# Games and scoring

## Before writing a new `GameDefinition`

Check whether an existing mechanic already fits with different content — this
codebase reuses mechanics aggressively instead of duplicating them:

| Mechanic class | Implementation | Reused as |
|---|---|---|
| Predict the special player's choice | `server/src/games/predictSpecial.ts` (`PredictSpecialGame`) | `WOULD_APPROVE_TYPE` ("Would Judy Approve?") and `WHAT_WOULD_JUDY_DO_TYPE` ("What Would Judy Do?") — same class, only content shape differs (the latter requires no `judyAnswer`, entered live instead) |
| Free-text submission judged live by the special player | `server/src/games/captionThis.ts` (`CaptionThisGame`) | `CAPTION_THIS_TYPE` and `QUIPLASH_TYPE` — literally the same class registered under two `type` strings in `registry.ts` |
| Numeric guess vs. a live special-player score | `server/src/games/rottenTomatoes.ts` (`RottenTomatoesGame`) | one type today, but the distance-band scoring is generic — a new "guess the score" game should reuse `RottenTomatoesGame` or the `awardByDistance` strategy rather than reimplement banding |
| Drawing submission judged live | `server/src/games/drawThis.ts` (`DrawThisGame`) | shares the judge-a-locked-gallery pattern with `CaptionThisGame` (`GameEngine.setSpecialPick`), but strokes instead of text |
| Plain multiple choice, correct answer known in advance | `server/src/games/multipleChoice.ts` (`MultipleChoiceGame`) | the one mechanic where the answer is content, not something the special player enters live |

Only add a new file under `server/src/games/` when the mechanic is genuinely new
(a new kind of input, a new judging flow, or new phases) — a new theme/prompt set is
always a content change (`content/<pack>/party.json`), never a code change. When a new
`GameDefinition` or scoring strategy genuinely is warranted, say so explicitly and
explain which existing mechanic/strategy was considered and why it doesn't fit —
don't add new code paths silently.

## Wiring a new `GameDefinition` in

1. Implement the interface from `server/src/engine/types.ts`: `expectedSubmitters`,
   `validateSubmission`, `displayView`, `playerView`, `scoreRound`, plus `id`/`name`/
   `phases`/`roundCount`. Keep it pure w.r.t. engine state — it only ever sees the
   `RoundContext` it's given (never sockets, session, or global navigation).
2. Export a `<NAME>_TYPE` string constant from the new file (see `CAPTION_THIS_TYPE`,
   `WOULD_APPROVE_TYPE`, etc.) — this is the `type` value packs use in `party.json`.
3. Add the constant to `KNOWN_GAME_TYPES` in `server/src/games/registry.ts`.
4. Add a `case` in `buildGame()` in the same file that constructs the class from
   parsed rounds.
5. Add a `parse<X>Round()` function (in `registry.ts`, alongside the existing
   `parseWouldApproveRound`/`parseRatingRound`/etc.) that validates the JSON shape and
   **fails at startup** (`fail(...)`, throws `GameContentError`) on anything malformed
   — never fail silently or at runtime once the party has started.
6. If the special player enters something live rather than it being in content (an
   answer, a score, a picked winner), the content parser must **reject** that field if
   present in JSON (see how `parseRatingRound` rejects `judyScore`/`score`, and
   `parseCaptionRound` rejects `winner`/`judyPick`) — a value in the pack file would be
   readable by anyone who opens it before the party.

## Content validation conventions (`registry.ts`)

- Indexing is zero-based everywhere; `parseOptions` turns each option string into
  `{ id: String(index), label }`.
- Validation failures throw `GameContentError` via the local `fail()` helper, with a
  message naming the exact file/game/round location (`where` parameter threaded
  through every parse function) — never a bare "invalid" message.
- Missing image files are a **warning** (`context.warnings.push(...)`), not a fatal
  error — startup still succeeds. Only structural/data errors (bad type, out-of-range
  index, wrong option count, forbidden field) should be fatal.
- `resolveImage` also guards against path traversal (`..`) and absolute paths — keep
  that check if you add another file-reference field.

## Scoring (`server/src/scoring/`)

- `Scoreboard` (`scoreboard.ts`) does pure accounting and knows nothing about
  gameplay — never add game-specific logic there.
- Games return `ScoringEvent[]` from `scoreRound()`; the engine applies them as one
  named batch per round (`gameId:roundIndex`) via `scoreboard.apply()`. A batch can
  only be applied once (`apply` returns `false` if already scored) and can be reverted
  (`revert`/`revertMatching`) — this is what makes "Restart round"/"Restart game" safe.
  Never call scoring logic directly from a game class; always return events and let
  the engine apply them.
- Reusable strategies live in `strategies.ts`: `awardCorrectAnswer`,
  `awardClosestNumeric` (competitive, tie-aware), `awardByDistance` (absolute,
  tolerance-banded — see `DistanceScoring`/`DistanceBand`), `awardPredictedSpecial`,
  `awardChosenWinner`, `manualAward` (host discretionary, can be negative). Prefer
  reusing one of these over writing new scoring math inside a `GameDefinition`.
- Point values come from the `scoring` block in party JSON, falling back to
  `DEFAULT_SCORING` / `DEFAULT_DISTANCE_SCORING` for anything omitted — a new scoring
  knob needs a field on `ScoringConfig` plus a documented default, not a hardcoded
  number in the game class.
