import { getTeamDashboardSourcesFile } from "@/lib/team-dashboard-sources-store";
import { teamSourceFromConfig, type TeamTabSource } from "@/lib/team-dashboard-sources";
import { fetchSheetTabsBatch } from "@/lib/sheet-tabs";
import { parseTeamTab, type TeamIntakeRecord } from "@/lib/team-metrics";

export interface ColleagueTeamLoadResult {
  colleagueRecords: TeamIntakeRecord[];
  sourcesLoaded: number;
  sourcesTotal: number;
  loadError: string | null;
}

/** Load enabled, read-only regional sources for the Team Dashboard. */
export async function loadColleagueTeamRecords(): Promise<ColleagueTeamLoadResult> {
  const config = getTeamDashboardSourcesFile();
  const sources = config.sources
    .filter((source) => source.enabled !== false)
    .map((source) => ({
      source: teamSourceFromConfig(source),
      spreadsheetId: source.spreadsheetId?.trim() || config.spreadsheetId,
    }));
  const sourcesTotal = sources.length;
  let colleagueRecords: TeamIntakeRecord[] = [];
  let sourcesLoaded = 0;
  let loadError: string | null = null;

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
        groupedSources.map((source) => ({
          key: source.source.id,
          sheetName: source.source.sheetName,
          gid: source.source.gid,
        }))
      );

      for (const source of groupedSources) {
        const tab = tabs.get(source.source.id);
        if (!tab) {
          if (!loadError) {
            loadError = `Sheet tab not found: ${source.source.sheetName}`;
          }
          continue;
        }
        colleagueRecords = colleagueRecords.concat(parseTeamTab(source.source, tab));
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
  };
}

export { type TeamTabSource };
