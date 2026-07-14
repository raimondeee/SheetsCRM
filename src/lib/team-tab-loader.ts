import {
  TEAM_SPREADSHEET_ID,
  TEAM_TAB_SOURCES,
  type TeamTabSource,
} from "@/lib/team-dashboard-sources";
import { fetchSheetTabsBatch } from "@/lib/sheet-tabs";
import { parseTeamTab, type TeamIntakeRecord } from "@/lib/team-metrics";

export interface ColleagueTeamLoadResult {
  colleagueRecords: TeamIntakeRecord[];
  sourcesLoaded: number;
  sourcesTotal: number;
  loadError: string | null;
}

export async function loadColleagueTeamRecords(): Promise<ColleagueTeamLoadResult> {
  const sourcesTotal = TEAM_TAB_SOURCES.length;
  let colleagueRecords: TeamIntakeRecord[] = [];
  let sourcesLoaded = 0;
  let loadError: string | null = null;

  try {
    const tabs = await fetchSheetTabsBatch(
      TEAM_SPREADSHEET_ID,
      TEAM_TAB_SOURCES.map((source) => ({
        key: source.id,
        sheetName: source.sheetName,
        gid: source.gid,
      }))
    );

    for (const source of TEAM_TAB_SOURCES) {
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

export { TEAM_TAB_SOURCES, type TeamTabSource };
