import { NextResponse } from "next/server";
import {
  loadTicketComposePrefs,
  saveTicketComposePrefs,
} from "@/lib/crm-preferences-store";
import { getSignedInUser } from "@/lib/google-auth";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ rowId: string }> }
) {
  const { rowId } = await params;
  const { email } = await getSignedInUser();
  const prefs = loadTicketComposePrefs(decodeURIComponent(rowId), email);
  return NextResponse.json({ prefs });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ rowId: string }> }
) {
  try {
    const { rowId } = await params;
    const decoded = decodeURIComponent(rowId);
    const body = (await request.json()) as { ccMarketManager?: boolean };
    const { email } = await getSignedInUser();
    const prefs = { ccMarketManager: Boolean(body.ccMarketManager) };
    saveTicketComposePrefs(decoded, prefs, email);
    return NextResponse.json({ ok: true, prefs });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to save compose prefs";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
