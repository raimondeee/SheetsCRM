import { NextResponse } from "next/server";
import { buildCrmTicketLogView } from "@/lib/crm-ticket-log-view";
import { loadTimerSettings } from "@/lib/crm-preferences-store";
import { getSignedInUser } from "@/lib/google-auth";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ rowId: string }> }
) {
  try {
    const { rowId } = await params;
    const decoded = decodeURIComponent(rowId);
    const { email } = await getSignedInUser();
    const timerSettings = loadTimerSettings(email);
    const view = buildCrmTicketLogView(decoded, timerSettings);
    return NextResponse.json(view, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load CRM log";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
