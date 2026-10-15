import { NextResponse } from "next/server";
import { getOpsMetricsSnapshot } from "@/lib/ops-metrics";
import { requireOAuthSession } from "@/lib/api-auth";
import { isLocalEnvEditorRequest } from "@/lib/env-settings";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: Request) {
  if (!isLocalEnvEditorRequest(request)) {
    const denied = await requireOAuthSession();
    if (denied) return denied;
  }

  try {
    return NextResponse.json(getOpsMetricsSnapshot(), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to read diagnostics";
    return NextResponse.json({ error: message }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
