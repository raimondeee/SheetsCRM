import { NextResponse } from "next/server";
import { getSignedInUser } from "@/lib/google-auth";
import { hasGoogleCredentials } from "@/lib/sheets";
import { fetchSheetTabsBatch } from "@/lib/sheet-tabs";
import {
  resolveAndAssessTeamTab,
  type TeamSourceMappingHealth,
} from "@/lib/team-column-resolve";
import {
  getTeamDashboardSourcesFile,
} from "@/lib/team-dashboard-sources-store";
import { teamSourceFromConfig, type TeamTabColumnLetters } from "@/lib/team-dashboard-sources";

export const dynamic = "force-dynamic";

interface DetectBody {
  /** Detect one source */
  spreadsheetId?: string;
  sheetName?: string;
  gid?: string;
  region?: string;
  id?: string;
  columns?: TeamTabColumnLetters;
  /** When true, detect every enabled source from saved config */
  all?: boolean;
}

export async function POST(request: Request) {
  const user = await getSignedInUser();
  if (!user.email && !(await hasGoogleCredentials())) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  let body: DetectBody;
  try {
    body = (await request.json()) as DetectBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const config = getTeamDashboardSourcesFile();

  try {
    if (body.all) {
      const enabled = config.sources.filter((source) => source.enabled !== false);
      const bySpreadsheet = new Map<string, typeof enabled>();
      for (const source of enabled) {
        const spreadsheetId = source.spreadsheetId?.trim() || config.spreadsheetId;
        const list = bySpreadsheet.get(spreadsheetId) ?? [];
        list.push(source);
        bySpreadsheet.set(spreadsheetId, list);
      }

      const results: Array<{
        sourceId: string;
        region: string;
        columns: TeamTabColumnLetters;
        headers: string[];
        health: TeamSourceMappingHealth;
      }> = [];

      for (const [spreadsheetId, sources] of bySpreadsheet) {
        if (!spreadsheetId) continue;
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
            results.push({
              sourceId: source.id,
              region: source.region,
              columns: source.columns,
              headers: [],
              health: {
                sourceId: source.id,
                region: source.region,
                sheetName: source.sheetName,
                warnings: [`${source.region}: sheet tab not found.`],
                resolution: {
                  columns: teamSourceFromConfig(source).columns,
                  letters: source.columns,
                  matchedBy: {
                    timestamp: "fallback",
                    status: "fallback",
                    owner: "fallback",
                    category: "fallback",
                  },
                  matchedHeaders: {},
                  letterDrift: {},
                  warnings: [],
                },
              },
            });
            continue;
          }
          const teamSource = teamSourceFromConfig(source);
          const health = resolveAndAssessTeamTab(teamSource, tab, source.columns);
          results.push({
            sourceId: source.id,
            region: source.region,
            columns: health.resolution.letters,
            headers: tab.headers,
            health,
          });
        }
      }

      return NextResponse.json({ results });
    }

    const spreadsheetId =
      body.spreadsheetId?.trim() || config.spreadsheetId;
    const sheetName = body.sheetName?.trim() || "";
    const gid = body.gid?.trim() || "";
    if (!spreadsheetId || (!sheetName && !gid)) {
      return NextResponse.json(
        { error: "spreadsheetId and sheetName or gid are required" },
        { status: 400 }
      );
    }

    const key = body.id?.trim() || "detect";
    const tabs = await fetchSheetTabsBatch(spreadsheetId, [
      { key, sheetName: sheetName || undefined, gid: gid || undefined },
    ]);
    const tab = tabs.get(key);
    if (!tab) {
      return NextResponse.json({ error: "Sheet tab not found" }, { status: 404 });
    }

    const fallback: TeamTabColumnLetters = body.columns ?? {
      timestamp: "A",
      status: "B",
      owner: "C",
      category: "D",
    };
    const teamSource = teamSourceFromConfig({
      id: key,
      region: body.region?.trim() || "Source",
      sheetName: sheetName || tab.sheetName,
      gid,
      enabled: true,
      spreadsheetId,
      columns: fallback,
    });
    const health = resolveAndAssessTeamTab(teamSource, tab, fallback);

    return NextResponse.json({
      columns: health.resolution.letters,
      headers: tab.headers,
      matchedHeaders: health.resolution.matchedHeaders,
      matchedBy: health.resolution.matchedBy,
      letterDrift: health.resolution.letterDrift,
      warnings: health.warnings,
      health,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to detect columns";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
