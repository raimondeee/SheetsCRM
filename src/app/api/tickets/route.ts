/**
 * GET /api/tickets — primary ticket list load for CrmShell.
 *
 * Side effects on refresh (not a pure read):
 * - Ensures default SheetConfig exists
 * - Merges enabled cover-sheet tickets
 * - Migrates legacy SLA rows, refreshes holiday cache
 * - Queues background Gmail sync + archives stale Gmail links
 * - Enriches last-response timestamps from overlay thread cache
 *
 * Mock path: USE_MOCK_DATA=true or missing Google credentials.
 */
import { NextResponse } from "next/server";
import { buildDefaultSheetConfig } from "@/lib/default-sheet-config";
import { refreshWorkspaceHolidayCache } from "@/lib/business-holidays";
import { loadSheetConfig, saveSheetConfig, loadCoverSheets } from "@/lib/overlay-db";
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
import {
  coverSourceLabelForEntry,
  listEnabledCoverSheetEntries,
} from "@/lib/cover-sheets";
import { prepareSheetConfig } from "@/lib/ui-field-slots";

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
    const coverSheets = loadCoverSheets();
    await refreshWorkspaceHolidayCache();

    let tickets = useMock ? getMockTickets(timerSettings) : [];
    let mappingWarnings: string[] = [];

    if (!useMock) {
      const primary = await fetchTicketsFromSheet(config, timerSettings, {
        label: "Intake sheet",
      });
      tickets = primary.tickets;
      mappingWarnings = [...primary.mappingWarnings];

      const enabledCoverSheets = listEnabledCoverSheetEntries(coverSheets);
      if (enabledCoverSheets.length > 0) {
        const ownRowIds = new Set(tickets.map((ticket) => ticket.rowId));
        for (const entry of enabledCoverSheets) {
          if (!entry.config) continue;
          const coverConfig = prepareSheetConfig(entry.config);
          const label = coverSourceLabelForEntry(entry);
          const cover = await fetchTicketsFromSheet(coverConfig, timerSettings, {
            label: `Cover: ${label}`,
          });
          mappingWarnings.push(...cover.mappingWarnings);
          for (const ticket of cover.tickets) {
            if (ownRowIds.has(ticket.rowId)) continue;
            tickets.push({ ...ticket, coverSourceLabel: label });
          }
        }
      }
      const archivedCount = archiveStaleGmailLinksForTickets(
        tickets,
        timerSettings.resolvedGmailLinkArchiveDays
      );
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
        coverSheets,
        source: useMock ? "mock" : "sheets",
        hasCredentials: hasAuth,
        syncedAt: new Date().toISOString(),
        mappingWarnings,
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
