import { NextResponse } from "next/server";
import {
  buildBackfilledLinkNoticeBody,
  threadLinkNoticeNeedsBackfill,
} from "@/lib/gmail-thread-link";
import { resolveThreadIdForLinkNotice } from "@/lib/gmail-thread-backfill";
import { importGmailThreadMessagesForTicket } from "@/lib/gmail";
import {
  getThreadMessageById,
  getThreadMessages,
  updateThreadMessageBody,
} from "@/lib/overlay-db";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ rowId: string }> }
) {
  try {
    const { rowId } = await params;
    const decoded = decodeURIComponent(rowId);
    const body = (await request.json()) as {
      messageId?: string;
      requesterEmail?: string;
    };

    const messageId = body.messageId?.trim();
    if (!messageId) {
      return NextResponse.json({ error: "messageId is required" }, { status: 400 });
    }

    const notice = getThreadMessageById(messageId);
    if (!notice || notice.ticketRowId !== decoded) {
      return NextResponse.json({ error: "Link notice not found" }, { status: 404 });
    }

    if (notice.direction !== "system") {
      return NextResponse.json({ error: "Not a system link notice" }, { status: 400 });
    }

    if (!threadLinkNoticeNeedsBackfill(notice.subject, notice.body)) {
      return NextResponse.json({ error: "This notice does not support backfill" }, { status: 400 });
    }

    const threadId = resolveThreadIdForLinkNotice(decoded, {
      subject: notice.subject,
      sentAt: notice.sentAt,
    });
    if (!threadId) {
      return NextResponse.json(
        { error: "Could not resolve the Gmail thread for this notice" },
        { status: 404 }
      );
    }

    const requesterEmail = body.requesterEmail?.trim() ?? "";
    if (!requesterEmail) {
      return NextResponse.json({ error: "requesterEmail is required" }, { status: 400 });
    }

    const beforeCount = getThreadMessages(decoded).filter(
      (msg) => msg.direction === "inbound" || msg.direction === "outbound"
    ).length;

    await importGmailThreadMessagesForTicket({
      ticketRowId: decoded,
      threadId,
      requesterEmail,
      importFullHistory: true,
    });

    const afterCount = getThreadMessages(decoded).filter(
      (msg) => msg.direction === "inbound" || msg.direction === "outbound"
    ).length;

    updateThreadMessageBody(
      messageId,
      buildBackfilledLinkNoticeBody(notice.subject, notice.sentAt)
    );

    return NextResponse.json({
      ok: true,
      importedCount: Math.max(0, afterCount - beforeCount),
      messages: getThreadMessages(decoded),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to import thread history";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
