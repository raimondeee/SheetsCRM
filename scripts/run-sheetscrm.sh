#!/bin/bash
# Day-to-day macOS launcher (via "Open SheetsCRM.command").
# Assumes Node is already installed — use bootstrap-macos.sh for first-time setup.
# Starts npm run dev on port 3000, opens the browser when ready, minimizes Terminal.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# Remember this window so we can minimize it after the CRM opens in the browser.
SHEETSCRM_WINDOW_ID="$(
  osascript -e 'tell application "Terminal" to id of front window' 2>/dev/null || true
)"

# Terminal sometimes opens a blank default window on cold start before running a .command file.
close_empty_terminal_windows() {
  osascript <<'APPLESCRIPT' 2>/dev/null || true
tell application "Terminal"
  if (count of windows) < 2 then return
  set keeper to front window
  repeat with w in windows
    if w is not keeper then
      try
        if (count of tabs of w) is 1 then
          tell tab 1 of w
            if (busy of it) is false and ((contents of it) is missing value or (contents of it) is "") then
              close w saving no
            end if
          end tell
        end if
      end try
    end if
  end repeat
end tell
APPLESCRIPT
}

minimize_launcher_terminal() {
  if [ -z "${SHEETSCRM_WINDOW_ID:-}" ]; then
    return
  fi
  osascript -e "tell application \"Terminal\" to set miniaturized of (first window whose id is ${SHEETSCRM_WINDOW_ID}) to true" 2>/dev/null || true
}

close_empty_terminal_windows

# Prefer Node 22 LTS from Homebrew when present (plain `node` may be too new).
if [ -x /opt/homebrew/opt/node@22/bin/node ]; then
  PATH="/opt/homebrew/opt/node@22/bin:${PATH}"
  export PATH
elif [ -x /usr/local/opt/node@22/bin/node ]; then
  PATH="/usr/local/opt/node@22/bin:${PATH}"
  export PATH
fi

echo "SheetsCRM"
echo "Project: $ROOT"
echo ""

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is not installed."
  echo "Run Install SheetsCRM.command first, or install Node 22 LTS (brew install node@22)."
  read -r -p "Press Enter to close…"
  exit 1
fi

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$NODE_MAJOR" -lt 20 ] || [ "$NODE_MAJOR" -gt 22 ]; then
  echo "Node.js $(node --version) is not supported (need v20–v22)."
  echo "Run Install SheetsCRM.command, or: brew install node@22"
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

# Idempotent: ensure ~/Documents/SheetsCRM-Attachments + crmfolder:// helper exist.
if [ -f "$ROOT/scripts/install-crmfolder-helper.sh" ]; then
  bash "$ROOT/scripts/install-crmfolder-helper.sh" || true
  echo ""
fi

PORT="${PORT:-3000}"
# Next.js defaults to 0.0.0.0 — SheetsCRM must bind loopback only.
# Use SHEETSCRM_BIND (not HOSTNAME — that is the machine name on macOS).
BIND_HOST="${SHEETSCRM_BIND:-localhost}"
case "$BIND_HOST" in
  localhost|127.0.0.1|::1) ;;
  *)
    echo "Refusing to bind to '${BIND_HOST}'."
    echo "SheetsCRM must listen on localhost only (set SHEETSCRM_BIND=localhost)."
    echo "Do not use 0.0.0.0 or a LAN address — that exposes unauthenticated APIs on your network."
    read -r -p "Press Enter to close…"
    exit 1
    ;;
esac
URL="http://localhost:${PORT}"
if [ "$BIND_HOST" = "127.0.0.1" ]; then
  URL="http://127.0.0.1:${PORT}"
fi


stop_existing_server_on_port() {
  local port="$1"
  local pids
  pids="$(lsof -ti "tcp:${port}" -sTCP:LISTEN 2>/dev/null || true)"
  if [ -z "$pids" ]; then
    return
  fi
  echo "Stopping previous server on port ${port}…"
  # shellcheck disable=SC2086
  kill $pids 2>/dev/null || true
  sleep 1
  pids="$(lsof -ti "tcp:${port}" -sTCP:LISTEN 2>/dev/null || true)"
  if [ -n "$pids" ]; then
    # shellcheck disable=SC2086
    kill -9 $pids 2>/dev/null || true
    sleep 1
  fi
}

wait_for_sheetscrm_ready() {
  local url="$1"
  local attempt chunk_path
  for attempt in $(seq 1 120); do
    if ! curl -fsS "$url" >/dev/null 2>&1; then
      sleep 1
      continue
    fi
    chunk_path="$(
      curl -fsS "$url" 2>/dev/null \
        | grep -oE '/_next/static/chunks/main-app\.js[^" ]*' \
        | head -1 \
        || true
    )"
    if [ -n "$chunk_path" ] && curl -fsS "${url%/}${chunk_path}" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  return 1
}

echo "Starting SheetsCRM…"
echo "Listening on ${BIND_HOST}:${PORT} (loopback only)"
echo "When ready, open: $URL"
echo "Leave this window open while you use the CRM."
echo "Press Ctrl+C to stop the server."
echo ""

stop_existing_server_on_port "$PORT"

(
  if wait_for_sheetscrm_ready "$URL"; then
    open "$URL"
    minimize_launcher_terminal
  else
    echo "SheetsCRM did not become ready in time. Open $URL manually once the server is up."
  fi
) &

# Explicit -H overrides any accidental npm script change; refuse LAN binds above.
npm run dev -- -H "$BIND_HOST" -p "$PORT"

read -r -p "Press Enter to close…"
