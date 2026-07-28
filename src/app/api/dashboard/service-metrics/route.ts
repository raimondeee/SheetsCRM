import { NextResponse } from "next/server";
import { buildDefaultSheetConfig } from "@/lib/default-sheet-config";
import { loadTimerSettings } from "@/lib/crm-preferences-store";
import { normalizeDashboardPeriod } from "@/lib/dashboard-period";
import { refreshWorkspaceHolidayCache } from "@/lib/business-holidays";
import { loadSheetConfig } from "@/lib/overlay-db";
import { buildServiceMetrics } from "@/lib/service-metrics";
import { fetchTicketsFromSheet, hasGoogleCredentials } from "@/lib/sheets";
import { getMockTickets } from "@/lib/mock-data";
import { getSignedInUser } from "@/lib/google-auth";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: Request) {
  const user = await getSignedInUser();
  if (!user.email && !(await hasGoogleCredentials())) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const url = new URL(request.url);
  const period = normalizeDashboardPeriod(url.searchParams.get("period"));
  const marketManager = url.searchParams.get("marketManager")?.trim() || "all";

  let config = loadSheetConfig("default");
  if (!config) config = buildDefaultSheetConfig();

  const hasAuth = await hasGoogleCredentials();
  const useMock = process.env.USE_MOCK_DATA === "true" || !hasAuth;
  const timerSettings = loadTimerSettings(user.email);

  await refreshWorkspaceHolidayCache();

  const tickets = useMock
    ? getMockTickets(timerSettings)
    : (await fetchTicketsFromSheet(config, timerSettings)).tickets;

  const metrics = buildServiceMetrics({
    tickets,
    period,
    marketManager: marketManager === "all" ? "all" : marketManager,
    sheetConfig: config,
    initialResponseTargetHours: timerSettings.initialResponseHours,
  });

  return NextResponse.json(metrics, {
    headers: { "Cache-Control": "no-store" },
  });
}
