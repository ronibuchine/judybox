# JudyBox

A local-network party game platform. The laptop runs the server, the TV shows the
game, phones are the controllers. No internet, no accounts, no database.

**Current state: Milestones 1–6 plus the first real game.** The server boots and
advertises a LAN URL with a QR code, phones join a lobby with persistent identity
and a configurable special player, an authoritative state machine drives
host-controlled progression, one shared scoring engine keeps a session leaderboard,
and **Would Judy Approve?** is playable end to end.

## Layout

| Path       | Purpose                                                          |
| ---------- | ---------------------------------------------------------------- |
| `shared/`  | Wire protocol types shared by both sides. The single source of truth. |
| `server/`  | HTTP + WebSocket server. Owns all authoritative state.            |
| `server/src/engine/` | Phase machine, transition rules, game contract.         |
| `server/src/games/`  | Game mechanics, plus the content registry.              |
| `server/src/scoring/` | Scoreboard accounting and reusable award strategies.   |
| `client/`  | React app serving all three surfaces (player, TV, host).          |
| `content/` | Party packs as JSON. Editable without touching code.             |
| `assets/`  | Round images, served read-only at `/assets/...`.                  |
| `scripts/` | Test helpers, e.g. a scripted player.                             |
| `tests/`   | Vitest suites.                                                   |

## How progression works

Every legal transition lives in one table, [server/src/engine/transitions.ts](server/src/engine/transitions.ts).
That table produces both the buttons the host sees and the validation the server
applies, so the UI cannot offer an action the server would reject, and a crafted
WebSocket frame cannot perform one the UI hides.

Nothing advances on a timer. Every phase change requires an explicit host action.

Adding questions to an existing mechanic is a JSON edit. Adding a new mechanic
means implementing `GameDefinition` in `server/src/games/`.

## How scoring works

Games decide *who* earned points and why, by returning `ScoringEvent`s. The
`Scoreboard` does all accounting and knows nothing about gameplay.

Points are applied in named **batches**, one per round (`gameId:roundIndex`).
A batch applies exactly once, which makes double-scoring structurally impossible,
and can be reverted — so **Restart round** removes that round's points instead of
leaving phantom scores behind. **Restart game** reverts only that game's batches,
so a leaderboard spanning several games survives.

Available strategies live in [server/src/scoring/strategies.ts](server/src/scoring/strategies.ts):
correct answer, closest numeric guess (with tie handling), tolerance bands by
distance, predicting the special player, a chosen winner, and discretionary host
awards. Point values come from the `scoring` block in party JSON; anything omitted
falls back to defaults.

Scores are in memory only. Restarting the server clears them.

## Writing content

**Indexing is zero-based everywhere.** `judyAnswer: 0` means the *first* option.
An out-of-range value fails at startup with the valid range and the label that
index 0 resolves to, so an off-by-one is caught before the party rather than during it.

```jsonc
{
  "id": "would-judy-approve",
  "type": "would-approve",
  "name": "Would Judy Approve?",
  "scoring": { "predictSpecial": 100 },
  "rounds": [
    {
      "prompt": "Would Judy approve of this room?",
      "image": "placeholder/room-01.svg",   // path under assets/, optional
      "options": ["LOVE", "MAYBE", "NO", "THIS OFFENDS ME"],
      "judyAnswer": 1,                       // zero-based -> "MAYBE"
      "judyComment": "Why would anyone put that there?"
    }
  ]
}
```

Malformed JSON, an unknown game type, a bad index or fewer than two options all
**stop startup** with a message naming the exact file, game and round.

A **missing image is a warning, not a fatal error**: the party still starts, the
terminal lists the missing files, the host page shows them, and the TV renders a
dashed placeholder. One typo in a filename should never stop a party.

### Would Judy Approve?

Everyone answers, including Judy. Normal players are asked *"Which answer will
Judy choose?"*; Judy is asked *"What is YOUR answer?"* and her phone marks the
input as private. Until the host reveals, the TV shows only whether she has
answered — never which option. Her answer is excluded from the crowd tally and
from the results table, and she cannot score in her own game.

Her **live answer wins**. The `judyAnswer` in JSON is a fallback used only when she
has not answered — a dead phone or a late join still leaves a scoreable round.

She can also **write her own comment** for the round on her phone. The box is
labelled *"Your comment for the TV"* and explains where the text ends up, with a
character budget and an explicit Save. Anything she writes replaces the scripted
`judyComment` at the reveal; `judyComment` is the fallback for when she writes
nothing. She can keep editing until the host leaves the reveal, and the comment is
cleared with the round.

### What Would Judy Do?

The same mechanic as *Would Judy Approve?*, and the same code
([server/src/games/predictSpecial.ts](server/src/games/predictSpecial.ts)) — only the
content differs. Rounds are scenarios rather than images, take 3–6 options, and
carry **no `judyAnswer`**: hers is entered live or the round simply scores nothing.
Supplying `judyAnswer` in this type is rejected at startup.

```jsonc
{
  "id": "what-would-judy-do",
  "type": "what-would-judy-do",
  "name": "What Would Judy Do?",
  "scoring": { "predictSpecial": 100 },
  "rounds": [
    {
      "prompt": "Judy has three free hours in Paris. What does she do?",
      "options": ["Go shopping", "Find a museum", "Find a restaurant", "Walk around"]
    }
  ]
}
```

### Judy's Rotten Tomatoes

Everyone moves a 0–100 slider. Normal players guess the score Judy will give;
Judy enters her real score privately. **Her score is never in the pack** — a number
in the file would be readable by anyone who opened it, so `judyScore` and `score`
are rejected at startup.

Points fall off with distance, in **configurable tolerance bands**. Bands are
written the way a host would write them and are matched nearest-first; anything
outside them all gets `otherwise`. Omit the block entirely to keep the defaults.

```jsonc
{
  "id": "judys-rotten-tomatoes",
  "type": "rotten-tomatoes",
  "name": "Judy's Rotten Tomatoes",
  "scoring": {
    "exact": 500,      // distance 0
    "within5": 400,    // any `withinN` key works
    "within10": 300,
    "within20": 150,
    "otherwise": 0
  },
  "rounds": [
    {
      "prompt": "How would Judy rate this room?",
      "image": "placeholder/room-01.svg",
      "meta": "Listed at a price nobody should pay"  // optional aside on the TV
    }
  ]
}
```

Unlike the closest-guess strategy, this is **absolute rather than competitive**:
twenty people within 5 all get 400. With twenty phones in the room, ranking would
mean nineteen people getting nothing.

### Caption This, Quiplash, and Draw This

All three are the same mechanic in different content types: everyone but Judy submits
something anonymous, the host locks submissions, **Judy reads/watches them without
names attached and picks a winner on her own phone**, and the winner scores. This is
a different action from every other game so far — she is not answering a question,
she is judging other people's answers, after they are locked — so it is the one
piece of new engine surface in this pass: `GameEngine.setSpecialPick()`, a narrow
parallel to `setSpecialNote()` (same phase-gating pattern, same clear-per-round
behaviour). Everything else — submission handling, scoring, transitions, session,
reconnect — is unchanged.

**Caption This** and **Quiplash** ([server/src/games/captionThis.ts](server/src/games/captionThis.ts))
are the exact same `CaptionThisGame` class under two content `type`s
(`caption-this` and `quiplash`): free text, optionally with an image. Quiplash is
just a differently-themed pack of prompts — a punchline instead of an image
caption — so it needed no new code, only a second `type` registered against the
same class in [server/src/games/registry.ts](server/src/games/registry.ts).

```jsonc
{
  "id": "caption-this",
  "type": "caption-this",
  "name": "Caption This",
  "scoring": { "specialPick": 150 },
  "rounds": [
    {
      "prompt": "Judy when she sees a kitchen island that is 15cm too short.",
      "image": "judy-photo-01.jpg"
    }
  ]
}
```

```jsonc
{
  "id": "quiplash",
  "type": "quiplash",
  "name": "Quiplash",
  "scoring": { "specialPick": 150 },
  "rounds": [
    { "prompt": "Judy's ultimate tactic to convince Roni to finally buy a dishwasher" }
  ]
}
```

Entries are capped at `MAX_CAPTION_LENGTH` (140) characters, empty entries are
rejected, and a pack must not contain a pre-set `winner`/`judyPick` — she picks live.

**Draw This** ([server/src/games/drawThis.ts](server/src/games/drawThis.ts)): a
touch-friendly canvas — draw, two brush sizes, an eraser, clear, submit. Deliberately
not a drawing app.

```jsonc
{
  "id": "draw-this",
  "type": "draw-this",
  "name": "Draw This",
  "scoring": { "specialPick": 150 },
  "rounds": [{ "prompt": "Design Judy's dream living room if it were inside Hogwarts." }]
}
```

A drawing is a bounded list of strokes — up to `MAX_STROKES_PER_DRAWING` (40) strokes
of up to `MAX_POINTS_PER_STROKE` (100) points each, integer coordinates on a 0–1000
grid — sent as a JSON string inside the existing submit message, the same way
Rotten Tomatoes sends a number as a string. **No protocol change was needed for the
drawing data itself**; the caps exist so one phone cannot send an oversized payload
to the other ~19 in the room. Anything out of shape or over the caps is rejected
the same way an out-of-range rating is.

Three architectural decisions worth knowing:

1. **npm workspaces.** `@judybox/shared` is imported by both server and client, so
   protocol drift becomes a compile error instead of a party-night bug.
2. **One port in party mode.** Vite is a development convenience only. `npm run party`
   builds the client and the Node server serves it, so phones only ever talk to one
   origin — one URL, one QR, one failure mode.
3. **The server runs from TypeScript source** via `tsx`. No build step to forget on
   party day. Types are still enforced by `npm run typecheck`.

3. **The server ships as compiled JavaScript.** `esbuild` bundles it and the shared
   protocol into a single `server/dist/index.js` (~14 kB, builds in ~20 ms); runtime
   dependencies stay in `node_modules`. Development still runs TypeScript directly
   through `tsx`, so there is no rebuild step while editing.

## Commands

```bash
npm install        # once
npm run dev        # development: server on :3000, Vite UI on :5173
npm run party      # party mode: build the UI + server, serve everything on :3000
npm test           # unit and integration tests
npm run typecheck  # full type check across all workspaces and tests
npm run simulate -- --players 20   # 20 fake phones play a full session against a real server
./start-party.sh   # party mode, including first-run install
```

`npm start` rebuilds the server before launching, so it can never run a stale bundle.

Environment overrides:

- `JUDYBOX_PORT=3001` (or `PORT`) — use a different port. Default 3000.
- `JUDYBOX_HOST=192.168.1.42` — force the *advertised* address if detection guesses wrong.
- `JUDYBOX_BIND=192.168.1.42` (or `HOST`) — force the *bound* interface. Default `0.0.0.0`
  (all interfaces), which is what lets phones connect. Binding to loopback warns at startup.

## Multiplayer simulator (party-day rehearsal without real guests)

Recruiting the actual birthday guests to test the app would spoil the surprise, so
`simulator/` drives the **real** server over the **real** WebSocket protocol with
fake player phones — the same `hello`/`join`/`submit`/`special_pick` messages a real
phone sends, and the same host-driven `host_action` progression a real host UI sends.
Nothing bypasses the engine, the session roster, or scoring: a bug the simulator finds
is a bug real phones would hit too.

**1. Start the real server** (in one terminal):

```bash
npm run start          # or: npm run dev:server
```

**2. Run the simulator against it** (in another terminal):

```bash
npm run simulate -- --players 20
```

**3. A normal 20-player run**, including the special player (several games need her):

```bash
npm run simulate -- --players 20 --include-judy
```

**4. Chaos mode** — bounded, realistic disruption: staggered and near-deadline
answers, temporary disconnects, mid-round reconnects, a duplicate submission
attempt, and exactly one player who never answers a given round:

```bash
npm run simulate -- --players 20 --include-judy --chaos
```

**5. A reproducible chaos run**, for a scripted smoke test or to hand someone an
exact failure to debug — the same seed always makes the same players skip,
duplicate, and reconnect on the same rounds:

```bash
npm run simulate -- --players 20 --include-judy --chaos --seed 1234
```

Flags: `--players <n>` (default 6), `--host <url>` (default `http://127.0.0.1:3000`;
point this at a real LAN address to rehearse against the actual party network),
`--game <id>` (restrict to one game instead of the whole pack), `--chaos`,
`--verbose` (per-player join/submit/reconnect lines), `--seed <n>` (default 42).

**What the output means:**

```
21 players connected        # sockets opened and completed hello
21 players joined           # session.join() accepted the name (20 + Judy)
Game started: caption-this
Round 1: 20 submissions     # submittedCount reached (or timed out at) expectedCount
Round 1: revealed           # host issued REVEAL; Judy's judging window opens here
Round 1: scored             # host issued SHOW_RESULTS; scoring has been applied
...
Result:
  players: 21
  rounds: 15                # total rounds played across every game in the pack
  reconnects: 3              # deliberate mid-round disconnect/reconnect cycles (chaos only)
  duplicate attempts: 1      # deliberate resubmits, expected to be rejected (chaos only)
  failures: 0                # anything unexpected: rejected primary submission, a
                              # player that never reached the expected state, a stuck
                              # host action, an unreachable server, etc.
```

A non-zero `failures` count exits the process with code 1, so the simulator can run
in CI or a pre-party smoke-test script. This is a load/protocol/reconnect rehearsal
tool, not a substitute for testing with a few real phones — always do both before
the party.

Design notes, for anyone extending it:

- The simulator has no game-specific logic. It reads the same `PlayerView.kind`
  a real phone's UI switches on (`choose`, `rate`, `caption`, `draw`, `judge`) and
  dispatches to one small strategy per input type (`simulator/src/strategies.ts`).
  A new game only needs a new `PlayerView` kind for this to keep working.
- The special player is whichever name the pack's `session.specialPlayerName`
  reports (from the real `welcome` message), never a hardcoded "Judy" — packs that
  rename her still work.
- Chaos decisions (who skips, who reconnects, who double-submits, and every
  delay) are derived from `--seed` plus the current game/round/player, not from
  shared mutable state, so a run is exactly reproducible regardless of real
  network timing jitter.

## The three surfaces

| URL        | Who    | Behaviour                                             |
| ---------- | ------ | ----------------------------------------------------- |
| `/`        | Phones | Enter a name, then wait in the lobby                  |
| `/display` | TV     | QR code, join URL, live player roster                 |
| `/host`    | Laptop | Connection diagnostics and lobby roster               |

In development the Vite server on `:5173` proxies `/ws` and `/api` to `:3000`, so
use `:5173` while developing and `:3000` for anything resembling a real run.

## Identity model

Three ideas that are deliberately kept separate:

| Concept          | Lives in                | Survives                        |
| ---------------- | ----------------------- | ------------------------------- |
| Connection id    | `sessionStorage`, per tab | Refresh                       |
| Player token     | `localStorage`, per device | Refresh, tab close, sleep    |
| Player record    | Server memory            | Everything until server restart |

A **player outlives their socket**. Disconnecting marks a player offline rather
than deleting them, which is what makes refresh, sleep and Wi-Fi drops survivable
and stops the lobby filling with ghosts.

Player roles are `PLAYER` and `SPECIAL`; the host is a *connection* role, not a
player, because the laptop never competes.

### Content packs

The special player's name is data, not code. `content/<pack>/party.json`:

```json
{ "id": "judy-30", "name": "Judy's 30th", "specialPlayer": { "name": "Judy" } }
```

Select with `JUDYBOX_PACK=demo`. A malformed or missing pack aborts startup with a
specific message rather than booting a broken party.

## Manual test procedure (laptop + 2 phones)

1. Disconnect any VPN, then `./start-party.sh`. Wait for `Self-check passed`.
2. Open `/display` on the laptop and move it to the TV. Open `/host` in a second window.
3. **Phone A** — scan the QR, enter `Sarah`, join. TV shows `Players joined: 1` and her name.
4. **Phone B** — scan, enter `sarah` (lower case). Expect *"Someone already joined as Sarah."*
   Case and spacing differences are treated as the same name.
5. **Phone B** — enter `Judy`. Expect the confirmation screen naming her as the
   special player. Confirm. TV tags her `SPECIAL`; the host panel says she has joined.
6. **Phone A** — refresh. She returns as Sarah without re-entering her name, and the
   TV count stays at 2 rather than climbing to 3.
7. **Phone A** — lock the phone for 30 seconds, then unlock. She shows `offline` on the
   TV while asleep and returns automatically on wake.
8. **Phone B** — try joining as `Judy` from a third device. Expect
   *"Judy has already joined on another device."*
9. Stop the server with Ctrl-C and start it again. Both phones reconnect on their own,
   the lobby is empty, and both are asked for a name again.

### Known limitation: rejoining after losing the token

A player is identified by a token in `localStorage`. If that is lost — phone reset,
cleared browsing data, a switch to a different browser — the player cannot get their
identity back, and their name is still held by the offline record, so they cannot
retake it either. Today the only recovery is a different name.

This is fine for a lobby but **not** acceptable once games and scores exist, since a
returning player would lose their score. The intended fix is a host-side "reconnect
this player" action or reclaiming an offline player's name, which is deliberately
deferred until there is game state worth preserving.

Two browser tabs on the *same* device share one token, so the second tab takes over
the player rather than creating a duplicate. Real phones use one tab, so this is not
a practical concern.

## Manual test procedure (Milestone 1 & 2)

1. `npm install`, then `npm run party`.
2. **LAN address.** The terminal prints a QR code, the join URL, and every detected
   adapter, best first, with the chosen one starred. Confirm the starred address
   matches your Wi-Fi adapter (`ipconfig`). Virtual adapters — Hyper-V, WSL, VPNs —
   are scored down automatically. If it still picks wrong, restart with `JUDYBOX_HOST`.
3. **Self-check.** The server then calls its own advertised URL over the network and
   prints either `Self-check passed` or a loud warning. Do not hand out the QR code
   until this passes — it is the single best predictor of whether phones can join.
3. **Laptop.** Open the join URL. It should say "You're in."
4. **TV.** Open `/display` and move it to the TV. The QR and URL should be readable
   from across the room.
5. **Phone.** On the same Wi-Fi, scan the QR. The phone should connect, and the TV
   count should increase within a second.
6. **Refresh.** Pull-to-refresh on the phone. It reconnects, and the count returns
   to the same number rather than climbing — the phone kept its identity.
7. **Sleep.** Lock the phone, wait 30 seconds, unlock. It reconnects on wake without
   being touched. The TV count dips and recovers.
8. **Wi-Fi drop.** Turn the phone's Wi-Fi off and on. The badge shows "Reconnecting…"
   then "Connected". Backoff is capped at 5 seconds, so recovery is quick.
9. **Server restart.** Stop the server with Ctrl-C and start it again. Phones
   reconnect on their own; the host page warns that the session changed.
10. **Port in use.** Start a second server. It should exit with a clear message
    instead of a stack trace.

### What is deliberately not handled yet

- Reclaiming an identity after losing the reconnect token (see below).
- The remaining birthday games.

## Manual test: Would Judy Approve?

Needs the laptop plus at least two phones, one of them Judy's.

1. `npm run party`. Join from both phones, one as Judy (confirm the reserved-name prompt).
2. On the host, **Choose a game**, then **Start: Would Judy Approve?**.
3. **Continue**, then **Open answering**.
4. Judy's phone should read "What is YOUR answer?" with a *Private answer* badge,
   plus a cue pointing at the comment box. The other phone should read
   "Which answer will Judy choose?" and have no comment box.
5. Answer on both. Judy can type a comment and press **Save comment**; the status
   line should change from "Not saved yet" to "Ready. This appears on the TV at the
   reveal." The TV should show `2 / 2 answered · Judy has answered` and must
   **not** indicate which option she picked, nor her comment.
6. **Lock answers**, then **Reveal**. The TV now shows Judy's answer highlighted,
   *her* comment (not the scripted one), and the crowd tally excluding her.
7. **Show results**, then **Show leaderboard**. Anyone who matched her gains points;
   Judy gains none.
8. **Next round** twice to reach the end, then confirm `GAME_COMPLETE`.

To run without a second real phone:

```bash
node scripts/fake-player.mjs Sarah 2   # joins as Sarah, always answers option 2
```

## Manual test: scoring (Milestone 6)

1. Join from two phones and play a demo round, answering correctly on one.
2. The correct phone gains the configured points; the other gains none.
3. **Show leaderboard** ranks them, with a `+points` delta on the round's earners.
4. Play a second round. Scores accumulate rather than resetting.
5. Press **Restart round** after a round has been scored. That round's points are
   removed, and replaying it awards them once — not twice.
6. Use the host **+100 / −100** buttons. Scores adjust immediately everywhere.
7. Restart the server. The leaderboard is empty and phones return to the join screen.

## Manual test: host-controlled game loop (Milestone 5)

Needs the laptop plus at least two phones.

1. `npm run party`, open `/host` on the laptop and `/display` on the TV.
2. Join from two phones, one of them as the special player.
3. On the host, the only action should be **Choose a game**. Confirm the TV still
   shows the lobby and QR code.
4. Step through **Start game → Continue → Open answering**. The TV should follow
   each step and the phones should show the question only at `PLAYER_INPUT`.
5. Answer on one phone. The host counter should move to `1 / 2` and the second
   phone should still be answerable.
6. Tap a second option on the phone that already answered. It should be refused —
   the first answer stands.
7. Press **Lock answers**, then try to answer on the phone that has not answered.
   It should be rejected as locked.
8. **Reveal** shows the tally and marks the correct option. **Show results** lists
   each player's choice. **Show leaderboard** shows the running total.
9. **Next round** advances; on the last round it goes to `GAME_COMPLETE`.
10. Mid-round, refresh a phone that already answered. It should return to the same
    question with its answer still locked in.
11. Mid-round, press **Restart round**. Answers clear and the round number stays.
12. Press **Return to lobby** from anywhere. The TV returns to the QR screen.

To prove the server is authoritative rather than the UI: open the browser console
on a *phone* and send a host action. The server rejects it.

```js
// On a player device — should be refused.
new WebSocket(`ws://${location.host}/ws`)
```

## Troubleshooting on party day

| Symptom                     | Fix                                                       |
| --------------------------- | --------------------------------------------------------- |
| Self-check warning on boot  | **Disconnect the VPN first** — see below. Then firewall.   |
| Phone can't load the URL    | Confirm the phone is on the same Wi-Fi, not cellular.      |
| QR points at a dead address | Restart with `JUDYBOX_HOST=<address from ipconfig>`.       |
| Still unreachable           | Allow Node through the Windows firewall on private networks. |
| Port 3000 busy              | `JUDYBOX_PORT=3001 ./start-party.sh`                       |

### VPNs break this completely

A corporate VPN will make the app unreachable even from the host laptop itself.
Cisco AnyConnect, GlobalProtect and Zscaler install a route for your *local* subnet
pointing into the corporate tunnel:

```
192.168.1.0/24    0.0.0.0             256  Wi-Fi        <- real LAN
192.168.1.0/24    10.50.144.1           1  Ethernet 2   <- VPN wins on metric
```

The lower metric wins, so traffic to `192.168.1.x` is swallowed by the tunnel.
Adapter scoring cannot detect this — Node only sees the friendly name (`Ethernet 2`),
not `Cisco AnyConnect Virtual Miniport Adapter` — which is why the startup self-check
exists. **Disconnect the VPN before the party.** Check with `Get-NetRoute -AddressFamily IPv4`.

Guest Wi-Fi with "client isolation" enabled will block phone-to-laptop traffic
entirely. That is the one failure this app cannot work around, so it is worth
testing at the venue before the party.
