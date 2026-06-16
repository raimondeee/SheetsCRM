import { NextResponse } from "next/server";
import {
  appendAdminNoteToOverlay,
  clearInitialResponseSla,
  getTicketOverlay,
  updateTicketStatus,
  updateTicketSla,
  updateTicketSubject,
  updateTicketAirbnbUserId,
  updateTicketContactReason,
  updateTicketLinkedCase,
  loadSheetConfig,
} from "@/lib/overlay-db";
import { hasAirbnbUserIdForResolve } from "@/lib/ticket-action-validation";
import {
  crmStatusLabel,
  mapCrmStatusToSheetValue,
  normalizeStatusId,
} from "@/lib/status-mapper";
import {
  updateAirbnbUserIdOnSheet,
  updateContactReasonOnSheet,
  updateListingIdOnSheet,
  updateReservationCodeOnSheet,
  updateSheetStatusOnSheet,
  updateTicketHeaderFieldOnSheet,
  updateUiFieldOnSheet,
  writeCaseSummaryOnSheet,
} from "@/lib/sheets";
import { resolveUiFieldColumn } from "@/lib/ui-field-slots";
import { loadTimerSettings } from "@/lib/crm-preferences-store";
import { markTicketGmailThreadAsRead } from "@/lib/gmail";
import { getSignedInUser } from "@/lib/google-auth";
import { parseTicketRowId } from "@/lib/types";
import type { SheetConfig } from "@/lib/types";

function queueSheetSync(label: string, task: () => Promise<void>): void {
  void task().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[SheetsCRM sheet sync] ${label}:`, message);
  });
}

function sheetContext(rowId: string): {
  config: SheetConfig | null;
  rowNumber: number | null;
} {
  if (process.env.USE_MOCK_DATA === "true") {
    return { config: null, rowNumber: null };
  }
  const config = loadSheetConfig("default");
  const parsed = parseTicketRowId(rowId);
  return {
    config: config ?? null,
    rowNumber: parsed?.rowNumber ?? null,
  };
}

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
      headerField,
      uiFieldSlotId,
      uiFieldValue,
      slaHours,
      contactReason,
      clearInitialResponseSla: clearInitialResponseSlaFlag,
      linkedCaseIndex,
      linkedCaseUrl,
      intakeTimestamp,
      requesterEmail,
      pendingReopenHours,
    } = body as {
      rowId: string;
      status?: string;
      subject?: string;
      appendAdminNote?: string;
      airbnbUserId?: string;
      reservationCode?: string;
      listingId?: string;
      headerField?: string;
      uiFieldSlotId?: string;
      uiFieldValue?: string;
      slaHours?: number;
      contactReason?: string;
      clearInitialResponseSla?: boolean;
      linkedCaseIndex?: number;
      linkedCaseUrl?: string;
      intakeTimestamp?: string;
      requesterEmail?: string;
      pendingReopenHours?: number | null;
    };

    let updatedAdminNotes: string | undefined;
    let updatedStatus: string | undefined;
    let updatedSheetStatus: string | undefined;
    let updatedStatusChangedAt: string | null | undefined;
    let updatedSlaDueAt: string | null | undefined;

    if (!rowId) {
      return NextResponse.json({ error: "rowId is required" }, { status: 400 });
    }

    const { config, rowNumber } = sheetContext(rowId);
    const canSyncSheet = Boolean(config && rowNumber);

    if (status) {
      const normalizedStatus = normalizeStatusId(status);
      if (normalizedStatus === "resolved") {
        const pendingUserId =
          typeof airbnbUserId === "string" ? airbnbUserId.trim() : "";
        const overlay = getTicketOverlay(rowId);
        const resolvedUserId = pendingUserId || overlay.crmAirbnbUserId?.trim() || "";
        if (!hasAirbnbUserIdForResolve(resolvedUserId)) {
          return NextResponse.json(
            { error: "Airbnb User ID is required before marking resolved." },
            { status: 400 }
          );
        }
      }
      const { email } = await getSignedInUser();
      const timerSettings = loadTimerSettings(email);
      const timerFields = updateTicketStatus(
        rowId,
        normalizedStatus,
        timerSettings,
        intakeTimestamp,
        typeof pendingReopenHours === "number"
          ? { pendingReopenHours }
          : undefined
      );
      updatedStatus = normalizedStatus;
      updatedStatusChangedAt = timerFields.statusChangedAt;
      updatedSlaDueAt = timerFields.slaDueAt;
      updatedSheetStatus = crmStatusLabel(normalizedStatus);

      const sheetStatusValue = mapCrmStatusToSheetValue(normalizedStatus);
      if (sheetStatusValue && canSyncSheet) {
        queueSheetSync("status", () =>
          updateSheetStatusOnSheet(config!, rowNumber!, sheetStatusValue)
        );
      }

      if (process.env.USE_MOCK_DATA !== "true") {
        try {
          const marked = await markTicketGmailThreadAsRead({
            ticketRowId: rowId,
            requesterEmail,
          });
          if (!marked) {
            console.warn(
              `[SheetsCRM Gmail] mark read (${rowId}): no linked thread or Gmail modify failed`
            );
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          console.warn(`[SheetsCRM Gmail] mark read (${rowId}):`, message);
        }
      }
    }

    if (typeof contactReason === "string") {
      const trimmed = contactReason.trim();
      updateTicketContactReason(rowId, trimmed);
      if (canSyncSheet) {
        queueSheetSync("contactReason", () =>
          updateContactReasonOnSheet(config!, rowNumber!, trimmed)
        );
      }
    }

    if (typeof subject === "string") updateTicketSubject(rowId, subject);

    if (typeof appendAdminNote === "string" && appendAdminNote.trim()) {
      if (process.env.USE_MOCK_DATA === "true") {
        return NextResponse.json({ error: "Admin notes sync requires live sheet data" }, { status: 400 });
      }
      if (!canSyncSheet) {
        return NextResponse.json({ error: "Sheet config or ticket row not found" }, { status: 400 });
      }
      const note = appendAdminNote.trim();
      updatedAdminNotes = appendAdminNoteToOverlay(rowId, note);
      queueSheetSync("adminNote", () =>
        writeCaseSummaryOnSheet(config!, rowNumber!, updatedAdminNotes!)
      );
    }

    if (typeof airbnbUserId === "string") {
      const trimmed = airbnbUserId.trim();
      updateTicketAirbnbUserId(rowId, trimmed);
      if (canSyncSheet) {
        queueSheetSync("airbnbUserId", () =>
          updateAirbnbUserIdOnSheet(config!, rowNumber!, trimmed)
        );
      }
    }

    if (typeof reservationCode === "string" && canSyncSheet) {
      queueSheetSync("reservationCode", () =>
        updateReservationCodeOnSheet(config!, rowNumber!, reservationCode.trim())
      );
    }

    if (typeof listingId === "string" && canSyncSheet) {
      queueSheetSync("listingId", () =>
        updateListingIdOnSheet(config!, rowNumber!, listingId.trim())
      );
    }

    if (typeof headerField === "string" && canSyncSheet) {
      queueSheetSync("headerField", () =>
        updateTicketHeaderFieldOnSheet(config!, rowNumber!, headerField.trim())
      );
    }

    if (
      typeof uiFieldSlotId === "string" &&
      typeof uiFieldValue === "string" &&
      canSyncSheet
    ) {
      const col = resolveUiFieldColumn(config!, uiFieldSlotId);
      if (col) {
        queueSheetSync(`uiField:${uiFieldSlotId}`, () =>
          updateUiFieldOnSheet(config!, rowNumber!, col.index, uiFieldValue.trim())
        );
      }
    }

    if (typeof slaHours === "number" && intakeTimestamp) {
      const { email } = await getSignedInUser();
      const timerSettings = loadTimerSettings(email);
      updatedSlaDueAt = updateTicketSla(rowId, slaHours, intakeTimestamp, timerSettings);
    }

    if (clearInitialResponseSlaFlag === true) {
      clearInitialResponseSla(rowId);
    }

    if (
      typeof linkedCaseIndex === "number" &&
      linkedCaseIndex >= 0 &&
      linkedCaseIndex <= 2 &&
      typeof linkedCaseUrl === "string"
    ) {
      updateTicketLinkedCase(rowId, linkedCaseIndex as 0 | 1 | 2, linkedCaseUrl);
    }

    return NextResponse.json({
      ok: true,
      adminNotes: updatedAdminNotes,
      status: updatedStatus,
      sheetStatus: updatedSheetStatus,
      statusChangedAt: updatedStatusChangedAt,
      slaDueAt: updatedSlaDueAt,
      sheetSyncQueued: canSyncSheet,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Update failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
