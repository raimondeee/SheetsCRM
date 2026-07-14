import { NextResponse } from "next/server";
import {
  coverSourceLabelForTicketRow,
  isCoverSheetTicketRow,
} from "@/lib/cover-sheets";
import { loadTimerSettings } from "@/lib/crm-preferences-store";
import { getSignedInUser } from "@/lib/google-auth";
import {
  loadCoverSheets,
  loadSheetConfig,
  resyncCoverTicketOverlayFromSheet,
  resolveSheetConfigForRowId,
} from "@/lib/overlay-db";
import { fetchTicketFromSheetRow } from "@/lib/sheets";
import { enrichTicketsWithLastResponse } from "@/lib/tickets-enrich";
import { parseTicketRowId } from "@/lib/types";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ rowId: string }> }
) {
  try {
    if (process.env.USE_MOCK_DATA === "true") {
      return NextResponse.json(
        { error: "Resync from sheet requires live sheet data" },
        { status: 400 }
      );
    }

    const { rowId } = await params;
    const ticketRowId = decodeURIComponent(rowId);
    const defaultConfig = loadSheetConfig("default");
    const coverSheets = loadCoverSheets();

    if (!isCoverSheetTicketRow(ticketRowId, defaultConfig, coverSheets)) {
      return NextResponse.json(
        { error: "Resync from sheet is only available for enabled teammate cover tickets." },
        { status: 400 }
      );
    }

    const config = resolveSheetConfigForRowId(ticketRowId, defaultConfig);
    const parsed = parseTicketRowId(ticketRowId);
    if (!config || !parsed) {
      return NextResponse.json({ error: "Ticket row or sheet config not found" }, { status: 404 });
    }

    const { email } = await getSignedInUser();
    const timerSettings = loadTimerSettings(email);
    const coverSourceLabel = coverSourceLabelForTicketRow(ticketRowId, coverSheets);

    const freshTicket = await fetchTicketFromSheetRow(
      config,
      parsed.rowNumber,
      timerSettings,
      { coverSourceLabel }
    );
    if (!freshTicket) {
      return NextResponse.json(
        { error: "Could not read this row from the teammate sheet" },
        { status: 404 }
      );
    }

    const resynced = resyncCoverTicketOverlayFromSheet(freshTicket, timerSettings);
    const [ticket] = enrichTicketsWithLastResponse([resynced], timerSettings);

    return NextResponse.json({ ok: true, ticket });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to resync from sheet";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
