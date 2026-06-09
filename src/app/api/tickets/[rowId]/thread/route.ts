import { NextResponse } from "next/server";
import {
  getThreadMessages,
  loadSheetConfig,
  reopenPendingOnCustomerReply,
  updateTicketStatus,
} from "@/lib/overlay-db";
import { sendReplyEmail, syncGmailThreadForTicket } from "@/lib/gmail";
import { mapCrmStatusToSheetValue } from "@/lib/status-mapper";
import { markUserEmailedOnSheet, updateSheetStatusOnSheet } from "@/lib/sheets";
import { parseTicketRowId } from "@/lib/types";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ rowId: string }> }
) {
  const { rowId } = await params;
  const decoded = decodeURIComponent(rowId);
  const { searchParams } = new URL(request.url);
  const requesterEmail = searchParams.get("email") ?? "";

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
      });
      messages = synced.messages;
      statusReopened = synced.statusReopened;
    }

    return NextResponse.json({ messages, statusReopened });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Thread sync failed";
    return NextResponse.json({
      messages: getThreadMessages(decoded),
      warning: message,
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
    const { to, subject, message, cc, status } = body as {
      to: string;
      subject: string;
      message: string;
      cc?: string | null;
      status?: string;
    };

    if (!to || !message) {
      return NextResponse.json({ error: "to and message are required" }, { status: 400 });
    }

    const sent = await sendReplyEmail({
      ticketRowId: decoded,
      to,
      subject: subject || "Re: Support request",
      body: message,
      cc: cc?.trim() || null,
    });

    const statusAfterSend = status === "resolved" || status === "solved" ? "resolved" : "pending";
    updateTicketStatus(decoded, statusAfterSend);

    let sheetWarning: string | undefined;
    if (process.env.USE_MOCK_DATA !== "true") {
      try {
        const config = loadSheetConfig("default");
        const parsed = parseTicketRowId(decoded);
        if (config && parsed) {
          const sheetStatusValue = mapCrmStatusToSheetValue(statusAfterSend);
          if (sheetStatusValue) {
            await updateSheetStatusOnSheet(config, parsed.rowNumber, sheetStatusValue);
          }
        }
      } catch (error) {
        sheetWarning =
          error instanceof Error ? error.message : "Could not update sheet status";
      }
    }

    let userEmailedWarning: string | undefined;
    if (process.env.USE_MOCK_DATA !== "true") {
      try {
        const config = loadSheetConfig("default");
        const parsed = parseTicketRowId(decoded);
        if (config && parsed) {
          await markUserEmailedOnSheet(config, parsed.rowNumber);
        }
      } catch (error) {
        userEmailedWarning =
          error instanceof Error ? error.message : "Could not update User Emailed column";
      }
    }

    if (userEmailedWarning) {
      sheetWarning = sheetWarning
        ? `${sheetWarning}; ${userEmailedWarning}`
        : userEmailedWarning;
    }

    const { messages, statusReopened } = await syncGmailThreadForTicket({
      ticketRowId: decoded,
      requesterEmail: to,
    });

    return NextResponse.json({ message: sent, messages, statusReopened, sheetWarning });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Send failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
