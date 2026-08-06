import { NextResponse } from "next/server";
import { getOpsMetricsSnapshot } from "@/lib/ops-metrics";
import { requireOAuthSession } from "@/lib/api-auth";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  const denied = await requireOAuthSession();
  if (denied) return denied;

  return NextResponse.json(getOpsMetricsSnapshot(), {
    headers: { "Cache-Control": "no-store" },
  });
}
