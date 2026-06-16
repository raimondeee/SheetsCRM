import { NextResponse } from "next/server";
import { buildDefaultSheetConfig } from "@/lib/default-sheet-config";
import { loadSheetConfig, saveSheetConfig } from "@/lib/overlay-db";
import { fetchTicketsFromSheet, hasGoogleCredentials } from "@/lib/sheets";
import { getMockTickets } from "@/lib/mock-data";
import { migrateLegacyInitialResponseSla } from "@/lib/legacy-initial-sla-migration";
import { loadTimerSettings } from "@/lib/crm-preferences-store";
import { getSignedInUser } from "@/lib/google-auth";
import { runBackgroundGmailSyncForTickets } from "@/lib/background-gmail-sync";
import { archiveStaleGmailLinksForTickets } from "@/lib/gmail-link-archive";
import { mergeOverlayOntoTicket } from "@/lib/overlay-db";
import { enrichTicketsWithLastResponse } from "@/lib/tickets-enrich";
import { recordOpsAppEvent } from "@/lib/ops-metrics";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const NO_CACHE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate",
};

export async function GET() {
  const started = Date.now();
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
      const archivedCount = archiveStaleGmailLinksForTickets(tickets);
      if (archivedCount > 0) {
        tickets = tickets.map((ticket) =>
          mergeOverlayOntoTicket(ticket, undefined, timerSettings)
        );
      }
      tickets = await runBackgroundGmailSyncForTickets(tickets, timerSettings);
    }
    const legacySlaCleared = migrateLegacyInitialResponseSla(tickets);
    tickets = enrichTicketsWithLastResponse(tickets, timerSettings);

    recordOpsAppEvent({
      name: "ticket_list_refresh",
      ok: true,
      durationMs: Date.now() - started,
      detail: `${tickets.length} tickets · ${useMock ? "mock" : "sheets"}`,
    });

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
    recordOpsAppEvent({
      name: "ticket_list_refresh",
      ok: false,
      durationMs: Date.now() - started,
      error: message,
    });
    return NextResponse.json(
      { error: message, tickets: [], source: "error" },
      { status: 500, headers: NO_CACHE_HEADERS }
    );
  }
}
