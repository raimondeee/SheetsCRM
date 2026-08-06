import { NextResponse } from "next/server";
import {
  getTeamDashboardSourcesFile,
  saveTeamDashboardSourcesFile,
} from "@/lib/team-dashboard-sources-store";
import {
  normalizeTeamDashboardSourcesFile,
  type TeamDashboardSourcesFile,
} from "@/lib/team-dashboard-sources";
import { requireOAuthSession } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

export async function GET() {
  const denied = await requireOAuthSession();
  if (denied) return denied;

  const config = getTeamDashboardSourcesFile();
  return NextResponse.json({
    config,
    path: process.env.TEAM_DASHBOARD_SOURCES_PATH?.trim() || "./data/team-dashboard-sources.json",
  });
}

export async function PUT(request: Request) {
  const denied = await requireOAuthSession();
  if (denied) return denied;

  let body: { config?: Partial<TeamDashboardSourcesFile> };
  try {
    body = (await request.json()) as { config?: Partial<TeamDashboardSourcesFile> };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const normalized = normalizeTeamDashboardSourcesFile(body.config);
  if (!normalized.spreadsheetId.trim()) {
    return NextResponse.json({ error: "spreadsheetId is required" }, { status: 400 });
  }
  if (normalized.sources.length === 0) {
    return NextResponse.json({ error: "Add at least one source sheet" }, { status: 400 });
  }

  const saved = saveTeamDashboardSourcesFile(normalized);
  return NextResponse.json({ ok: true, config: saved });
}
