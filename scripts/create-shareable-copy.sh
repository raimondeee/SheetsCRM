#!/usr/bin/env bash
# Create a sanitized copy of SheetsCRM safe to zip and share (no secrets, no local DB).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="${1:-${ROOT}/../SheetsCRM-share}"

if [[ -e "$DEST" ]]; then
  echo "Destination already exists: $DEST"
  echo "Remove it first or pass a different path:"
  echo "  $0 /path/to/SheetsCRM-share"
  exit 1
fi

echo "Creating shareable copy at:"
echo "  $DEST"
echo

mkdir -p "$DEST"

rsync -a \
  --exclude 'node_modules' \
  --exclude '.next' \
  --exclude '.git' \
  --exclude '.env' \
  --exclude '.env.*' \
  --exclude 'data/*.db' \
  --exclude 'data/*.db-*' \
  --exclude '.DS_Store' \
  --exclude 'coverage' \
  --exclude 'sheets-crm-tmp' \
  "$ROOT/" "$DEST/"

mkdir -p "$DEST/data"

# Placeholder .env (coworker fills in their own credentials)
cat > "$DEST/.env" <<'EOF'
# SheetsCRM — replace placeholders before first run (see README.md)
GOOGLE_CLIENT_ID=your-google-oauth-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-google-oauth-client-secret
NEXT_PUBLIC_APP_URL=http://localhost:3000

NEXT_PUBLIC_AUTO_REFRESH_SECONDS=60

GOOGLE_SERVICE_ACCOUNT_EMAIL=
GOOGLE_PRIVATE_KEY=

DEFAULT_SHEET_URL=https://docs.google.com/spreadsheets/d/YOUR_SPREADSHEET_ID/edit?gid=YOUR_TAB_GID

SALESFORCE_SEARCH_BASE_URL=https://your-org.my.salesforce.com/_ui/search/ui/UnifiedSearchResults

GMAIL_SENDER_EMAIL=

OVERLAY_DB_PATH=./data/overlay.db

MIXMAX_API_TOKEN=

USE_MOCK_DATA=true
EOF

# Example MM directory (no real employee emails)
if [[ -f "$ROOT/data/market-managers.example.json" ]]; then
  cp "$ROOT/data/market-managers.example.json" "$DEST/data/market-managers.json"
else
  cat > "$DEST/data/market-managers.json" <<'EOF'
{
  "updatedAt": "2000-01-01T00:00:00.000Z",
  "managers": [
    { "name": "Example Manager", "email": "manager@example.com" }
  ]
}
EOF
fi

# Scrub example sheet IDs from the copy (configure via Setup UI instead)
if [[ "$(uname)" == "Darwin" ]]; then
  SED_INPLACE=(-i '')
else
  SED_INPLACE=(-i)
fi

sed "${SED_INPLACE[@]}" \
  's|1Kj8p-USf20vZREe-Cxg2c28vq4ppTwmgr05lYGxJebg|YOUR_SPREADSHEET_ID|g' \
  "$DEST/src/lib/default-sheet-config.ts" \
  "$DEST/.env.example" 2>/dev/null || true

sed "${SED_INPLACE[@]}" \
  's|223304028|YOUR_TAB_GID|g' \
  "$DEST/src/lib/default-sheet-config.ts" \
  "$DEST/.env.example" 2>/dev/null || true

sed "${SED_INPLACE[@]}" \
  's|https://docs.google.com/spreadsheets/d/1Kj8p-USf20vZREe-Cxg2c28vq4ppTwmgr05lYGxJebg/edit?gid=223304028|https://docs.google.com/spreadsheets/d/YOUR_SPREADSHEET_ID/edit?gid=YOUR_TAB_GID|g' \
  "$DEST/.env.example" 2>/dev/null || true

cat > "$DEST/SHARE_PACKAGING.txt" <<'EOF'
SheetsCRM — shareable copy
==========================

This folder was generated without secrets or local database files.

Before zipping, confirm:
  - No .env.local or overlay.db was copied (they should be absent)
  - .env contains only placeholder values

Your coworker should:
  1. Unzip the folder
  2. Copy .env.example to .env if needed, or edit the included .env
  3. Add their Google OAuth client ID/secret (see README → Google sign-in setup)
  4. Double-click Open SheetsCRM.command (or: npm install && npm run db:migrate && npm run dev)
  5. Connect their intake sheet in Setup → Sheet mapping
  6. Paste their Market Manager list in Setup → Market managers

Do not commit real .env files or data/overlay.db to git.
EOF

echo "Done."
echo
echo "Excluded: node_modules, .next, .git, .env, overlay.db, WAL/SHM files"
echo "Sanitized: .env, data/market-managers.json, example sheet IDs in copy"
echo
echo "Next steps:"
echo "  cd $(dirname "$DEST")"
echo "  zip -r SheetsCRM-share.zip $(basename "$DEST")"
echo
echo "See $DEST/SHARE_PACKAGING.txt for a checklist."
