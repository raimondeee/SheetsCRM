import { NextResponse } from "next/server";
import { getThreadMessages, linkExistingGmailThread } from "@/lib/overlay-db";
import { parseGmailThreadId } from "@/lib/gmail-thread-link";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ rowId: string }> }
) {
  try {
    const { rowId } = await params;
    const decoded = decodeURIComponent(rowId);
    const body = await request.json();
    const { threadId: rawThreadId } = body as { threadId?: string };

    const threadId = rawThreadId ? parseGmailThreadId(rawThreadId) : null;
    if (!threadId) {
      return NextResponse.json(
        { error: "Paste a Gmail thread URL or thread ID" },
        { status: 400 }
      );
    }

    const result = linkExistingGmailThread(decoded, threadId);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 409 });
    }

    return NextResponse.json({
      message: result.message,
      messages: getThreadMessages(decoded),
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Failed to link Gmail thread";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
