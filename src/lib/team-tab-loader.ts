import { getTeamDashboardSourcesFile } from "@/lib/team-dashboard-sources-store";
import {
  teamSourceFromConfig,
  type TeamTabColumnLetters,
  type TeamTabSource,
} from "@/lib/team-dashboard-sources";
import { fetchSheetTabsBatch } from "@/lib/sheet-tabs";
import { parseTeamTab, type TeamIntakeRecord } from "@/lib/team-metrics";
import {
  resolveAndAssessTeamTab,
  type TeamSourceMappingHealth,
} from "@/lib/team-column-resolve";
import { indexToLetter } from "@/lib/types";

export interface ColleagueTeamLoadResult {
  colleagueRecords: TeamIntakeRecord[];
  sourcesLoaded: number;
  sourcesTotal: number;
  loadError: string | null;
  /** Header/data mapping warnings for the Team Dashboard banner. */
  mappingWarnings: string[];
  sourceHealth: TeamSourceMappingHealth[];
}

function fallbackLettersFromSource(source: TeamTabSource): TeamTabColumnLetters {
  return {
    timestamp: indexToLetter(source.columns.timestamp),
    status: indexToLetter(source.columns.status),
    owner: indexToLetter(source.columns.owner),
    category: indexToLetter(source.columns.category),
  };
}

/** Load enabled, read-only regional sources for the Team Dashboard. */
export async function loadColleagueTeamRecords(): Promise<ColleagueTeamLoadResult> {
  const config = getTeamDashboardSourcesFile();
  const sources = config.sources
    .filter((source) => source.enabled !== false)
    .map((source) => ({
      config: source,
      source: teamSourceFromConfig(source),
      spreadsheetId: source.spreadsheetId?.trim() || config.spreadsheetId,
    }));
  const sourcesTotal = sources.length;
  let colleagueRecords: TeamIntakeRecord[] = [];
  let sourcesLoaded = 0;
  let loadError: string | null = null;
  const mappingWarnings: string[] = [];
  const sourceHealth: TeamSourceMappingHealth[] = [];

  try {
    const sourcesBySpreadsheet = new Map<string, typeof sources>();
    for (const source of sources) {
      const grouped = sourcesBySpreadsheet.get(source.spreadsheetId) ?? [];
      grouped.push(source);
      sourcesBySpreadsheet.set(source.spreadsheetId, grouped);
    }
    for (const [spreadsheetId, groupedSources] of sourcesBySpreadsheet) {
      if (!spreadsheetId || !groupedSources) continue;
      const tabs = await fetchSheetTabsBatch(
        spreadsheetId,
        groupedSources.map((entry) => ({
          key: entry.source.id,
          sheetName: entry.source.sheetName,
          gid: entry.source.gid,
        }))
      );

      for (const entry of groupedSources) {
        const tab = tabs.get(entry.source.id);
        if (!tab) {
          if (!loadError) {
            loadError = `Sheet tab not found: ${entry.source.sheetName}`;
          }
          mappingWarnings.push(
            `${entry.source.region}: sheet tab not found (${entry.source.sheetName}).`
          );
          continue;
        }

        const health = resolveAndAssessTeamTab(
          entry.source,
          tab,
          entry.config.columns ?? fallbackLettersFromSource(entry.source)
        );
        sourceHealth.push(health);
        mappingWarnings.push(...health.warnings);
        colleagueRecords = colleagueRecords.concat(
          parseTeamTab(entry.source, tab, health.resolution.columns)
        );
        sourcesLoaded += 1;
      }
    }
  } catch (error) {
    loadError = error instanceof Error ? error.message : "Failed to load team sheet tabs";
  }

  return {
    colleagueRecords,
    sourcesLoaded,
    sourcesTotal,
    loadError,
    mappingWarnings,
    sourceHealth,
  };
}

export { type TeamTabSource };
