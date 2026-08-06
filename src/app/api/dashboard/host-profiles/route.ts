import { NextResponse } from "next/server";
import { buildDefaultSheetConfig } from "@/lib/default-sheet-config";
import { LOCAL_HOST_PROFILES_SHEET } from "@/lib/host-profiles";
import { loadHostProfileMapForSheet } from "@/lib/host-profiles-loader";
import { LOCAL_TEAM_REGION } from "@/lib/team-dashboard-sources";
import { loadSheetConfig } from "@/lib/overlay-db";
import { hasGoogleCredentials } from "@/lib/sheets";
import { requireOAuthSession } from "@/lib/api-auth";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/** Load the local CRM spreadsheet's Dashboard Sheet Profiles map for personal dashboard. */
export async function GET() {
  const denied = await requireOAuthSession();
  if (denied) return denied;

  const hasAuth = await hasGoogleCredentials();
  const useMock = process.env.USE_MOCK_DATA === "true";
  if (useMock || !hasAuth) {
    return NextResponse.json({
      profiles: {},
      sheetName: null,
      region: LOCAL_TEAM_REGION,
    });
  }

  let config = loadSheetConfig("default");
  if (!config) config = buildDefaultSheetConfig();

  try {
    const loaded = await loadHostProfileMapForSheet({
      spreadsheetId: config.spreadsheetId,
      intakeSheetName: config.sheetName || "Form Responses",
      region: LOCAL_TEAM_REGION,
    });
    return NextResponse.json(
      {
        profiles: loaded.profiles,
        sheetName: loaded.sheetName ?? LOCAL_HOST_PROFILES_SHEET,
        region: LOCAL_TEAM_REGION,
        profileCount: Object.keys(loaded.profiles).length,
      },
      { headers: { "Cache-Control": "private, max-age=60" } }
    );
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to load host profiles",
      },
      { status: 500 }
    );
  }
}
