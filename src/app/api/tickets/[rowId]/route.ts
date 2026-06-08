import { NextResponse } from "next/server";
import {
  updateTicketStatus,
  updateTicketSla,
  updateTicketSubject,
  loadSheetConfig,
} from "@/lib/overlay-db";
import { appendAdminNoteOnSheet, updateAirbnbUserIdOnSheet } from "@/lib/sheets";
import { parseTicketRowId } from "@/lib/types";

export async function PATCH(request: Request) {
  try {
    const body = await request.json();
    const { rowId, status, subject, appendAdminNote, airbnbUserId, slaHours } = body as {
      rowId: string;
      status?: string;
      subject?: string;
      appendAdminNote?: string;
      airbnbUserId?: string;
      slaHours?: number;
    };

    let updatedAdminNotes: string | undefined;

    if (!rowId) {
      return NextResponse.json({ error: "rowId is required" }, { status: 400 });
    }

    if (status) updateTicketStatus(rowId, status);
    if (typeof subject === "string") updateTicketSubject(rowId, subject);
    if (typeof appendAdminNote === "string" && appendAdminNote.trim()) {
      if (process.env.USE_MOCK_DATA === "true") {
        return NextResponse.json({ error: "Admin notes sync requires live sheet data" }, { status: 400 });
      }
      const config = loadSheetConfig("default");
      const parsed = parseTicketRowId(rowId);
      if (!config || !parsed) {
        return NextResponse.json({ error: "Sheet config or ticket row not found" }, { status: 400 });
      }
      updatedAdminNotes = await appendAdminNoteOnSheet(
        config,
        parsed.rowNumber,
        appendAdminNote.trim()
      );
    }
    if (typeof airbnbUserId === "string") {
      const useMock = process.env.USE_MOCK_DATA === "true";
      if (!useMock) {
        const config = loadSheetConfig("default");
        const parsed = parseTicketRowId(rowId);
        if (!config || !parsed) {
          return NextResponse.json({ error: "Sheet config or ticket row not found" }, { status: 400 });
        }
        await updateAirbnbUserIdOnSheet(config, parsed.rowNumber, airbnbUserId.trim());
      }
    }
    if (typeof slaHours === "number") {
      const slaDueAt = new Date(Date.now() + slaHours * 60 * 60 * 1000).toISOString();
      updateTicketSla(rowId, slaHours, slaDueAt);
    }

    return NextResponse.json({ ok: true, adminNotes: updatedAdminNotes });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Update failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
