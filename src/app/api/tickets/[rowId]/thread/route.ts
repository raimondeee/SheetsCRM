import { NextResponse } from "next/server";
import { getThreadMessages } from "@/lib/overlay-db";
import { sendReplyEmail, syncGmailThreadForTicket } from "@/lib/gmail";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ rowId: string }> }
) {
  const { rowId } = await params;
  const decoded = decodeURIComponent(rowId);
  const { searchParams } = new URL(request.url);
  const requesterEmail = searchParams.get("email") ?? "";

  try {
    const messages =
      process.env.USE_MOCK_DATA === "true"
        ? getThreadMessages(decoded)
        : await syncGmailThreadForTicket({
            ticketRowId: decoded,
            requesterEmail,
          });

    return NextResponse.json({ messages });
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
    const { to, subject, message, cc } = body as {
      to: string;
      subject: string;
      message: string;
      cc?: string | null;
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

    const messages = await syncGmailThreadForTicket({
      ticketRowId: decoded,
      requesterEmail: to,
    });

    return NextResponse.json({ message: sent, messages });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Send failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
