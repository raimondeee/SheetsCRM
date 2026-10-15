import { NextResponse } from "next/server";
import { loadUnreadGmailInbox } from "@/lib/gmail-unread-store";
import { withApiRequestLog } from "@/lib/ops-diagnostics";

const NO_CACHE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate",
};

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: Request) {
  return withApiRequestLog(request, "/api/gmail/unread", () => handleGet(request));
}

async function handleGet(request: Request) {
  const { searchParams } = new URL(request.url);
  if (searchParams.get("warm") === "1") {
    return NextResponse.json({ unread: [], warmed: true }, { headers: NO_CACHE_HEADERS });
  }

  try {
    const limit = Number.parseInt(searchParams.get("limit") ?? "40", 10);
    const forceRefresh = searchParams.get("refresh") === "1";
    const result = await loadUnreadGmailInbox({ limit, forceRefresh });
    return NextResponse.json(result, { headers: NO_CACHE_HEADERS });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load unread Gmail threads";
    return NextResponse.json(
      { error: message, unread: [] },
      { status: 500, headers: NO_CACHE_HEADERS }
    );
  }
}
