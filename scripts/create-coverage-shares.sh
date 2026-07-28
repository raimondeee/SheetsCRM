#!/usr/bin/env bash
# Create one shareable SheetsCRM folder per Team Coverage teammate (plus the
# exporter's own primary sheet). Each package gets:
#   - that person's sheet as Setup → Sheet mapping (primary)
#   - everyone else prefilled under Setup → Team coverage
#   - shared Google OAuth from the exporter .env (same as share:export)
#
# Usage:
#   bash scripts/create-coverage-shares.sh [destRoot] [--self-label "Robert"] [--only "Alex"]
#
# Examples:
#   npm run share:coverage
#   npm run share:coverage -- ../SheetsCRM-coverage-shares --self-label "Robert"
#   bash scripts/create-coverage-shares.sh ../SheetsCRM-coverage-shares --only "Alex"
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST_ROOT="${ROOT}/../SheetsCRM-coverage-shares"
SELF_LABEL="Team host"
ONLY_FILTER=""

# Parse args: first non-flag path is dest root; flags may appear anywhere.
POSITIONAL=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --self-label)
      SELF_LABEL="${2:-}"
      shift 2
      ;;
    --only)
      ONLY_FILTER="${2:-}"
      shift 2
      ;;
    -h|--help)
      sed -n '2,16p' "$0"
      exit 0
      ;;
    *)
      POSITIONAL+=("$1")
      shift
      ;;
  esac
done
if [[ ${#POSITIONAL[@]} -gt 0 ]]; then
  DEST_ROOT="${POSITIONAL[0]}"
fi

# Resolve relative dest against cwd (npm often runs from repo root).
if [[ "$DEST_ROOT" != /* ]]; then
  DEST_ROOT="$(cd "$(dirname "$DEST_ROOT")" && pwd)/$(basename "$DEST_ROOT")"
fi

SOURCE_DB="${OVERLAY_DB_PATH:-$ROOT/data/overlay.db}"
if [[ "$SOURCE_DB" != /* ]]; then
  SOURCE_DB="$ROOT/$SOURCE_DB"
fi

if [[ ! -f "$SOURCE_DB" ]]; then
  echo "No overlay DB found at: $SOURCE_DB"
  echo "Open SheetsCRM once, configure Setup → Sheet mapping and Team coverage, then re-run."
  exit 1
fi

if [[ -e "$DEST_ROOT" ]]; then
  echo "Destination already exists: $DEST_ROOT"
  echo "Remove it first or pass a different path."
  exit 1
fi

env_value() {
  local key="$1"
  local file="$ROOT/.env"
  local line value
  if [[ ! -f "$file" ]]; then
    echo ""
    return
  fi
  line="$(grep -E "^[[:space:]]*${key}=" "$file" | tail -n 1 || true)"
  if [[ -z "$line" ]]; then
    echo ""
    return
  fi
  value="${line#*=}"
  value="${value#"${value%%[![:space:]]*}"}"
  value="${value%"${value##*[![:space:]]}"}"
  if [[ "$value" == \"*\" && "$value" == *\" ]]; then
    value="${value:1:${#value}-2}"
  elif [[ "$value" == \'*\' && "$value" == *\' ]]; then
    value="${value:1:${#value}-2}"
  fi
  printf '%s' "$value"
}

env_escape() {
  printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g'
}

GOOGLE_CLIENT_ID_VALUE="$(env_value GOOGLE_CLIENT_ID)"
GOOGLE_CLIENT_SECRET_VALUE="$(env_value GOOGLE_CLIENT_SECRET)"
SALESFORCE_SEARCH_BASE_URL_VALUE="$(env_value SALESFORCE_SEARCH_BASE_URL)"

OAUTH_INCLUDED=0
USE_MOCK_DATA_VALUE="true"
if [[ -n "$GOOGLE_CLIENT_ID_VALUE" && -n "$GOOGLE_CLIENT_SECRET_VALUE" \
  && "$GOOGLE_CLIENT_ID_VALUE" != *your-google-oauth* \
  && "$GOOGLE_CLIENT_SECRET_VALUE" != *your-google-oauth* ]]; then
  OAUTH_INCLUDED=1
  USE_MOCK_DATA_VALUE="false"
else
  GOOGLE_CLIENT_ID_VALUE="${GOOGLE_CLIENT_ID_VALUE:-your-google-oauth-client-id.apps.googleusercontent.com}"
  GOOGLE_CLIENT_SECRET_VALUE="${GOOGLE_CLIENT_SECRET_VALUE:-your-google-oauth-client-secret}"
fi

if [[ -z "$SALESFORCE_SEARCH_BASE_URL_VALUE" ]]; then
  SALESFORCE_SEARCH_BASE_URL_VALUE="https://your-org.my.salesforce.com/_ui/search/ui/UnifiedSearchResults"
fi

echo "Listing Team Coverage / primary sheet recipients from:"
echo "  $SOURCE_DB"
echo "  self-label: $SELF_LABEL"
echo

RECIPIENTS_JSON="$(
  node "$ROOT/scripts/seed-coverage-share-overlay.mjs" \
    --source-db "$SOURCE_DB" \
    --list \
    --self-label "$SELF_LABEL"
)"

RECIPIENT_COUNT="$(node -e 'const a=JSON.parse(process.argv[1]); process.stdout.write(String(a.length))' "$RECIPIENTS_JSON")"
if [[ "$RECIPIENT_COUNT" -eq 0 ]]; then
  echo "No mapped primary sheet or Team Coverage entries found."
  echo "Configure Setup → Sheet mapping and/or Team coverage, then re-run."
  exit 1
fi

mkdir -p "$DEST_ROOT"

TEMPLATE="$DEST_ROOT/_template"
echo "Building shared template at:"
echo "  $TEMPLATE"
echo
bash "$ROOT/scripts/create-shareable-copy.sh" "$TEMPLATE"

# Prefer live market-managers if present (team already trusts this private handoff).
if [[ -f "$ROOT/data/market-managers.json" ]]; then
  cp "$ROOT/data/market-managers.json" "$TEMPLATE/data/market-managers.json"
  echo "Included live data/market-managers.json in packages."
fi

MANIFEST_ITEMS="[]"
CREATED=0
SKIPPED=0

while IFS= read -r row; do
  KEY="$(node -e 'const o=JSON.parse(process.argv[1]); process.stdout.write(o.key||"")' "$row")"
  LABEL="$(node -e 'const o=JSON.parse(process.argv[1]); process.stdout.write(o.label||"")' "$row")"
  SLUG="$(node -e 'const o=JSON.parse(process.argv[1]); process.stdout.write(o.slug||"teammate")' "$row")"
  SHEET_URL="$(node -e 'const o=JSON.parse(process.argv[1]); process.stdout.write(o.sheetUrl||"")' "$row")"

  if [[ -n "$ONLY_FILTER" ]]; then
    # Case-insensitive match against label or slug
    if ! node -e '
      const row=JSON.parse(process.argv[1]);
      const f=String(process.argv[2]||"").toLowerCase();
      const hay=`${row.label} ${row.slug} ${row.key}`.toLowerCase();
      process.exit(hay.includes(f) ? 0 : 1);
    ' "$row" "$ONLY_FILTER"; then
      SKIPPED=$((SKIPPED + 1))
      continue
    fi
  fi

  DEST="$DEST_ROOT/$SLUG"
  # Avoid collisions when two labels slugify the same way.
  if [[ -e "$DEST" ]]; then
    DEST="$DEST_ROOT/${SLUG}-${KEY}"
  fi

  echo "────────────────────────────────────────"
  echo "Package: $LABEL"
  echo "  key:  $KEY"
  echo "  path: $DEST"

  rsync -a \
    --exclude 'data/*.db' \
    --exclude 'data/*.db-*' \
    "$TEMPLATE/" "$DEST/"

  mkdir -p "$DEST/data"

  SEED_OUT="$(
    node "$ROOT/scripts/seed-coverage-share-overlay.mjs" \
      --source-db "$SOURCE_DB" \
      --dest-db "$DEST/data/overlay.db" \
      --recipient-key "$KEY" \
      --self-label "$SELF_LABEL"
  )"
  COVER_COUNT="$(node -e 'const o=JSON.parse(process.argv[1]); process.stdout.write(String(o.coverCount||0))' "$SEED_OUT")"

  DEFAULT_SHEET_URL_VALUE="$SHEET_URL"
  if [[ -z "$DEFAULT_SHEET_URL_VALUE" ]]; then
    DEFAULT_SHEET_URL_VALUE="https://docs.google.com/spreadsheets/d/YOUR_SPREADSHEET_ID/edit?gid=YOUR_TAB_GID"
  fi

  {
    echo "# SheetsCRM — coverage share for: $LABEL"
    echo "# Generated by scripts/create-coverage-shares.sh"
    echo "# Do not commit this file or upload the zip to a public location."
    echo "GOOGLE_CLIENT_ID=\"$(env_escape "$GOOGLE_CLIENT_ID_VALUE")\""
    echo "GOOGLE_CLIENT_SECRET=\"$(env_escape "$GOOGLE_CLIENT_SECRET_VALUE")\""
    echo "NEXT_PUBLIC_APP_URL=http://localhost:3000"
    echo
    echo "NEXT_PUBLIC_AUTO_REFRESH_SECONDS=60"
    echo
    echo "GOOGLE_SERVICE_ACCOUNT_EMAIL="
    echo "GOOGLE_PRIVATE_KEY="
    echo
    echo "DEFAULT_SHEET_URL=\"$(env_escape "$DEFAULT_SHEET_URL_VALUE")\""
    echo
    echo "SALESFORCE_SEARCH_BASE_URL=\"$(env_escape "$SALESFORCE_SEARCH_BASE_URL_VALUE")\""
    echo
    echo "GMAIL_SENDER_EMAIL="
    echo
    echo "OVERLAY_DB_PATH=./data/overlay.db"
    echo
    echo "MIXMAX_API_TOKEN="
    echo
    echo "USE_MOCK_DATA=${USE_MOCK_DATA_VALUE}"
  } > "$DEST/.env"

  cat > "$DEST/SHARE_PACKAGING.txt" <<EOF
SheetsCRM — coverage share for ${LABEL}
=======================================

This package was generated from the exporter's Team Coverage + primary sheet mappings.

Preloaded:
  - Setup → Sheet mapping = ${LABEL}'s intake sheet (${COVER_COUNT} teammate cover sheet(s) also mapped)
  - Setup → Team coverage = the other teammates (enabled, with column mappings)
  - Shared Google OAuth client (from exporter), USE_MOCK_DATA=${USE_MOCK_DATA_VALUE}
  - Fresh overlay.db (mappings only — no tickets/threads from the exporter)

Recipient steps:
  1. Unzip / copy this folder to a path WITHOUT spaces
  2. Double-click Install SheetsCRM.command (first Mac), then Open SheetsCRM.command
  3. Sign in with Google (account must open the mapped Google Sheets)
  4. Confirm Setup → Sheet mapping points at your intake sheet
  5. Review Setup → Team coverage (teammates should already be mapped)
  6. Paste Market Managers if needed (may already be included)

Notes:
  - Mixmax token is blank — set MIXMAX_API_TOKEN locally if you use templates
  - Do not upload this zip publicly (contains OAuth client secret when included)
  - Re-export after mapping changes so packages stay current

Update later: unzip a new share beside the install, then Update SheetsCRM.command
(preserves this overlay.db / .env).
EOF

  MANIFEST_ITEMS="$(
    node -e '
      const items=JSON.parse(process.argv[1]);
      const row=JSON.parse(process.argv[2]);
      items.push({
        key: row.key,
        label: row.label,
        slug: row.slug,
        folder: process.argv[3],
        sheetUrl: row.sheetUrl,
        coverCount: Number(process.argv[4]),
      });
      process.stdout.write(JSON.stringify(items));
    ' "$MANIFEST_ITEMS" "$row" "$(basename "$DEST")" "$COVER_COUNT"
  )"

  CREATED=$((CREATED + 1))
  echo "  seeded covers: $COVER_COUNT"
done < <(node -e 'JSON.parse(process.argv[1]).forEach((row)=>console.log(JSON.stringify(row)))' "$RECIPIENTS_JSON")

rm -rf "$TEMPLATE"

node -e '
  const items=JSON.parse(process.argv[1]);
  const manifest={
    generatedAt: new Date().toISOString(),
    selfLabel: process.argv[2],
    oauthIncluded: process.argv[3]==="1",
    packages: items,
  };
  const fs=require("fs");
  fs.writeFileSync(process.argv[4], JSON.stringify(manifest,null,2)+"\n");
' "$MANIFEST_ITEMS" "$SELF_LABEL" "$OAUTH_INCLUDED" "$DEST_ROOT/MANIFEST.json"

cat > "$DEST_ROOT/README.txt" <<EOF
SheetsCRM — Team Coverage share packages
========================================

Generated packages: ${CREATED}
Skipped by --only filter: ${SKIPPED}
Self label used for exporter primary sheet: ${SELF_LABEL}

Each subfolder is a private handoff for one teammate:
  - Their intake sheet is pre-mapped as the primary CRM sheet
  - Other teammates are prefilled under Team coverage

See each folder's SHARE_PACKAGING.txt and MANIFEST.json for details.

Zip example:
  cd "$(dirname "$DEST_ROOT")"
  zip -r SheetsCRM-coverage-shares.zip "$(basename "$DEST_ROOT")"
EOF

echo
echo "Done. Created ${CREATED} package(s) in:"
echo "  $DEST_ROOT"
if [[ "$SKIPPED" -gt 0 ]]; then
  echo "Skipped ${SKIPPED} recipient(s) via --only filter."
fi
echo
echo "See $DEST_ROOT/README.txt and MANIFEST.json"
echo
echo "Zip tip:"
echo "  cd $(dirname "$DEST_ROOT")"
echo "  zip -r SheetsCRM-coverage-shares.zip $(basename "$DEST_ROOT")"
