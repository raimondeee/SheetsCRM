/**
 * PATCH /api/tickets/[rowId] — update CRM ticket fields.
 *
 * Pattern: write SQLite overlay first, then queueSheetSync() for Google Sheets.
 * UI success means overlay updated; sheet confirmation is best-effort async.
 * Cover-sheet "ignore" and resolve rules that must not touch a teammate's sheet
 * are enforced in overlay-db helpers called from here.
 */
import { NextResponse } from "next/server";
import {
  addAdminNoteThreadMessage,
  appendAdminNoteToOverlay,
  clearInitialResponseSla,
  getTicketOverlay,
  updateTicketStatus,
  updateTicketSla,
  updateTicketSubject,
  updateTicketAirbnbUserId,
  markTicketAirbnbUserIdExempt,
  updateTicketContactReason,
  updateTicketLinkedCase,
  resolveSheetConfigForRowId,
} from "@/lib/overlay-db";
import { passesAirbnbUserIdResolveGate } from "@/lib/ticket-action-validation";
import { isAirbnbUserIdExempt } from "@/lib/airbnb-user-id";
import {
  crmStatusLabel,
  mapCrmStatusToSheetValue,
  normalizeStatusId,
} from "@/lib/status-mapper";
import {
  CLOSE_OUTCOME_REQUIRED_MESSAGE,
  parseCloseOutcomeFromUnknown,
  requiresCloseOutcomeAnswers,
} from "@/lib/close-outcome";
import {
  updateAirbnbUserIdOnSheet,
  updateClaimNumberOnSheet,
  updateCloseOutcomeOnSheet,
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
import { logCrmTicketEvent } from "@/lib/crm-ticket-log";
import { withApiRequestLog } from "@/lib/ops-diagnostics";

/** Fire-and-forget sheet write; failures are logged, not returned to the client. */
function queueSheetSync(
  ticketRowId: string,
  label: string,
  task: () => Promise<void>
): void {
  logCrmTicketEvent({
    ticketRowId,
    kind: "sheet_write",
    summary: `Queued sheet write (${label})`,
    detail: { field: label },
  });
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
  const config = resolveSheetConfigForRowId(rowId);
  const parsed = parseTicketRowId(rowId);
  return {
    config: config ?? null,
    rowNumber: parsed?.rowNumber ?? null,
  };
}

export async function PATCH(request: Request) {
  return withApiRequestLog(request, "/api/tickets/:rowId", () => handlePatch(request));
}

async function handlePatch(request: Request) {
  try {
    const body = await request.json();
    const {
      rowId,
      status,
      subject,
      appendAdminNote,
      airbnbUserId,
      airbnbUserIdExempt,
      reservationCode,
      claimNumber,
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
      closeTicket,
      closeOutcome,
    } = body as {
      rowId: string;
      status?: string;
      subject?: string;
      appendAdminNote?: string;
      airbnbUserId?: string;
      airbnbUserIdExempt?: boolean;
      reservationCode?: string;
      claimNumber?: string;
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
      closeTicket?: boolean;
      closeOutcome?: unknown;
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
      const overlay = getTicketOverlay(rowId);
      if (normalizedStatus === "resolved") {
        const pendingUserId =
          typeof airbnbUserId === "string" ? airbnbUserId.trim() : "";
        const resolvedUserId = pendingUserId || overlay.crmAirbnbUserId?.trim() || "";
        const exempt =
          airbnbUserIdExempt === true || isAirbnbUserIdExempt(overlay);
        if (!passesAirbnbUserIdResolveGate({ manualUserId: resolvedUserId, exempt })) {
          return NextResponse.json(
            {
              error:
                "A numeric Airbnb User ID is required in Internal tools before marking resolved (or confirm No user ID).",
            },
            { status: 400 }
          );
        }
      }
      const parsedCloseOutcome = parseCloseOutcomeFromUnknown(closeOutcome);
      if (
        requiresCloseOutcomeAnswers(overlay.status, normalizedStatus) &&
        !parsedCloseOutcome
      ) {
        return NextResponse.json(
          { error: CLOSE_OUTCOME_REQUIRED_MESSAGE },
          { status: 400 }
        );
      }
      const { email } = await getSignedInUser();
      const timerSettings = loadTimerSettings(email);
      const statusOptions: {
        pendingReopenHours?: number;
        resolvedClosed?: boolean;
      } = {};
      if (typeof pendingReopenHours === "number") {
        statusOptions.pendingReopenHours = pendingReopenHours;
      }
      if (normalizedStatus === "resolved") {
        statusOptions.resolvedClosed = closeTicket === true;
      }
      const timerFields = updateTicketStatus(
        rowId,
        normalizedStatus,
        timerSettings,
        intakeTimestamp,
        Object.keys(statusOptions).length > 0 ? statusOptions : undefined
      );
      updatedStatus = normalizedStatus;
      updatedStatusChangedAt = timerFields.statusChangedAt;
      updatedSlaDueAt = timerFields.slaDueAt;
      updatedSheetStatus = crmStatusLabel(normalizedStatus);

      const sheetStatusValue = mapCrmStatusToSheetValue(normalizedStatus);
      if (sheetStatusValue && canSyncSheet) {
        queueSheetSync(rowId, "status", () =>
          updateSheetStatusOnSheet(config!, rowNumber!, sheetStatusValue)
        );
      }

      if (parsedCloseOutcome && canSyncSheet) {
        queueSheetSync(rowId, "closeOutcome", () =>
          updateCloseOutcomeOnSheet(config!, rowNumber!, parsedCloseOutcome)
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
        queueSheetSync(rowId, "contactReason", () =>
          updateContactReasonOnSheet(config!, rowNumber!, trimmed)
        );
      }
    }

    if (typeof subject === "string") updateTicketSubject(rowId, subject);

    if (typeof appendAdminNote === "string" && appendAdminNote.trim()) {
      if (!canSyncSheet && process.env.USE_MOCK_DATA !== "true") {
        return NextResponse.json({ error: "Sheet config or ticket row not found" }, { status: 400 });
      }
      const note = appendAdminNote.trim();
      const { email } = await getSignedInUser();
      updatedAdminNotes = appendAdminNoteToOverlay(rowId, note);
      addAdminNoteThreadMessage(rowId, note, email ?? undefined);
      if (canSyncSheet) {
        queueSheetSync(rowId, "adminNote", () =>
          writeCaseSummaryOnSheet(config!, rowNumber!, updatedAdminNotes!)
        );
      }
    }

    if (airbnbUserIdExempt === true) {
      markTicketAirbnbUserIdExempt(rowId);
      if (canSyncSheet) {
        queueSheetSync(rowId, "airbnbUserId", () =>
          updateAirbnbUserIdOnSheet(config!, rowNumber!, "")
        );
      }
    } else if (typeof airbnbUserId === "string") {
      const trimmed = airbnbUserId.trim();
      updateTicketAirbnbUserId(rowId, trimmed);
      if (canSyncSheet) {
        queueSheetSync(rowId, "airbnbUserId", () =>
          updateAirbnbUserIdOnSheet(config!, rowNumber!, trimmed)
        );
      }
    }

    if (typeof reservationCode === "string" && canSyncSheet) {
      queueSheetSync(rowId, "reservationCode", () =>
        updateReservationCodeOnSheet(config!, rowNumber!, reservationCode.trim())
      );
    }

    if (typeof claimNumber === "string" && canSyncSheet) {
      queueSheetSync(rowId, "claimNumber", () =>
        updateClaimNumberOnSheet(config!, rowNumber!, claimNumber.trim())
      );
    }

    if (typeof listingId === "string" && canSyncSheet) {
      queueSheetSync(rowId, "listingId", () =>
        updateListingIdOnSheet(config!, rowNumber!, listingId.trim())
      );
    }

    if (typeof headerField === "string" && canSyncSheet) {
      queueSheetSync(rowId, "headerField", () =>
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
        queueSheetSync(rowId, `uiField:${uiFieldSlotId}`, () =>
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
