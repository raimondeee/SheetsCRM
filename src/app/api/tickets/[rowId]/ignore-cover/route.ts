import { NextResponse } from "next/server";
import { isCoverSheetTicketRow } from "@/lib/cover-sheets";
import { loadTimerSettings } from "@/lib/crm-preferences-store";
import { getSignedInUser } from "@/lib/google-auth";
import {
  ignoreCoverTicket,
  loadCoverSheets,
  loadSheetConfig,
} from "@/lib/overlay-db";
import { parseTicketRowId } from "@/lib/types";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ rowId: string }> }
) {
  try {
    const { rowId } = await params;
    const ticketRowId = decodeURIComponent(rowId);
    const defaultConfig = loadSheetConfig("default");
    const coverSheets = loadCoverSheets();

    if (!isCoverSheetTicketRow(ticketRowId, defaultConfig, coverSheets)) {
      return NextResponse.json(
        { error: "Ignore is only available for enabled teammate cover tickets." },
        { status: 400 }
      );
    }

    if (!parseTicketRowId(ticketRowId)) {
      return NextResponse.json({ error: "Invalid ticket row id" }, { status: 400 });
    }

    const { email } = await getSignedInUser();
    const timerSettings = loadTimerSettings(email);
    const result = ignoreCoverTicket(ticketRowId, timerSettings);

    return NextResponse.json({
      ok: true,
      status: result.status,
      statusChangedAt: result.statusChangedAt,
      slaDueAt: result.slaDueAt,
      sheetSyncQueued: false,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to ignore cover ticket";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
