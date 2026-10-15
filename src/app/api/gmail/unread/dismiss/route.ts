import { NextResponse } from "next/server";
import { markGmailThreadAsRead } from "@/lib/gmail";
import { removeUnreadGmailThreadFromCache } from "@/lib/gmail-unread-store";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { threadId?: string };
    const threadId = body.threadId?.trim();
    if (!threadId) {
      return NextResponse.json({ error: "threadId is required" }, { status: 400 });
    }

    const marked = await markGmailThreadAsRead(threadId);
    if (!marked) {
      return NextResponse.json(
        { error: "Could not mark thread as read. Check Gmail sign-in and gmail.modify scope." },
        { status: 502 }
      );
    }

    removeUnreadGmailThreadFromCache(threadId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to mark thread as read";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
