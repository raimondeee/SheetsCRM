import { NextResponse } from "next/server";
import { requireOAuthSession } from "@/lib/api-auth";
import {
  deleteAdminNoteDraft,
  getAdminNoteDraft,
  upsertAdminNoteDraft,
} from "@/lib/composer-persistence-store";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ rowId: string }> }
) {
  const denied = await requireOAuthSession();
  if (denied) return denied;
  const { rowId } = await params;
  const text = getAdminNoteDraft(decodeURIComponent(rowId));
  return NextResponse.json({ text }, { headers: { "Cache-Control": "no-store" } });
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
    const body = (await request.json()) as { text?: string };
    const text = typeof body.text === "string" ? body.text : "";
    upsertAdminNoteDraft(decoded, text);
    return NextResponse.json({ text: getAdminNoteDraft(decoded) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to save admin note draft";
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
  deleteAdminNoteDraft(decodeURIComponent(rowId));
  return NextResponse.json({ ok: true });
}
