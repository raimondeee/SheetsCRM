import { NextResponse } from "next/server";
import { fetchUnreadGmailThreads } from "@/lib/gmail";

const NO_CACHE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate",
};

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = Number.parseInt(searchParams.get("limit") ?? "40", 10);
    const unread = await fetchUnreadGmailThreads(limit);
    return NextResponse.json({ unread }, { headers: NO_CACHE_HEADERS });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load unread Gmail threads";
    return NextResponse.json({ error: message, unread: [] }, { status: 500, headers: NO_CACHE_HEADERS });
  }
}
