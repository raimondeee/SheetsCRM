import { NextResponse } from "next/server";
import {
  getThreadMessages,
  getTicketOverlay,
  linkExistingGmailThread,
  resolveTicketGmailOpenUrl,
  unlinkGmailThread,
  updateTicketSubject,
} from "@/lib/overlay-db";
import {
  ensureTicketGmailApiThreadId,
  fetchFirstThreadSubject,
  fetchGmailThreadCandidatePreviews,
  resolveGmailThreadLinkTargetDetailed,
} from "@/lib/gmail";
import { shouldSetSubjectFromLinkedGmailThread } from "@/lib/email-subject";
import { isGmailLegacyWebId } from "@/lib/gmail-urls";
import { parseGmailLinkInput } from "@/lib/gmail-thread-link";
import { parseTicketRowId } from "@/lib/types";

async function finishLink(
  decoded: string,
  apiThreadId: string,
  openUrl: string,
  replace: boolean,
  requesterEmail?: string
) {
  const result = linkExistingGmailThread(decoded, {
    threadId: apiThreadId,
    openUrl,
    replace,
  });
  if (!result.ok) {
    const linkedTicket = result.linkedTicketRowId
      ? parseTicketRowId(result.linkedTicketRowId)
      : null;
    return NextResponse.json(
      {
        error: result.error,
        linkedTicketRowId: result.linkedTicketRowId,
        linkedTicketRowNumber: linkedTicket?.rowNumber ?? null,
      },
      { status: 409 }
    );
  }

  let importedSubject: string | null = null;
  const overlay = getTicketOverlay(decoded);
  if (shouldSetSubjectFromLinkedGmailThread(overlay.crmSubject)) {
    const resolvedThreadId = await ensureTicketGmailApiThreadId({
      ticketRowId: decoded,
      requesterEmail,
    });
    if (resolvedThreadId) {
      const threadSubject = await fetchFirstThreadSubject(resolvedThreadId);
      if (threadSubject) {
        updateTicketSubject(decoded, threadSubject);
        importedSubject = threadSubject;
      }
    }
  }

  return NextResponse.json({
    message: result.message,
    messages: getThreadMessages(decoded),
    gmailOpenUrl: resolveTicketGmailOpenUrl(decoded) ?? result.openUrl,
    subject: importedSubject,
  });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ rowId: string }> }
) {
  try {
    const { rowId } = await params;
    const decoded = decodeURIComponent(rowId);
    const body = await request.json();
    const { threadId: rawThreadId, replace, requesterEmail, selectedApiThreadId } = body as {
      threadId?: string;
      replace?: boolean;
      requesterEmail?: string;
      selectedApiThreadId?: string;
    };

    const parsed = rawThreadId ? parseGmailLinkInput(rawThreadId) : null;
    if (!parsed) {
      return NextResponse.json(
        {
          error:
            "Paste a Gmail thread URL, thread ID, host email, or Gmail search (e.g. from:host@example.com)",
        },
        { status: 400 }
      );
    }

    if (selectedApiThreadId?.trim()) {
      return finishLink(
        decoded,
        selectedApiThreadId.trim(),
        parsed.openUrl,
        Boolean(replace),
        requesterEmail
      );
    }

    const resolution = await resolveGmailThreadLinkTargetDetailed(parsed, requesterEmail);
    if (resolution.status === "resolved") {
      return finishLink(
        decoded,
        resolution.apiThreadId,
        parsed.openUrl,
        Boolean(replace),
        requesterEmail
      );
    }

    if (resolution.status === "ambiguous") {
      const candidates = await fetchGmailThreadCandidatePreviews(resolution.threadIds);
      if (candidates.length === 0) {
        return NextResponse.json(
          { error: "Multiple threads matched but previews could not be loaded. Try again." },
          { status: 404 }
        );
      }
      return NextResponse.json({
        requiresSelection: true,
        candidates,
        openUrl: parsed.openUrl,
      });
    }

    const hasExplicitSearchThread = Boolean(
      parsed.conversationId &&
        parsed.searchQuery &&
        isGmailLegacyWebId(parsed.conversationId)
    );
    return NextResponse.json(
      {
        error: hasExplicitSearchThread
          ? "No Gmail thread found for that search URL. Open the thread in Gmail, copy the URL from Sent or Inbox (e.g. #sent/…), and paste that instead."
          : "No Gmail thread found for that link or search. Try opening the thread in Gmail and paste its URL instead.",
      },
      { status: 404 }
    );
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Failed to link Gmail thread";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ rowId: string }> }
) {
  try {
    const { rowId } = await params;
    const decoded = decodeURIComponent(rowId);
    const result = unlinkGmailThread(decoded);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 404 });
    }

    return NextResponse.json({
      messages: getThreadMessages(decoded),
      gmailOpenUrl: null,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Failed to remove Gmail thread link";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
