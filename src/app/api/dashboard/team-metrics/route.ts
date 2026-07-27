import { NextResponse } from "next/server";
import { loadColleagueTeamRecords } from "@/lib/team-tab-loader";
import { hasGoogleCredentials } from "@/lib/sheets";
import { getSignedInUser } from "@/lib/google-auth";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  const user = await getSignedInUser();
  if (!user.email && !(await hasGoogleCredentials())) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const hasAuth = await hasGoogleCredentials();
  const useMock = process.env.USE_MOCK_DATA === "true" || !hasAuth;

  if (useMock) {
    return NextResponse.json(
      {
        colleagueRecords: [],
        sourcesLoaded: 0,
        sourcesTotal: 6,
        partialError: null,
        mappingWarnings: [],
      },
      { headers: { "Cache-Control": "private, max-age=60" } }
    );
  }

  const { colleagueRecords, sourcesLoaded, sourcesTotal, loadError, mappingWarnings } =
    await loadColleagueTeamRecords();

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
    },
    { headers: { "Cache-Control": "private, max-age=60" } }
  );
}
