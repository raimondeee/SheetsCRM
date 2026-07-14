import { NextResponse } from "next/server";
import { normalizeDashboardPeriod } from "@/lib/dashboard-period";
import { buildQualityAppealMetrics } from "@/lib/dispute-appeal-stats";
import {
  loadQualityAppealsSheetTab,
  parseQualityAppealRecords,
} from "@/lib/quality-report-loader";
import { getSignedInUser } from "@/lib/google-auth";
import { hasGoogleCredentials } from "@/lib/sheets";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: Request) {
  const user = await getSignedInUser();
  if (!user.email && !(await hasGoogleCredentials())) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const url = new URL(request.url);
  const period = normalizeDashboardPeriod(url.searchParams.get("period"));
  const agentFilterRaw = url.searchParams.get("agent")?.trim() || "all";
  const agentFilter = agentFilterRaw === "" ? "all" : agentFilterRaw;

  try {
    const tab = await loadQualityAppealsSheetTab();
    const metrics = buildQualityAppealMetrics({
      appeals: parseQualityAppealRecords(tab),
      period,
      agentFilter,
    });

    return NextResponse.json(metrics, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load quality appeals";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
