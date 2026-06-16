import { NextResponse } from "next/server";
import {
  getThreadMessages,
  getTicketOverlay,
  loadSheetConfig,
  reopenPendingOnCustomerReply,
  resolveTicketGmailOpenUrl,
  updateTicketStatus,
} from "@/lib/overlay-db";
import { hasAirbnbUserIdForResolve } from "@/lib/ticket-action-validation";
import { sendReplyEmail, syncGmailThreadForTicket } from "@/lib/gmail";
import { parseOutboundAttachments } from "@/lib/outbound-attachments";
import { isCompleteEmailSubject } from "@/lib/email-subject";
import { mapCrmStatusToSheetValue } from "@/lib/status-mapper";
import { markUserEmailedOnSheet, updateSheetStatusOnSheet } from "@/lib/sheets";
import { loadTimerSettings } from "@/lib/crm-preferences-store";
import { getSignedInUser } from "@/lib/google-auth";
import { parseTicketRowId } from "@/lib/types";
import type { SheetConfig } from "@/lib/types";

function queueSheetSync(label: string, task: () => Promise<void>): void {
  void task().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[SheetsCRM sheet sync] ${label}:`, message);
  });
}

function queuePostSendThreadSync(params: {
  ticketRowId: string;
  requesterEmail: string;
  intakeTimestamp?: string;
}): void {
  void syncGmailThreadForTicket(params).catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[SheetsCRM Gmail] post-send thread sync (${params.ticketRowId}):`, message);
  });
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ rowId: string }> }
) {
  const { rowId } = await params;
  const decoded = decodeURIComponent(rowId);
  const { searchParams } = new URL(request.url);
  const requesterEmail = searchParams.get("email") ?? "";
  const intakeTimestamp = searchParams.get("timestamp") ?? "";

  try {
    let messages: ReturnType<typeof getThreadMessages>;
    let statusReopened: boolean;

    if (process.env.USE_MOCK_DATA === "true") {
      messages = getThreadMessages(decoded);
      statusReopened = reopenPendingOnCustomerReply(decoded);
    } else {
      const synced = await syncGmailThreadForTicket({
        ticketRowId: decoded,
        requesterEmail,
        intakeTimestamp: intakeTimestamp || undefined,
      });
      messages = synced.messages;
      statusReopened = synced.statusReopened;
    }

    const gmailOpenUrl = resolveTicketGmailOpenUrl(decoded);

    return NextResponse.json({ messages, statusReopened, gmailOpenUrl });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Thread sync failed";

    return NextResponse.json({
      messages: getThreadMessages(decoded),
      warning: message,
      gmailOpenUrl: resolveTicketGmailOpenUrl(decoded),
    });
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ rowId: string }> }
) {
  try {
    const { rowId } = await params;
    const decoded = decodeURIComponent(rowId);
    const body = await request.json();
    const { to, subject, message, cc, bcc, status, attachments: rawAttachments, intakeTimestamp } =
      body as {
        to: string;
        subject: string;
        message: string;
        cc?: string | null;
        bcc?: string | null;
        status?: string;
        attachments?: unknown;
        intakeTimestamp?: string;
      };

    const attachmentsResult = parseOutboundAttachments(rawAttachments);
    if (!Array.isArray(attachmentsResult)) {
      return NextResponse.json({ error: attachmentsResult.error }, { status: 400 });
    }

    const hasMessage = typeof message === "string" && message.trim().length > 0;
    if (!to || (!hasMessage && attachmentsResult.length === 0)) {
      return NextResponse.json(
        { error: "to and a message or at least one attachment are required" },
        { status: 400 }
      );
    }

    if (!subject?.trim() || !isCompleteEmailSubject(subject)) {
      return NextResponse.json({ error: "subject is required" }, { status: 400 });
    }

    const sent = await sendReplyEmail({
      ticketRowId: decoded,
      to,
      subject: subject.trim(),
      body: hasMessage ? message : "(see attachments)",
      cc: cc?.trim() || null,
      bcc: bcc?.trim() || null,
      attachments: attachmentsResult,
    });

    const statusAfterSend = status === "resolved" || status === "solved" ? "resolved" : "pending";
    if (statusAfterSend === "resolved") {
      const overlay = getTicketOverlay(decoded);
      if (!hasAirbnbUserIdForResolve(overlay.crmAirbnbUserId ?? "")) {
        return NextResponse.json(
          { error: "Airbnb User ID is required before marking resolved." },
          { status: 400 }
        );
      }
    }
    const { email } = await getSignedInUser();
    const timerSettings = loadTimerSettings(email);
    updateTicketStatus(decoded, statusAfterSend, timerSettings, intakeTimestamp);

    let sheetSyncQueued = false;
    if (process.env.USE_MOCK_DATA !== "true") {
      const config = loadSheetConfig("default") as SheetConfig | null;
      const parsed = parseTicketRowId(decoded);
      if (config && parsed) {
        sheetSyncQueued = true;
        const sheetStatusValue = mapCrmStatusToSheetValue(statusAfterSend);
        if (sheetStatusValue) {
          queueSheetSync("send-status", () =>
            updateSheetStatusOnSheet(config, parsed.rowNumber, sheetStatusValue)
          );
        }
        queueSheetSync("userEmailed", () =>
          markUserEmailedOnSheet(config, parsed.rowNumber)
        );
      }
    }

    queuePostSendThreadSync({
      ticketRowId: decoded,
      requesterEmail: to,
      intakeTimestamp,
    });

    return NextResponse.json({
      message: sent,
      messages: getThreadMessages(decoded),
      sheetSyncQueued,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Send failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
