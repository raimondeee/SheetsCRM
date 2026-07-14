import { NextResponse } from "next/server";
import { loadCoverSheets, saveCoverSheets } from "@/lib/overlay-db";
import type { CoverSheetEntry } from "@/lib/types";

export async function GET() {
  const entries = loadCoverSheets();
  return NextResponse.json({ entries });
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { entries?: CoverSheetEntry[] };
    const entries = saveCoverSheets(body.entries ?? []);
    return NextResponse.json({ ok: true, entries });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to save cover sheets";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
