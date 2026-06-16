import { NextResponse } from "next/server";
import { getOpsMetricsSnapshot } from "@/lib/ops-metrics";
import { hasGoogleCredentials } from "@/lib/sheets";
import { getSignedInUser } from "@/lib/google-auth";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  const user = await getSignedInUser();
  if (!user.email && !(await hasGoogleCredentials())) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  return NextResponse.json(getOpsMetricsSnapshot(), {
    headers: { "Cache-Control": "no-store" },
  });
}
