#!/usr/bin/env bash
# Create a shareable Team Dashboard-only copy of SheetsCRM.
# Includes the Team dashboard UI plus tools to add/edit regional source sheets.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="${1:-${ROOT}/../TeamDashboard-share}"

if [[ -e "$DEST" ]]; then
  echo "Destination already exists: $DEST"
  echo "Remove it first or pass a different path:"
  echo "  $0 /path/to/TeamDashboard-share"
  exit 1
fi

echo "Creating Team Dashboard shareable copy at:"
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
  --exclude 'data/custom-sounds' \
  --exclude 'data/team-dashboard-sources.json' \
  --exclude '.DS_Store' \
  --exclude 'coverage' \
  --exclude 'sheets-crm-tmp' \
  --exclude 'public/sounds' \
  --exclude 'public/jsons' \
  --exclude 'sounds' \
  --exclude 'extensions' \
  "$ROOT/" "$DEST/"

mkdir -p "$DEST/data"

# Point the app at the slim Team Dashboard shell
cat > "$DEST/src/app/page.tsx" <<'EOF'
import { TeamDashboardShell } from "@/components/TeamDashboardShell";

export default function HomePage() {
  return <TeamDashboardShell />;
}
EOF

# In the shareable build only: load regional tabs from editable JSON, not hardcoded CRM list.
cat > "$DEST/src/lib/team-tab-loader.ts" <<'EOF'
import {
  getTeamSpreadsheetId,
  getTeamTabSources,
} from "@/lib/team-dashboard-sources-store";
import type { TeamTabSource } from "@/lib/team-dashboard-sources";
import { fetchSheetTabsBatch } from "@/lib/sheet-tabs";
import { parseTeamTab, type TeamIntakeRecord } from "@/lib/team-metrics";

export interface ColleagueTeamLoadResult {
  colleagueRecords: TeamIntakeRecord[];
  sourcesLoaded: number;
  sourcesTotal: number;
  loadError: string | null;
}

export async function loadColleagueTeamRecords(): Promise<ColleagueTeamLoadResult> {
  const sources = getTeamTabSources();
  const spreadsheetId = getTeamSpreadsheetId();
  const sourcesTotal = sources.length;
  let colleagueRecords: TeamIntakeRecord[] = [];
  let sourcesLoaded = 0;
  let loadError: string | null = null;

  if (sourcesTotal === 0) {
    return {
      colleagueRecords: [],
      sourcesLoaded: 0,
      sourcesTotal: 0,
      loadError: "No regional source sheets configured",
    };
  }

  try {
    const tabs = await fetchSheetTabsBatch(
      spreadsheetId,
      sources.map((source) => ({
        key: source.id,
        sheetName: source.sheetName,
        gid: source.gid,
      }))
    );

    for (const source of sources) {
      const tab = tabs.get(source.id);
      if (!tab) {
        if (!loadError) {
          loadError = `Sheet tab not found: ${source.sheetName}`;
        }
        continue;
      }
      colleagueRecords = colleagueRecords.concat(parseTeamTab(source, tab));
      sourcesLoaded += 1;
    }
  } catch (error) {
    loadError = error instanceof Error ? error.message : "Failed to load team sheet tabs";
  }

  return {
    colleagueRecords,
    sourcesLoaded,
    sourcesTotal,
    loadError,
  };
}

export type { TeamTabSource };
EOF

# Example regional sources (edit via Source sheets UI or this JSON file)
cp "$ROOT/data/team-dashboard-sources.example.json" "$DEST/data/team-dashboard-sources.json"

# Placeholder env for dashboard-only use
cat > "$DEST/.env" <<'EOF'
# Team Dashboard (shareable) — replace placeholders before first run
GOOGLE_CLIENT_ID=your-google-oauth-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-google-oauth-client-secret
NEXT_PUBLIC_APP_URL=http://localhost:3000

# Optional: service account (share each spreadsheet with this email)
GOOGLE_SERVICE_ACCOUNT_EMAIL=
GOOGLE_PRIVATE_KEY=

TEAM_DASHBOARD_SOURCES_PATH=./data/team-dashboard-sources.json
OVERLAY_DB_PATH=./data/overlay.db

USE_MOCK_DATA=false
EOF

cp "$DEST/.env" "$DEST/.env.example"

# Trim package.json name / share scripts for the copy
node -e "
const fs=require('fs');
const pkgPath=process.argv[1];
const pkg=JSON.parse(fs.readFileSync(pkgPath,'utf8'));
pkg.name='team-dashboard';
pkg.description='SheetsCRM Team Dashboard (shareable) — regional intake metrics + source sheet tools';
pkg.scripts={dev:'next dev',build:'next build',start:'next start',lint:'next lint','db:migrate':'node scripts/init-db.mjs'};
fs.writeFileSync(pkgPath, JSON.stringify(pkg,null,2)+'\n');
" "$DEST/package.json"

# Remove CRM-only surfaces that are unused by the Team Dashboard shell
# (keeps shared libs so Next can still resolve transitive imports).
rm -rf \
  "$DEST/extensions" \
  "$DEST/public/sounds" \
  "$DEST/public/jsons" \
  "$DEST/sounds" \
  "$DEST/docs" \
  2>/dev/null || true

# macOS launcher
cat > "$DEST/Open TeamDashboard.command" <<'EOF'
#!/bin/bash
cd "$(dirname "$0")"
if [[ ! -d node_modules ]]; then
  echo "Installing dependencies…"
  npm install
fi
if [[ ! -f data/overlay.db ]]; then
  npm run db:migrate || true
fi
echo "Starting Team Dashboard on http://localhost:3000"
npm run dev
EOF
chmod +x "$DEST/Open TeamDashboard.command"

cat > "$DEST/TEAM_DASHBOARD_README.md" <<'EOF'
# Team Dashboard (shareable)

This package is a **Team Dashboard-only** build of SheetsCRM. It does not include the ticket inbox, Gmail compose, Mixmax, or calendar tools.

## What you get

- Regional intake dashboard (charts, status cards, reports)
- **Source sheets** UI to add / edit / remove regional Google Sheet tabs that feed the dashboard
- Google sign-in (OAuth) or optional service-account auth for reading Sheets

## Quick start

1. Edit `.env` with your Google OAuth client ID/secret (and set `NEXT_PUBLIC_APP_URL=http://localhost:3000`).
2. Double-click `Open TeamDashboard.command`, or run:
   ```bash
   npm install
   npm run db:migrate
   npm run dev
   ```
3. Open http://localhost:3000 and **Sign in with Google**.
4. Click **Source sheets** and set:
   - Spreadsheet ID (from the sheet URL)
   - One row per region: tab name, gid, and column letters for timestamp / status / owner / category
5. Save, then refresh the dashboard.

You can also edit `data/team-dashboard-sources.json` directly (same fields).

## Sharing sheets

- **OAuth:** the signed-in Google user must be able to open the spreadsheet.
- **Service account:** set `GOOGLE_SERVICE_ACCOUNT_EMAIL` + `GOOGLE_PRIVATE_KEY` in `.env`, then share the spreadsheet with that email (Viewer is enough).

## Notes

- Review escalations / quality appeals sections still call their own APIs if those sheets are configured in the full CRM source files; they may show empty or errors until those sources exist. Core regional intake only needs the Source sheets config above.
- Do not zip real `.env` secrets or `data/overlay.db` when redistributing.
EOF

cat > "$DEST/SHARE_PACKAGING.txt" <<'EOF'
Team Dashboard — shareable copy
================================

Generated without secrets or local database files.

Before zipping:
  - Confirm .env has only placeholders
  - data/team-dashboard-sources.json should use YOUR_TEAM_SPREADSHEET_ID (or example values)

Coworker steps:
  1. Unzip
  2. Edit .env (Google OAuth)
  3. Open TeamDashboard.command (or npm install && npm run dev)
  4. Sign in → Source sheets → add regional tabs
EOF

# Scrub known production spreadsheet IDs from the copy defaults
if [[ "$(uname)" == "Darwin" ]]; then
  SED_INPLACE=(-i '')
else
  SED_INPLACE=(-i)
fi

sed "${SED_INPLACE[@]}" \
  's|1Kj8p-USf20vZREe-Cxg2c28vq4ppTwmgr05lYGxJebg|YOUR_TEAM_SPREADSHEET_ID|g' \
  "$DEST/src/lib/default-sheet-config.ts" \
  "$DEST/src/lib/team-dashboard-sources.ts" \
  "$DEST/data/team-dashboard-sources.json" \
  "$DEST/.env" \
  "$DEST/.env.example" 2>/dev/null || true

echo "Done."
echo
echo "Excluded: node_modules, .next, .git, secrets, overlay.db, sounds, extensions"
echo "Homepage wired to TeamDashboardShell + Source sheets tools"
echo
echo "Next steps:"
echo "  cd $(dirname "$DEST")"
echo "  zip -r TeamDashboard-share.zip $(basename "$DEST")"
echo
echo "See $DEST/TEAM_DASHBOARD_README.md"
