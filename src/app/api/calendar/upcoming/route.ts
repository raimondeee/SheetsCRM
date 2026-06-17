import { NextResponse } from "next/server";
import {
  fetchPrimaryCalendarReminders,
  fetchPrimaryUpcomingEvents,
} from "@/lib/google-calendar";
import { getSignedInUser } from "@/lib/google-auth";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  try {
    const user = await getSignedInUser();
    if (user.method !== "oauth") {
      return NextResponse.json({
        events: [],
        upcoming: [],
        enabled: false,
        reason: "oauth_required",
      });
    }

    const [reminders, upcoming] = await Promise.all([
      fetchPrimaryCalendarReminders(),
      fetchPrimaryUpcomingEvents(),
    ]);

    return NextResponse.json({
      events: reminders.events,
      upcoming: upcoming.events,
      enabled: true,
      error: upcoming.error ?? null,
      reminderError: reminders.error ?? null,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Calendar request failed";
    return NextResponse.json({
      events: [],
      upcoming: [],
      enabled: true,
      error: message,
    });
  }
}
