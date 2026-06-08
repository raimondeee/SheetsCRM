import { NextResponse } from "next/server";
import { saveSheetConfig } from "@/lib/overlay-db";
import type { SheetConfig } from "@/lib/types";

export async function POST(request: Request) {
  try {
    const config = (await request.json()) as SheetConfig;
    config.updatedAt = new Date().toISOString();
    saveSheetConfig(config);
    return NextResponse.json({ ok: true, config });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to save config";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET() {
  const { loadSheetConfig } = await import("@/lib/overlay-db");
  const { buildDefaultSheetConfig } = await import("@/lib/default-sheet-config");
  const config = loadSheetConfig("default") ?? buildDefaultSheetConfig();
  return NextResponse.json({ config });
}
