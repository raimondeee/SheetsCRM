/** Show toast when an event starts within this window (seconds). */
export const CALENDAR_REMINDER_LEAD_SECONDS = 2 * 60;

/** How far ahead to query Calendar for reminders (seconds). */
export const CALENDAR_LOOKAHEAD_SECONDS = CALENDAR_REMINDER_LEAD_SECONDS + 60;

/** Sidebar widget: number of events and lookahead window. */
export const CALENDAR_SIDEBAR_EVENT_LIMIT = 4;
export const CALENDAR_SIDEBAR_LOOKAHEAD_DAYS = 7;

export const CALENDAR_SIDEBAR_POLL_MS = 60_000;

/** Sidebar: highlight events starting within this window (seconds). */
export const CALENDAR_SIDEBAR_SOON_SECONDS = 5 * 60;

export const CALENDAR_SIDEBAR_COLLAPSED_KEY = "crm.calendarCollapsed";

export const CALENDAR_REMINDER_POLL_MS = 30_000;

export const CALENDAR_TOAST_AUTO_DISMISS_MS = 10_000;

export const CALENDAR_NOTIFIED_STORAGE_KEY = "sheetscrm_calendar_notified_v1";

export interface CalendarReminderEvent {
  id: string;
  summary: string;
  start: string;
  htmlLink: string | null;
  secondsUntilStart: number;
}

export interface CalendarUpcomingEvent {
  id: string;
  summary: string;
  start: string;
  end: string | null;
  htmlLink: string | null;
  allDay: boolean;
  secondsUntilStart: number;
}

export function isCalendarTabActive(): boolean {
  if (typeof document === "undefined") return false;
  return document.visibilityState === "visible" && document.hasFocus();
}

export function loadNotifiedCalendarEventIds(): Set<string> {
  if (typeof sessionStorage === "undefined") return new Set();
  try {
    const raw = sessionStorage.getItem(CALENDAR_NOTIFIED_STORAGE_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as Record<string, string>;
    const now = Date.now();
    const next: Record<string, string> = {};
    const active = new Set<string>();
    for (const [id, startIso] of Object.entries(parsed)) {
      const startMs = new Date(startIso).getTime();
      if (Number.isFinite(startMs) && startMs + 60_000 > now) {
        active.add(id);
        next[id] = startIso;
      }
    }
    sessionStorage.setItem(CALENDAR_NOTIFIED_STORAGE_KEY, JSON.stringify(next));
    return active;
  } catch {
    return new Set();
  }
}

export function markCalendarEventNotified(event: CalendarReminderEvent): void {
  if (typeof sessionStorage === "undefined") return;
  try {
    const raw = sessionStorage.getItem(CALENDAR_NOTIFIED_STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as Record<string, string>) : {};
    parsed[event.id] = event.start;
    sessionStorage.setItem(CALENDAR_NOTIFIED_STORAGE_KEY, JSON.stringify(parsed));
  } catch {
    /* ignore */
  }
}

export function formatCalendarReminderLead(secondsUntilStart: number): string {
  if (secondsUntilStart <= 45) return "Starting soon";
  const minutes = Math.max(1, Math.round(secondsUntilStart / 60));
  return `Starts in ${minutes} minute${minutes === 1 ? "" : "s"}`;
}

export function formatCalendarEventWhen(startIso: string, allDay: boolean): string {
  const start = new Date(allDay ? `${startIso}T12:00:00` : startIso);
  if (!Number.isFinite(start.getTime())) return startIso;

  const now = new Date();
  const sameDay =
    start.getFullYear() === now.getFullYear() &&
    start.getMonth() === now.getMonth() &&
    start.getDate() === now.getDate();

  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const isTomorrow =
    start.getFullYear() === tomorrow.getFullYear() &&
    start.getMonth() === tomorrow.getMonth() &&
    start.getDate() === tomorrow.getDate();

  const time = allDay
    ? "All day"
    : start.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

  if (sameDay) return `Today · ${time}`;
  if (isTomorrow) return `Tomorrow · ${time}`;
  const date = start.toLocaleDateString(undefined, { weekday: "short", month: "numeric", day: "numeric" });
  return `${date} · ${time}`;
}

function localDateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function calendarEventHighlight(
  event: CalendarUpcomingEvent,
  nowMs = Date.now()
): "soon" | "current" | null {
  const now = new Date(nowMs);

  if (event.allDay) {
    const today = localDateKey(now);
    if (event.start > today) return null;
    if (event.end && today >= event.end) return null;
    return "current";
  }

  const startMs = new Date(event.start).getTime();
  if (!Number.isFinite(startMs)) return null;
  const secondsUntilStart = Math.round((startMs - nowMs) / 1000);

  let secondsUntilEnd: number | null = null;
  if (event.end) {
    const endMs = new Date(event.end).getTime();
    if (Number.isFinite(endMs)) {
      secondsUntilEnd = Math.round((endMs - nowMs) / 1000);
    }
  }

  if (secondsUntilStart > 0 && secondsUntilStart < CALENDAR_SIDEBAR_SOON_SECONDS) {
    return "soon";
  }

  if (secondsUntilStart <= 0 && (secondsUntilEnd === null || secondsUntilEnd > 0)) {
    return "current";
  }

  return null;
}

export function calendarEventCardClass(highlight: "soon" | "current" | null): string {
  if (highlight === "soon") {
    return "border-amber-300 bg-amber-50 hover:bg-amber-100/80";
  }
  if (highlight === "current") {
    return "border-green-400 bg-green-50 hover:bg-green-100/80";
  }
  return "border-zendesk-border bg-white/90 hover:bg-white";
}
