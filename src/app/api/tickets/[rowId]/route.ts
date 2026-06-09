import { NextResponse } from "next/server";
import {
  updateTicketStatus,
  updateTicketSla,
  updateTicketSubject,
  updateTicketAirbnbUserId,
  updateTicketContactReason,
  loadSheetConfig,
} from "@/lib/overlay-db";
import { mapCrmStatusToSheetValue, normalizeStatusId } from "@/lib/status-mapper";
import {
  appendAdminNoteOnSheet,
  updateAirbnbUserIdOnSheet,
  updateContactReasonOnSheet,
  updateListingIdOnSheet,
  updateReservationCodeOnSheet,
  updateSheetStatusOnSheet,
} from "@/lib/sheets";
import { parseTicketRowId } from "@/lib/types";

export async function PATCH(request: Request) {
  try {
    const body = await request.json();
    const {
      rowId,
      status,
      subject,
      appendAdminNote,
      airbnbUserId,
      reservationCode,
      listingId,
      slaHours,
      contactReason,
    } = body as {
      rowId: string;
      status?: string;
      subject?: string;
      appendAdminNote?: string;
      airbnbUserId?: string;
      reservationCode?: string;
      listingId?: string;
      slaHours?: number;
      contactReason?: string;
    };

    let updatedAdminNotes: string | undefined;

    if (!rowId) {
      return NextResponse.json({ error: "rowId is required" }, { status: 400 });
    }

    if (status) {
      const normalizedStatus = normalizeStatusId(status);
      updateTicketStatus(rowId, normalizedStatus);
      const sheetStatusValue = mapCrmStatusToSheetValue(normalizedStatus);
      if (sheetStatusValue && process.env.USE_MOCK_DATA !== "true") {
        const config = loadSheetConfig("default");
        const parsed = parseTicketRowId(rowId);
        if (!config || !parsed) {
          return NextResponse.json({ error: "Sheet config or ticket row not found" }, { status: 400 });
        }
        await updateSheetStatusOnSheet(config, parsed.rowNumber, sheetStatusValue);
      }
    }
    if (typeof contactReason === "string") {
      const trimmed = contactReason.trim();
      if (process.env.USE_MOCK_DATA !== "true") {
        const config = loadSheetConfig("default");
        const parsed = parseTicketRowId(rowId);
        if (!config || !parsed) {
          return NextResponse.json({ error: "Sheet config or ticket row not found" }, { status: 400 });
        }
        await updateContactReasonOnSheet(config, parsed.rowNumber, trimmed);
      }
      updateTicketContactReason(rowId, trimmed);
    }
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
      updateTicketAirbnbUserId(rowId, airbnbUserId.trim());
    }
    if (typeof reservationCode === "string") {
      if (process.env.USE_MOCK_DATA !== "true") {
        const config = loadSheetConfig("default");
        const parsed = parseTicketRowId(rowId);
        if (!config || !parsed) {
          return NextResponse.json({ error: "Sheet config or ticket row not found" }, { status: 400 });
        }
        await updateReservationCodeOnSheet(config, parsed.rowNumber, reservationCode.trim());
      }
    }
    if (typeof listingId === "string") {
      if (process.env.USE_MOCK_DATA !== "true") {
        const config = loadSheetConfig("default");
        const parsed = parseTicketRowId(rowId);
        if (!config || !parsed) {
          return NextResponse.json({ error: "Sheet config or ticket row not found" }, { status: 400 });
        }
        await updateListingIdOnSheet(config, parsed.rowNumber, listingId.trim());
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
