/**
 * POST /api/tickets/background-gmail-sync — Gmail poll for due pending, longterm-hold, and resolved tickets.
 *
 * Runs after GET /api/tickets so the list can render without waiting on Gmail.
 * Uses the in-memory snapshot from the last ticket-list load (no second sheet read).
 */
import { NextResponse } from "next/server";
import { requireOAuthSession } from "@/lib/api-auth";
import { runRememberedBackgroundGmailSync } from "@/lib/background-gmail-sync";
import { withApiRequestLog } from "@/lib/ops-diagnostics";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const NO_CACHE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate",
};

export async function POST(request: Request) {
  return withApiRequestLog(request, "/api/tickets/background-gmail-sync", handlePost);
}

async function handlePost() {
  const denied = await requireOAuthSession();
  if (denied) return denied;

  try {
    const synced = await runRememberedBackgroundGmailSync();
    return NextResponse.json({ ok: true, synced }, { headers: NO_CACHE_HEADERS });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Background Gmail sync failed";
    return NextResponse.json(
      { error: message, synced: 0 },
      { status: 500, headers: NO_CACHE_HEADERS }
    );
  }
}
