import { NextResponse } from "next/server";
import { fetchPrimaryCalendarReminders } from "@/lib/google-calendar";
import { getSignedInUser } from "@/lib/google-auth";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  const user = await getSignedInUser();
  if (user.method !== "oauth") {
    return NextResponse.json({
      events: [],
      enabled: false,
      reason: "oauth_required",
    });
  }

  const result = await fetchPrimaryCalendarReminders();
  return NextResponse.json({
    events: result.events,
    enabled: true,
    error: result.error ?? null,
  });
}
