/** Show toast when an event starts within this window (seconds). */
export const CALENDAR_REMINDER_LEAD_SECONDS = 2 * 60;

/** How far ahead to query Calendar (seconds). */
export const CALENDAR_LOOKAHEAD_SECONDS = CALENDAR_REMINDER_LEAD_SECONDS + 60;

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
