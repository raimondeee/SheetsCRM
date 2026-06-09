import { NextResponse } from "next/server";
import type { MarketManager } from "@/lib/market-managers";
import {
  loadMarketManagerDirectory,
  saveMarketManagerDirectory,
} from "@/lib/market-managers-store";

export async function GET() {
  try {
    const directory = loadMarketManagerDirectory();
    return NextResponse.json(directory);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load directory";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { managers?: MarketManager[] };
    if (!Array.isArray(body.managers)) {
      return NextResponse.json({ error: "managers array required" }, { status: 400 });
    }

    const directory = saveMarketManagerDirectory(body.managers);
    return NextResponse.json(directory);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to save directory";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
