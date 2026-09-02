#!/usr/bin/env bash
#
# Party-day launcher. Builds the phone/TV UI, then serves everything from the
# Node server on a single port so there is exactly one URL and one QR code.
#
# Usage:  ./start-party.sh              (auto-detect the LAN address)
#         JUDYBOX_HOST=192.168.1.42 ./start-party.sh   (force an address)
#         JUDYBOX_PORT=3001 ./start-party.sh           (if 3000 is taken)

set -euo pipefail

cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is not on PATH. Install Node 20+ and try again." >&2
  exit 1
fi

if [ ! -d node_modules ]; then
  echo "First run: installing dependencies..."
  npm install
fi

echo "Building the player and TV interface..."
npm run build

echo "Starting JudyBox..."
exec npm run start
