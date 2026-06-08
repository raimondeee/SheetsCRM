import { NextResponse } from "next/server";
import { buildDefaultSheetConfig } from "@/lib/default-sheet-config";
import { loadSheetConfig, saveSheetConfig } from "@/lib/overlay-db";
import { fetchTicketsFromSheet, hasGoogleCredentials } from "@/lib/sheets";
import { getMockTickets } from "@/lib/mock-data";
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
    let tickets = useMock ? getMockTickets() : await fetchTicketsFromSheet(config);
    tickets = enrichTicketsWithLastResponse(tickets);

    return NextResponse.json(
      {
        tickets,
        config,
        source: useMock ? "mock" : "sheets",
        hasCredentials: hasAuth,
        syncedAt: new Date().toISOString(),
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
