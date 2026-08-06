/**
 * Server-only: load host profile name maps from Google Sheets companion tabs.
 */
import {
  mergeHostProfileMaps,
  parseHostProfileTab,
  resolveProfileCompanionTitle,
  type HostProfileNameMap,
} from "./host-profiles";
import { fetchSheetTabsBatch, listSpreadsheetSheetTitles } from "./sheet-tabs";

export async function loadHostProfileMapForSheet(params: {
  spreadsheetId: string;
  intakeSheetName: string;
  region?: string;
}): Promise<{ sheetName: string | null; profiles: HostProfileNameMap }> {
  const titles = await listSpreadsheetSheetTitles(params.spreadsheetId);
  const titleList = titles.map((entry) => entry.title);
  const profileTitle = resolveProfileCompanionTitle(
    titleList,
    params.intakeSheetName,
    params.region
  );
  if (!profileTitle) return { sheetName: null, profiles: {} };

  const tabs = await fetchSheetTabsBatch(params.spreadsheetId, [
    { key: `profiles:${profileTitle}`, sheetName: profileTitle },
  ]);
  const tab = tabs.get(`profiles:${profileTitle}`);
  if (!tab) return { sheetName: profileTitle, profiles: {} };
  return { sheetName: profileTitle, profiles: parseHostProfileTab(tab) };
}

export async function loadHostProfileMapsForSources(params: {
  spreadsheetId: string;
  sources: Array<{ id: string; sheetName: string; region: string; spreadsheetId?: string }>;
}): Promise<{
  bySourceId: Record<string, HostProfileNameMap>;
  byRegion: Record<string, HostProfileNameMap>;
  merged: HostProfileNameMap;
  loadedSheetNames: string[];
  missingFor: string[];
}> {
  const bySourceId: Record<string, HostProfileNameMap> = {};
  const byRegion: Record<string, HostProfileNameMap> = {};
  const loadedSheetNames: string[] = [];
  const missingFor: string[] = [];

  const sourcesBySpreadsheet = new Map<string, typeof params.sources>();
  for (const source of params.sources) {
    const spreadsheetId = source.spreadsheetId?.trim() || params.spreadsheetId;
    const grouped = sourcesBySpreadsheet.get(spreadsheetId) ?? [];
    grouped.push(source);
    sourcesBySpreadsheet.set(spreadsheetId, grouped);
  }

  for (const [spreadsheetId, sources] of sourcesBySpreadsheet) {
    const titles = await listSpreadsheetSheetTitles(spreadsheetId);
    const titleList = titles.map((entry) => entry.title);
    const requests: Array<{ key: string; sheetName: string; sourceId: string; region: string }> =
      [];

    for (const source of sources) {
      const profileTitle = resolveProfileCompanionTitle(
        titleList,
        source.sheetName,
        source.region
      );
      if (!profileTitle) {
        missingFor.push(source.region);
        bySourceId[source.id] = {};
        continue;
      }
      requests.push({
        key: `profiles:${source.id}`,
        sheetName: profileTitle,
        sourceId: source.id,
        region: source.region,
      });
    }

    if (requests.length === 0) continue;
    const tabs = await fetchSheetTabsBatch(
      spreadsheetId,
      requests.map((request) => ({
        key: request.key,
        sheetName: request.sheetName,
      }))
    );

    for (const request of requests) {
      const tab = tabs.get(request.key);
      const profiles = tab ? parseHostProfileTab(tab) : {};
      bySourceId[request.sourceId] = profiles;
      byRegion[request.region] = mergeHostProfileMaps([
        byRegion[request.region] ?? {},
        profiles,
      ]);
      if (tab) loadedSheetNames.push(request.sheetName);
    }
  }

  return {
    bySourceId,
    byRegion,
    merged: mergeHostProfileMaps(Object.values(bySourceId)),
    loadedSheetNames: [...new Set(loadedSheetNames)],
    missingFor,
  };
}
