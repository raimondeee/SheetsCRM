import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import path from "path";
import {
  DEFAULT_TEAM_DASHBOARD_SOURCES_FILE,
  normalizeTeamDashboardSourcesFile,
  teamSourceFromConfig,
  type TeamDashboardSourcesFile,
  type TeamTabSource,
} from "./team-dashboard-sources";

/** Server-only: read/write team dashboard source sheet config from disk. */

function sourcesFilePath(): string {
  const configured = process.env.TEAM_DASHBOARD_SOURCES_PATH?.trim();
  if (configured) {
    return path.isAbsolute(configured)
      ? configured
      : path.join(process.cwd(), configured);
  }
  return path.join(process.cwd(), "data", "team-dashboard-sources.json");
}

export function getTeamDashboardSourcesFile(): TeamDashboardSourcesFile {
  const filePath = sourcesFilePath();
  if (!existsSync(filePath)) {
    return structuredClone(DEFAULT_TEAM_DASHBOARD_SOURCES_FILE);
  }
  try {
    const raw = JSON.parse(readFileSync(filePath, "utf8")) as Partial<TeamDashboardSourcesFile>;
    return normalizeTeamDashboardSourcesFile(raw);
  } catch {
    return structuredClone(DEFAULT_TEAM_DASHBOARD_SOURCES_FILE);
  }
}

export function saveTeamDashboardSourcesFile(
  file: TeamDashboardSourcesFile
): TeamDashboardSourcesFile {
  const normalized = normalizeTeamDashboardSourcesFile(file);
  const filePath = sourcesFilePath();
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
  return normalized;
}

export function getTeamTabSources(): TeamTabSource[] {
  return getTeamDashboardSourcesFile().sources.map(teamSourceFromConfig);
}

export function getTeamSpreadsheetId(): string {
  return getTeamDashboardSourcesFile().spreadsheetId;
}
