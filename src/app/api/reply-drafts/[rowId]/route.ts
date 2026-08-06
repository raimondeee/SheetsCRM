import { NextResponse } from "next/server";
import { requireOAuthSession } from "@/lib/api-auth";
import {
  deleteReplyDraft,
  getReplyDraft,
  upsertReplyDraft,
} from "@/lib/composer-persistence-store";
import { isCompleteEmailSubject } from "@/lib/email-subject";
import { isRichTextEmpty } from "@/lib/html-utils";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ rowId: string }> }
) {
  const denied = await requireOAuthSession();
  if (denied) return denied;
  const { rowId } = await params;
  const draft = getReplyDraft(decodeURIComponent(rowId));
  return NextResponse.json({ draft }, { headers: { "Cache-Control": "no-store" } });
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ rowId: string }> }
) {
  const denied = await requireOAuthSession();
  if (denied) return denied;
  const { rowId } = await params;
  const decoded = decodeURIComponent(rowId);
  try {
    const body = (await request.json()) as {
      body?: string;
      subject?: string;
      cc?: string;
      bcc?: string;
    };
    const replyBody = typeof body.body === "string" ? body.body : "";
    const subject = typeof body.subject === "string" ? body.subject.trim() : "";
    const cc = typeof body.cc === "string" ? body.cc.trim() : "";
    const bcc = typeof body.bcc === "string" ? body.bcc.trim() : "";
    const hasSubject = isCompleteEmailSubject(subject);

    if (isRichTextEmpty(replyBody) && !hasSubject && !cc && !bcc) {
      deleteReplyDraft(decoded);
      return NextResponse.json({ draft: null });
    }

    const draft = upsertReplyDraft(decoded, {
      body: replyBody,
      subject: hasSubject ? subject : "",
      cc,
      bcc,
    });
    return NextResponse.json({ draft });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to save draft";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ rowId: string }> }
) {
  const denied = await requireOAuthSession();
  if (denied) return denied;
  const { rowId } = await params;
  deleteReplyDraft(decodeURIComponent(rowId));
  return NextResponse.json({ ok: true });
}
