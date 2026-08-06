import { NextResponse } from "next/server";
import { getTeamDashboardSourcesFile } from "@/lib/team-dashboard-sources-store";
import { loadColleagueTeamRecords } from "@/lib/team-tab-loader";
import { hasGoogleCredentials } from "@/lib/sheets";
import { requireOAuthSession } from "@/lib/api-auth";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  const denied = await requireOAuthSession();
  if (denied) return denied;

  const hasAuth = await hasGoogleCredentials();
  const useMock = process.env.USE_MOCK_DATA === "true";
  const statusMappings = getTeamDashboardSourcesFile().statusMappings ?? {};

  if (useMock || !hasAuth) {
    return NextResponse.json(
      {
        colleagueRecords: [],
        sourcesLoaded: 0,
        sourcesTotal: 6,
        partialError: null,
        mappingWarnings: [],
        statusMappings,
        hostProfiles: {},
        hostProfilesLoaded: 0,
        hostProfileSheetNames: [],
      },
      { headers: { "Cache-Control": "private, max-age=60" } }
    );
  }

  const {
    colleagueRecords,
    sourcesLoaded,
    sourcesTotal,
    loadError,
    mappingWarnings,
    hostProfiles,
    hostProfilesLoaded,
    hostProfileSheetNames,
  } = await loadColleagueTeamRecords();

  if (sourcesLoaded === 0 && loadError) {
    return NextResponse.json({ error: loadError }, { status: 500 });
  }

  return NextResponse.json(
    {
      colleagueRecords,
      sourcesLoaded,
      sourcesTotal,
      partialError:
        sourcesLoaded > 0 && sourcesLoaded < sourcesTotal ? loadError : null,
      mappingWarnings,
      statusMappings,
      hostProfiles,
      hostProfilesLoaded,
      hostProfileSheetNames,
    },
    { headers: { "Cache-Control": "private, max-age=60" } }
  );
}
