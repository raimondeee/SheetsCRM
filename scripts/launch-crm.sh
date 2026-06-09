#!/bin/bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "SheetsCRM launcher"
echo "Project: $ROOT"
echo ""

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is not installed."
  echo "Install it from https://nodejs.org (LTS), then try again."
  read -r -p "Press Enter to close…"
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "npm is not installed (it usually ships with Node.js)."
  read -r -p "Press Enter to close…"
  exit 1
fi

if [ ! -d node_modules ]; then
  echo "First run — installing dependencies (may take a minute)…"
  npm install
  echo ""
fi

PORT="${PORT:-3000}"
URL="http://localhost:${PORT}"

echo "Starting CRM…"
echo "When ready, open: $URL"
echo "Leave this window open while you use the CRM."
echo "Press Ctrl+C to stop the server."
echo ""

(
  for _ in $(seq 1 60); do
    if curl -fsS "$URL" >/dev/null 2>&1; then
      open "$URL"
      exit 0
    fi
    sleep 1
  done
) &

npm run dev

read -r -p "Press Enter to close…"
