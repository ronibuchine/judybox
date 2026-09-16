# JudyBox

JudyBox is a local-network party game platform. A laptop runs the server, a TV
shows the game, and phones act as controllers. It does not require accounts, a
database, or internet access after dependencies are installed.

## Requirements

- Node.js 20.11 or newer
- A laptop and player devices on the same Wi-Fi network
- A network that allows devices to reach the laptop (guest Wi-Fi with client
  isolation will not work)

## Run JudyBox

Install dependencies once:

```bash
npm install
```

For development, run the server and Vite client together:

```bash
npm run dev
```

Open the client at `http://localhost:5173`. The server runs on port 3000 and
the Vite server proxies its API and WebSocket traffic.

For a party, build the client and serve everything from one port:

```bash
npm run party
```

The server prints the LAN URL and a terminal QR code. Scan that URL from the
phones. The same server provides these views:

| Path | Use |
| --- | --- |
| `/` | Player phone controller |
| `/display` | TV display, QR code, and roster |
| `/host` | Host controls and connection status |

The party launcher is also available as `./start-party.sh`. It installs
dependencies on first use, builds the client, and starts the server. It
requires a Bash-compatible shell.

## Content packs

Party packs live in `content/<pack-id>/party.json` and are selected with
`JUDYBOX_PACK`. The default pack is `judy-30`.

```bash
JUDYBOX_PACK=demo npm run party
```

Pack content is data-driven. A pack defines its special player and an ordered
list of games:

```json
{
  "id": "demo",
  "name": "Demo Party",
  "specialPlayer": { "name": "Star" },
  "games": [
    {
      "id": "quiz",
      "type": "multiple-choice",
      "name": "Quiz",
      "scoring": { "correctAnswer": 100 },
      "rounds": [
        {
          "prompt": "What is 2 + 2?",
          "options": ["3", "4", "5", "22"],
          "correctOptionIndex": 1
        }
      ]
    }
  ]
}
```

Indexes are zero-based, so `correctOptionIndex: 1` selects the second option.
The server validates packs at startup and stops for malformed JSON, unknown game
types, invalid indexes, or invalid game data. Missing media is reported as a
warning and does not prevent the party from starting.

The built-in game types are:

- `multiple-choice`: players choose an answer; correct answers can score points.
- `would-approve`: players predict the special player's answer, with an
  optional scripted fallback and comment.
- `what-would-judy-do`: the special player answers live; other players predict
  the answer.
- `rotten-tomatoes`: players predict the special player's 0-100 rating using
  configurable distance bands.
- `caption-this` and `quiplash`: players submit text and the special player
  chooses a winner.
- `draw-this`: players submit drawings and the special player chooses a winner.

See the example packs in `content/demo/party.json` and
`content/judy-30/party.json` for complete content.

## Configuration

| Variable | Purpose | Default |
| --- | --- | --- |
| `JUDYBOX_PORT` or `PORT` | HTTP/WebSocket port | `3000` |
| `JUDYBOX_BIND` or `HOST` | Interface to bind to | `0.0.0.0` |
| `JUDYBOX_HOST` | LAN address advertised in the QR code | automatic |
| `JUDYBOX_PACK` | Content pack directory name | `judy-30` |

Examples:

```bash
JUDYBOX_PORT=3001 npm run party
JUDYBOX_HOST=192.168.1.42 npm run party
JUDYBOX_BIND=192.168.1.42 npm run party
```

`JUDYBOX_HOST` changes the advertised address. Use `JUDYBOX_BIND` only when
the server must listen on a particular local interface; the default accepts
connections on all interfaces.

## Simulator

The simulator drives the real server through the WebSocket protocol. Start the
server first, then run the simulator in another terminal:

```bash
npm run start
npm run simulate -- --players 20 --include-judy
```

Useful options include `--game <id>`, `--host <url>`, `--chaos`, `--verbose`,
and `--seed <number>`. The `--` separator is required so npm passes the flags
to the simulator. A non-zero exit code means the simulation recorded a failure.

## Development commands

```bash
npm run dev          # Server with watch mode and Vite client
npm run build        # Build client and server
npm run start        # Build the server, then serve the built client
npm run party        # Build everything, then start the party server
npm test             # Run the Vitest suite
npm run typecheck    # Type-check all workspaces and tests
npm run test:watch   # Run Vitest in watch mode
```

The repository uses npm workspaces: `shared`, `server`, `client`, and
`simulator`. The shared package is the source of truth for messages and view
types exchanged between the server and client. Server state, progression, and
scores are held in memory; restarting the server starts a new session and
clears the leaderboard.

## LAN troubleshooting

- Make sure phones are on the same Wi-Fi as the laptop and are not using
  cellular data.
- Disconnect a VPN before starting a party. Corporate VPNs can capture routes
  to the local subnet and make the advertised URL unreachable.
- If the QR code contains the wrong address, restart with
  `JUDYBOX_HOST=<laptop-LAN-address>`.
- Allow Node.js through the Windows firewall on private networks.
- If port 3000 is busy, use `JUDYBOX_PORT=3001`.

At startup the server runs a self-check against its advertised URL and prints a
warning when the laptop cannot reach that address.
