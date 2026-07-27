/**
 * Seed data/team-dashboard-sources.json from the CRM's hardcoded TEAM_TAB_SOURCES
 * and EXAMPLE_SPREADSHEET_ID. Used by create-team-dashboard-share.sh when no live
 * sources file exists on the exporter's machine.
 *
 * Usage: node scripts/seed-team-dashboard-sources.mjs <projectRoot>
 */
import fs from "fs";
import path from "path";

const destRoot = process.argv[2];
if (!destRoot) {
  console.error("Usage: node scripts/seed-team-dashboard-sources.mjs <projectRoot>");
  process.exit(1);
}

const defaultSheetConfig = fs.readFileSync(
  path.join(destRoot, "src/lib/default-sheet-config.ts"),
  "utf8"
);
const sourcesTs = fs.readFileSync(
  path.join(destRoot, "src/lib/team-dashboard-sources.ts"),
  "utf8"
);

const spreadsheetMatch = defaultSheetConfig.match(
  /EXAMPLE_SPREADSHEET_ID\s*=\s*"([^"]+)"/
);
const spreadsheetId = spreadsheetMatch?.[1];
if (!spreadsheetId) {
  console.error("Could not resolve EXAMPLE_SPREADSHEET_ID");
  process.exit(1);
}

const blockMatch = sourcesTs.match(
  /export const TEAM_TAB_SOURCES: TeamTabSource\[] = (\[[\s\S]*?\n\]);/
);
if (!blockMatch) {
  console.error("Could not parse TEAM_TAB_SOURCES");
  process.exit(1);
}

const sources = [];
const entryRe =
  /\{\s*id:\s*"([^"]+)",\s*region:\s*"([^"]+)",\s*sheetName:\s*"([^"]+)",\s*gid:\s*"([^"]+)",\s*columns:\s*cols\(\{\s*timestamp:\s*"([^"]+)",\s*status:\s*"([^"]+)",\s*owner:\s*"([^"]+)",\s*category:\s*"([^"]+)"\s*\}\)\s*,?\s*\}/g;

let match;
while ((match = entryRe.exec(blockMatch[1])) !== null) {
  const [, id, region, sheetName, gid, timestamp, status, owner, category] = match;
  sources.push({
    id,
    region,
    sheetName,
    gid,
    enabled: true,
    spreadsheetId,
    sheetUrl: `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit?gid=${gid}`,
    columns: { timestamp, status, owner, category },
  });
}

if (sources.length === 0) {
  console.error("Parsed zero TEAM_TAB_SOURCES entries");
  process.exit(1);
}

const outDir = path.join(destRoot, "data");
fs.mkdirSync(outDir, { recursive: true });
const outPath = path.join(outDir, "team-dashboard-sources.json");
fs.writeFileSync(outPath, `${JSON.stringify({ spreadsheetId, sources }, null, 2)}\n`);
console.log(`Seeded ${sources.length} regional sources from CRM defaults.`);
