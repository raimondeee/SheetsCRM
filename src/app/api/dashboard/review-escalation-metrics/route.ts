import { NextResponse } from "next/server";
import { normalizeDashboardPeriod } from "@/lib/dashboard-period";
import { buildReviewEscalationMetrics } from "@/lib/dispute-appeal-stats";
import {
  loadReviewEscalationSheetTab,
  parseReviewEscalationRecords,
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
  const marketManagerRaw = url.searchParams.get("marketManager")?.trim() || "all";
  const marketManager = marketManagerRaw === "" ? "all" : marketManagerRaw;

  const teamFilterRaw = url.searchParams.get("team")?.trim() || "all";
  const teamFilter = teamFilterRaw === "" ? "all" : teamFilterRaw;

  try {
    const tab = await loadReviewEscalationSheetTab();
    const metrics = buildReviewEscalationMetrics({
      disputes: parseReviewEscalationRecords(tab),
      period,
      marketManager,
      teamFilter,
    });

    return NextResponse.json(metrics, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load review escalations";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
