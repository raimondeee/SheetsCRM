import { NextResponse } from "next/server";
import { buildDefaultSheetConfig } from "@/lib/default-sheet-config";
import { loadSheetConfig, saveSheetConfig } from "@/lib/overlay-db";
import { fetchTicketsFromSheet, hasGoogleCredentials } from "@/lib/sheets";
import { getMockTickets } from "@/lib/mock-data";
import { migrateLegacyInitialResponseSla } from "@/lib/legacy-initial-sla-migration";
import { loadTimerSettings } from "@/lib/crm-preferences-store";
import { getSignedInUser } from "@/lib/google-auth";
import { runBackgroundGmailSyncForTickets } from "@/lib/background-gmail-sync";
import { enrichTicketsWithLastResponse } from "@/lib/tickets-enrich";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const NO_CACHE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate",
};

export async function GET() {
  try {
    let config = loadSheetConfig("default");
    if (!config) {
      config = buildDefaultSheetConfig();
      saveSheetConfig(config);
    }

    const hasAuth = await hasGoogleCredentials();
    const useMock = process.env.USE_MOCK_DATA === "true" || !hasAuth;
    const { email } = await getSignedInUser();
    const timerSettings = loadTimerSettings(email);
    let tickets = useMock
      ? getMockTickets(timerSettings)
      : await fetchTicketsFromSheet(config, timerSettings);
    if (!useMock) {
      tickets = await runBackgroundGmailSyncForTickets(tickets, timerSettings);
    }
    const legacySlaCleared = migrateLegacyInitialResponseSla(tickets);
    tickets = enrichTicketsWithLastResponse(tickets, timerSettings);

    return NextResponse.json(
      {
        tickets,
        config,
        source: useMock ? "mock" : "sheets",
        hasCredentials: hasAuth,
        syncedAt: new Date().toISOString(),
        legacyInitialSlaCleared: legacySlaCleared > 0 ? legacySlaCleared : undefined,
      },
      { headers: NO_CACHE_HEADERS }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load tickets";
    return NextResponse.json(
      { error: message, tickets: [], source: "error" },
      { status: 500, headers: NO_CACHE_HEADERS }
    );
  }
}
