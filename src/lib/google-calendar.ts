import { google } from "googleapis";
import { getGoogleAuthClient } from "./google-auth";
import {
  CALENDAR_LOOKAHEAD_SECONDS,
  CALENDAR_REMINDER_LEAD_SECONDS,
  CALENDAR_SIDEBAR_EVENT_LIMIT,
  CALENDAR_SIDEBAR_LOOKAHEAD_DAYS,
  type CalendarReminderEvent,
  type CalendarUpcomingEvent,
} from "./calendar-reminders";

function calendarApiError(message: string): string {
  if (/insufficient.*scope|invalid.*scope|auth.*scope/i.test(message)) {
    return "calendar_scope_required";
  }
  if (/accessNotConfigured|has not been used|enable.*API|calendar-json\.googleapis\.com/i.test(message)) {
    return "calendar_api_disabled";
  }
  if (/403|permission|forbidden/i.test(message)) {
    return "calendar_permission_denied";
  }
  return message;
}

function mapCalendarItem(
  item: {
    id?: string | null;
    summary?: string | null;
    start?: { dateTime?: string | null; date?: string | null } | null;
    end?: { dateTime?: string | null; date?: string | null } | null;
    htmlLink?: string | null;
  },
  now: Date
): CalendarUpcomingEvent | null {
  if (!item.id) return null;

  const allDay = Boolean(item.start?.date && !item.start?.dateTime);
  const startIso = item.start?.dateTime ?? item.start?.date;
  if (!startIso) return null;

  const endIso = item.end?.dateTime ?? item.end?.date ?? null;
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

  let secondsUntilStart: number;
  if (allDay) {
    if (endIso && today >= endIso) return null;
    if (startIso > today) {
      const startMs = new Date(`${startIso}T00:00:00`).getTime();
      if (!Number.isFinite(startMs)) return null;
      secondsUntilStart = Math.max(0, Math.round((startMs - now.getTime()) / 1000));
    } else {
      secondsUntilStart = 0;
    }
  } else {
    const startMs = new Date(startIso).getTime();
    if (!Number.isFinite(startMs)) return null;
    secondsUntilStart = Math.round((startMs - now.getTime()) / 1000);

    if (endIso) {
      const endMs = new Date(endIso).getTime();
      if (Number.isFinite(endMs) && endMs <= now.getTime()) return null;
    } else if (secondsUntilStart < 0) {
      return null;
    }
  }

  return {
    id: item.id,
    summary: item.summary?.trim() || "Calendar event",
    start: startIso,
    end: endIso,
    htmlLink: item.htmlLink ?? null,
    allDay,
    secondsUntilStart,
  };
}

async function listPrimaryCalendarEvents(params: {
  timeMin: Date;
  timeMax: Date;
  maxResults: number;
}): Promise<{ items: CalendarUpcomingEvent[]; error?: string }> {
  const auth = await getGoogleAuthClient();
  if (!auth) {
    return { items: [], error: "calendar_auth_required" };
  }

  const calendar = google.calendar({ version: "v3", auth });
  const now = new Date();

  try {
    const res = await calendar.events.list({
      calendarId: "primary",
      timeMin: params.timeMin.toISOString(),
      timeMax: params.timeMax.toISOString(),
      singleEvents: true,
      orderBy: "startTime",
      maxResults: params.maxResults,
    });

    const items: CalendarUpcomingEvent[] = [];
    for (const item of res.data.items ?? []) {
      const mapped = mapCalendarItem(item, now);
      if (mapped) items.push(mapped);
    }

    return { items };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { items: [], error: calendarApiError(message) };
  }
}

export async function fetchPrimaryCalendarReminders(): Promise<{
  events: CalendarReminderEvent[];
  error?: string;
}> {
  const now = new Date();
  const timeMax = new Date(now.getTime() + CALENDAR_LOOKAHEAD_SECONDS * 1000);
  const result = await listPrimaryCalendarEvents({
    timeMin: now,
    timeMax,
    maxResults: 15,
  });

  const events: CalendarReminderEvent[] = result.items
    .filter((item) => !item.allDay)
    .filter(
      (item) =>
        item.secondsUntilStart > 0 &&
        item.secondsUntilStart <= CALENDAR_REMINDER_LEAD_SECONDS
    )
    .map((item) => ({
      id: item.id,
      summary: item.summary,
      start: item.start,
      htmlLink: item.htmlLink,
      secondsUntilStart: item.secondsUntilStart,
    }));

  return { events, error: result.error };
}

export async function fetchPrimaryUpcomingEvents(
  limit = CALENDAR_SIDEBAR_EVENT_LIMIT
): Promise<{ events: CalendarUpcomingEvent[]; error?: string }> {
  const now = new Date();
  const timeMax = new Date(now);
  timeMax.setDate(timeMax.getDate() + CALENDAR_SIDEBAR_LOOKAHEAD_DAYS);

  const result = await listPrimaryCalendarEvents({
    timeMin: now,
    timeMax,
    maxResults: Math.max(limit, 10),
  });

  return {
    events: result.items.slice(0, limit),
    error: result.error,
  };
}
