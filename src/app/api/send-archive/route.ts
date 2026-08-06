import { NextResponse } from "next/server";
import { requireOAuthSession } from "@/lib/api-auth";
import {
  clearSendArchiveStore,
  listSendArchive,
  patchSendArchiveEntry,
  SEND_ARCHIVE_LIMIT,
  upsertSendArchiveEntry,
} from "@/lib/composer-persistence-store";
import type { SendArchiveEntry } from "@/lib/send-archive-types";

export const dynamic = "force-dynamic";

export async function GET() {
  const denied = await requireOAuthSession();
  if (denied) return denied;
  return NextResponse.json(
    { entries: listSendArchive(SEND_ARCHIVE_LIMIT) },
    { headers: { "Cache-Control": "no-store" } }
  );
}

export async function PUT(request: Request) {
  const denied = await requireOAuthSession();
  if (denied) return denied;
  try {
    const body = (await request.json()) as { entry?: SendArchiveEntry };
    if (!body.entry?.id) {
      return NextResponse.json({ error: "entry with id required" }, { status: 400 });
    }
    upsertSendArchiveEntry(body.entry);
    return NextResponse.json({ ok: true, entries: listSendArchive(SEND_ARCHIVE_LIMIT) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to save send archive";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  const denied = await requireOAuthSession();
  if (denied) return denied;
  try {
    const body = (await request.json()) as {
      id?: string;
      status?: SendArchiveEntry["status"];
      errorMessage?: string;
      completedAt?: string;
    };
    if (!body.id) {
      return NextResponse.json({ error: "id required" }, { status: 400 });
    }
    const updated = patchSendArchiveEntry(body.id, {
      status: body.status,
      errorMessage: body.errorMessage,
      completedAt: body.completedAt,
    });
    if (!updated) {
      return NextResponse.json({ error: "Archive entry not found" }, { status: 404 });
    }
    return NextResponse.json({ ok: true, entry: updated, entries: listSendArchive(SEND_ARCHIVE_LIMIT) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to update send archive";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE() {
  const denied = await requireOAuthSession();
  if (denied) return denied;
  clearSendArchiveStore();
  return NextResponse.json({ ok: true, entries: [] });
}
