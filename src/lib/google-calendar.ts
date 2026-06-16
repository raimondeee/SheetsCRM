import { google } from "googleapis";
import { getGoogleAuthClient } from "./google-auth";
import {
  CALENDAR_LOOKAHEAD_SECONDS,
  CALENDAR_REMINDER_LEAD_SECONDS,
  type CalendarReminderEvent,
} from "./calendar-reminders";

export async function fetchPrimaryCalendarReminders(): Promise<{
  events: CalendarReminderEvent[];
  error?: string;
}> {
  const auth = await getGoogleAuthClient();
  if (!auth) {
    return { events: [], error: "calendar_auth_required" };
  }

  const calendar = google.calendar({ version: "v3", auth });
  const now = new Date();
  const timeMax = new Date(now.getTime() + CALENDAR_LOOKAHEAD_SECONDS * 1000);

  try {
    const res = await calendar.events.list({
      calendarId: "primary",
      timeMin: now.toISOString(),
      timeMax: timeMax.toISOString(),
      singleEvents: true,
      orderBy: "startTime",
      maxResults: 15,
    });

    const events: CalendarReminderEvent[] = [];
    for (const item of res.data.items ?? []) {
      if (!item.id) continue;
      const startIso = item.start?.dateTime;
      if (!startIso) continue;

      const startMs = new Date(startIso).getTime();
      if (!Number.isFinite(startMs)) continue;

      const secondsUntilStart = Math.round((startMs - now.getTime()) / 1000);
      if (secondsUntilStart <= 0 || secondsUntilStart > CALENDAR_REMINDER_LEAD_SECONDS) {
        continue;
      }

      events.push({
        id: item.id,
        summary: item.summary?.trim() || "Calendar event",
        start: startIso,
        htmlLink: item.htmlLink ?? null,
        secondsUntilStart,
      });
    }

    return { events };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/insufficient|scope|403|permission/i.test(message)) {
      return { events: [], error: "calendar_scope_required" };
    }
    return { events: [], error: message };
  }
}
