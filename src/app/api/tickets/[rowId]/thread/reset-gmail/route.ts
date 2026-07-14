import { NextResponse } from "next/server";
import {
  getThreadMessages,
  resetGmailThreadForNewOutbound,
  ticketForceNewGmailThreadOnSend,
} from "@/lib/overlay-db";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ rowId: string }> }
) {
  try {
    const { rowId } = await params;
    const decoded = decodeURIComponent(rowId);
    const result = resetGmailThreadForNewOutbound(decoded);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 404 });
    }

    return NextResponse.json({
      ok: true,
      removedMessageCount: result.removedMessageCount,
      messages: getThreadMessages(decoded),
      gmailOpenUrl: null,
      forceNewGmailThreadOnSend: ticketForceNewGmailThreadOnSend(decoded),
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to reset Gmail thread link";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
