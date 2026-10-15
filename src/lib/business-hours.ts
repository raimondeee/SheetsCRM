import type { SheetConfig } from "./types";

/** Workspace business schedule — configured in Setup. */
export interface BusinessHoursConfig {
  /** 0 = Sunday … 6 = Saturday */
  weekdays: number[];
  /** Inclusive start hour (0–23), e.g. 9 for 9:00 */
  startHour: number;
  /** Exclusive end hour (0–24), e.g. 17 for close at 5:00 PM */
  endHour: number;
  /** IANA timezone; empty = server/browser local */
  timezone?: string;
  /** Runtime only — YYYY-MM-DD dates in the workspace timezone treated as non-working */
  holidayDates?: ReadonlySet<string>;
}

export const DEFAULT_BUSINESS_HOURS: BusinessHoursConfig = {
  weekdays: [1, 2, 3, 4, 5],
  startHour: 9,
  endHour: 17,
};

export interface TimeInterval {
  start: Date;
  end: Date;
}

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function normalizeBusinessHours(
  partial: Partial<BusinessHoursConfig> | null | undefined
): BusinessHoursConfig {
  const weekdays = Array.isArray(partial?.weekdays)
    ? [...new Set(partial.weekdays.filter((d) => d >= 0 && d <= 6))].sort((a, b) => a - b)
    : DEFAULT_BUSINESS_HOURS.weekdays;
  const startHour = clampHour(partial?.startHour, DEFAULT_BUSINESS_HOURS.startHour);
  let endHour = clampHour(partial?.endHour, DEFAULT_BUSINESS_HOURS.endHour);
  if (endHour <= startHour) endHour = DEFAULT_BUSINESS_HOURS.endHour;
  const timezone =
    typeof partial?.timezone === "string" && partial.timezone.trim()
      ? partial.timezone.trim()
      : undefined;
  return { weekdays: weekdays.length ? weekdays : DEFAULT_BUSINESS_HOURS.weekdays, startHour, endHour, timezone };
}

function clampHour(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(24, Math.max(0, Math.round(value)));
}

export function businessHoursFromSheetConfig(
  config: Pick<SheetConfig, "businessHours"> | null | undefined
): BusinessHoursConfig {
  return normalizeBusinessHours(config?.businessHours);
}

export function formatBusinessHoursLabel(config: BusinessHoursConfig = DEFAULT_BUSINESS_HOURS): string {
  const days = config.weekdays.map((d) => WEEKDAY_LABELS[d] ?? "?").join("–");
  const start = formatHourLabel(config.startHour);
  const end = formatHourLabel(config.endHour);
  const tz = config.timezone ? ` (${config.timezone})` : " (local time)";
  return `${days} ${start}–${end}${tz}`;
}

function formatHourLabel(hour: number): string {
  const h = hour % 24;
  const suffix = h >= 12 ? "PM" : "AM";
  const display = h % 12 === 0 ? 12 : h % 12;
  return `${display}:00 ${suffix}`;
}

function partsInTimezone(date: Date, timezone?: string): {
  year: number;
  month: number;
  day: number;
  weekday: number;
  hour: number;
  minute: number;
} {
  if (!timezone) {
    return {
      year: date.getFullYear(),
      month: date.getMonth(),
      day: date.getDate(),
      weekday: date.getDay(),
      hour: date.getHours(),
      minute: date.getMinutes(),
    };
  }
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    weekday: "short",
    hour: "numeric",
    minute: "numeric",
    hour12: false,
  });
  const parts = fmt.formatToParts(date);
  const pick = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((p) => p.type === type)?.value ?? "0");
  const weekdayStr = parts.find((p) => p.type === "weekday")?.value ?? "Sun";
  const weekdayMap: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  return {
    year: pick("year"),
    month: pick("month") - 1,
    day: pick("day"),
    weekday: weekdayMap[weekdayStr] ?? 0,
    hour: pick("hour"),
    minute: pick("minute"),
  };
}

function makeZonedDate(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timezone?: string
): Date {
  if (!timezone) return new Date(year, month, day, hour, minute, 0, 0);
  const guess = new Date(Date.UTC(year, month, day, hour, minute, 0, 0));
  const asLocal = partsInTimezone(guess, timezone);
  const targetMs = Date.UTC(year, month, day, hour, minute, 0, 0);
  const actualMs = Date.UTC(asLocal.year, asLocal.month, asLocal.day, asLocal.hour, asLocal.minute, 0, 0);
  return new Date(guess.getTime() + (targetMs - actualMs));
}

export function holidayDateKey(
  date: Date,
  timezone?: string
): string {
  const p = partsInTimezone(date, timezone);
  const month = String(p.month + 1).padStart(2, "0");
  const day = String(p.day).padStart(2, "0");
  return `${p.year}-${month}-${day}`;
}

function isHolidayDate(date: Date, config: BusinessHoursConfig): boolean {
  if (!config.holidayDates?.size) return false;
  return config.holidayDates.has(holidayDateKey(date, config.timezone));
}

function isScheduledWorkday(date: Date, config: BusinessHoursConfig): boolean {
  const p = partsInTimezone(date, config.timezone);
  return config.weekdays.includes(p.weekday) && !isHolidayDate(date, config);
}

/** Whether `date` falls inside the configured working window. */
export function isBusinessHour(
  date: Date,
  config: BusinessHoursConfig = DEFAULT_BUSINESS_HOURS
): boolean {
  if (!isScheduledWorkday(date, config)) return false;
  const p = partsInTimezone(date, config.timezone);
  if (p.hour < config.startHour) return false;
  if (p.hour >= config.endHour) return false;
  return true;
}

/** When the business clock starts for an intake — freezes until the next open window. */
export function businessClockAnchor(
  instant: Date,
  config: BusinessHoursConfig = DEFAULT_BUSINESS_HOURS
): Date {
  if (isBusinessHour(instant, config)) return instant;
  return nextScheduleOpen(instant, config);
}

/** Next moment the schedule opens at or after `instant`. */
export function nextScheduleOpen(
  instant: Date,
  config: BusinessHoursConfig = DEFAULT_BUSINESS_HOURS
): Date {
  let probe = new Date(instant);
  for (let step = 0; step < 366 * 24; step += 1) {
    const p = partsInTimezone(probe, config.timezone);
    if (isScheduledWorkday(probe, config)) {
      if (p.hour < config.startHour) {
        return makeZonedDate(p.year, p.month, p.day, config.startHour, 0, config.timezone);
      }
      if (p.hour >= config.endHour) {
        probe = makeZonedDate(p.year, p.month, p.day + 1, 0, 0, config.timezone);
        continue;
      }
      return probe;
    }
    probe = makeZonedDate(p.year, p.month, p.day + 1, config.startHour, 0, config.timezone);
  }
  return probe;
}

function businessDayClose(instant: Date, config: BusinessHoursConfig): Date {
  const p = partsInTimezone(instant, config.timezone);
  return makeZonedDate(p.year, p.month, p.day, config.endHour, 0, config.timezone);
}

function mergeIntervals(intervals: TimeInterval[]): TimeInterval[] {
  if (!intervals.length) return [];
  const sorted = [...intervals]
    .filter((i) => i.end > i.start)
    .sort((a, b) => a.start.getTime() - b.start.getTime());
  const merged: TimeInterval[] = [sorted[0]];
  for (let i = 1; i < sorted.length; i += 1) {
    const last = merged[merged.length - 1];
    const cur = sorted[i];
    if (cur.start <= last.end) {
      last.end = new Date(Math.max(last.end.getTime(), cur.end.getTime()));
    } else {
      merged.push({ ...cur });
    }
  }
  return merged;
}

function activeMsInRange(start: Date, end: Date, pauses: TimeInterval[]): number {
  if (end <= start) return 0;
  let total = end.getTime() - start.getTime();
  for (const pause of pauses) {
    const overlapStart = Math.max(start.getTime(), pause.start.getTime());
    const overlapEnd = Math.min(end.getTime(), pause.end.getTime());
    if (overlapEnd > overlapStart) total -= overlapEnd - overlapStart;
  }
  return Math.max(0, total);
}

/** Elapsed whole minutes counted only during business hours, excluding pause windows. */
export function diffBusinessMinutes(
  start: Date,
  end: Date,
  config: BusinessHoursConfig = DEFAULT_BUSINESS_HOURS,
  pauses: TimeInterval[] = []
): number {
  if (end <= start) return 0;
  const pauseIntervals = mergeIntervals(pauses);
  let totalMs = 0;
  let cursor = businessClockAnchor(start, config);
  const endMs = end.getTime();

  for (let guard = 0; guard < 366 * 2 && cursor.getTime() < endMs; guard += 1) {
    if (!isBusinessHour(cursor, config)) {
      cursor = nextScheduleOpen(cursor, config);
      if (cursor.getTime() >= endMs) break;
      continue;
    }

    const closeAt = businessDayClose(cursor, config);
    const segmentEnd = new Date(Math.min(endMs, closeAt.getTime()));
    totalMs += activeMsInRange(cursor, segmentEnd, pauseIntervals);
    cursor = nextScheduleOpen(segmentEnd, config);
  }

  return Math.round(totalMs / 60_000);
}

function msUntilNextCalendarDay(instant: Date, config: BusinessHoursConfig): number {
  const p = partsInTimezone(instant, config.timezone);
  const nextDay = makeZonedDate(p.year, p.month, p.day + 1, 0, 0, config.timezone);
  return Math.max(0, nextDay.getTime() - instant.getTime());
}

/** Start of the next scheduled workday at 00:00, strictly after `instant` when needed. */
function nextWeekdayStart(instant: Date, config: BusinessHoursConfig): Date {
  const p = partsInTimezone(instant, config.timezone);
  for (let dayOffset = 0; dayOffset < 366; dayOffset += 1) {
    const candidate = makeZonedDate(
      p.year,
      p.month,
      p.day + dayOffset,
      0,
      0,
      config.timezone
    );
    if (!isScheduledWorkday(candidate, config)) continue;
    if (dayOffset === 0 && candidate.getTime() <= instant.getTime()) continue;
    return candidate;
  }
  return instant;
}

/**
 * Add clock hours that count only on scheduled workdays (24h/day).
 * Weekends and configured holidays are skipped — not limited to the 9–5 business window.
 */
export function addWeekdayHours(
  start: Date,
  hoursToAdd: number,
  config: BusinessHoursConfig = DEFAULT_BUSINESS_HOURS
): Date {
  const hourMs = 60 * 60 * 1000;
  let remainingMs = hoursToAdd * hourMs;
  let current = new Date(start);

  for (let guard = 0; guard < 366 * 24 && remainingMs > 0; guard += 1) {
    if (!isScheduledWorkday(current, config)) {
      current = nextWeekdayStart(current, config);
      continue;
    }

    const chunkMs = Math.min(remainingMs, msUntilNextCalendarDay(current, config));
    current = new Date(current.getTime() + chunkMs);
    remainingMs -= chunkMs;
  }

  return current;
}

export function addBusinessHours(
  start: Date,
  hoursToAdd: number,
  config: BusinessHoursConfig = DEFAULT_BUSINESS_HOURS
): Date {
  let current = businessClockAnchor(start, config);
  let added = 0;
  const maxSteps = hoursToAdd * 24 + 48;
  let steps = 0;

  while (added < hoursToAdd && steps < maxSteps) {
    current = new Date(current.getTime() + 60 * 60 * 1000);
    steps += 1;
    if (isBusinessHour(current, config)) added += 1;
  }

  return current;
}

export function formatBusinessMinutes(minutes: number | null): string {
  if (minutes === null || !Number.isFinite(minutes)) return "—";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (mins === 0) return `${hours}h`;
  return `${hours}h ${mins}m`;
}

/**
 * Response SLA clock pause: Friday 5:00 PM through Monday 7:00 AM.
 * Weeknights (Monday 7:00 AM–Friday 5:00 PM) still count. Pacific time so the
 * server due instant and the browser countdown use the same window.
 */
export const SLA_WEEKEND_TIMEZONE = "America/Los_Angeles";
export const SLA_WEEKEND_PAUSE_START_WEEKDAY = 5;
export const SLA_WEEKEND_PAUSE_START_HOUR = 17;
export const SLA_WEEKEND_PAUSE_END_WEEKDAY = 1;
export const SLA_WEEKEND_PAUSE_END_HOUR = 7;
export const SLA_WEEKEND_PAUSE_LABEL = "Fri 5:00 PM–Mon 7:00 AM Pacific";

function zonedClockParts(date: Date, timezone: string) {
  const parts = partsInTimezone(date, timezone);
  return { ...parts, hour: parts.hour === 24 ? 0 : parts.hour };
}

/** True from Friday 5:00 PM inclusive until Monday 7:00 AM exclusive. */
export function isSlaWeekendPaused(
  date: Date,
  timezone = SLA_WEEKEND_TIMEZONE
): boolean {
  const parts = zonedClockParts(date, timezone);
  if (parts.weekday === 6 || parts.weekday === 0) return true;
  if (
    parts.weekday === SLA_WEEKEND_PAUSE_START_WEEKDAY &&
    parts.hour >= SLA_WEEKEND_PAUSE_START_HOUR
  ) {
    return true;
  }
  if (
    parts.weekday === SLA_WEEKEND_PAUSE_END_WEEKDAY &&
    parts.hour < SLA_WEEKEND_PAUSE_END_HOUR
  ) {
    return true;
  }
  return false;
}

/** Next Friday 5:00 PM at or after `instant` (the following week if already there). */
function nextSlaWeekendPauseStart(instant: Date, timezone: string): Date {
  const parts = zonedClockParts(instant, timezone);
  let dayOffset = (SLA_WEEKEND_PAUSE_START_WEEKDAY - parts.weekday + 7) % 7;
  if (dayOffset === 0 && parts.hour >= SLA_WEEKEND_PAUSE_START_HOUR) dayOffset = 7;
  return makeZonedDate(
    parts.year,
    parts.month,
    parts.day + dayOffset,
    SLA_WEEKEND_PAUSE_START_HOUR,
    0,
    timezone
  );
}

/** Next Monday 7:00 AM strictly after a paused instant. */
function nextSlaWeekendResume(instant: Date, timezone: string): Date {
  const parts = zonedClockParts(instant, timezone);
  let dayOffset: number;
  if (parts.weekday === SLA_WEEKEND_PAUSE_END_WEEKDAY && parts.hour < SLA_WEEKEND_PAUSE_END_HOUR) {
    dayOffset = 0;
  } else if (parts.weekday === 5) {
    dayOffset = 3;
  } else if (parts.weekday === 6) {
    dayOffset = 2;
  } else if (parts.weekday === 0) {
    dayOffset = 1;
  } else {
    dayOffset = (SLA_WEEKEND_PAUSE_END_WEEKDAY - parts.weekday + 7) % 7;
    if (dayOffset === 0) dayOffset = 7;
  }
  const resume = makeZonedDate(
    parts.year,
    parts.month,
    parts.day + dayOffset,
    SLA_WEEKEND_PAUSE_END_HOUR,
    0,
    timezone
  );
  if (resume.getTime() > instant.getTime()) return resume;
  return makeZonedDate(
    parts.year,
    parts.month,
    parts.day + dayOffset + 7,
    SLA_WEEKEND_PAUSE_END_HOUR,
    0,
    timezone
  );
}

/**
 * Advance `hoursToAdd` on the response SLA clock.
 * Time inside the Friday 5:00 PM–Monday 7:00 AM pause is skipped.
 * An anchor that falls inside the pause starts at the following Monday 7:00 AM.
 */
export function addSlaClockHours(
  start: Date,
  hoursToAdd: number,
  timezone = SLA_WEEKEND_TIMEZONE
): Date {
  if (!Number.isFinite(hoursToAdd) || hoursToAdd <= 0) return new Date(start);
  let remainingMs = hoursToAdd * 60 * 60 * 1000;
  let current = new Date(start);

  for (let guard = 0; guard < 366 * 4 && remainingMs > 0; guard += 1) {
    if (isSlaWeekendPaused(current, timezone)) {
      const resume = nextSlaWeekendResume(current, timezone);
      current =
        resume.getTime() > current.getTime()
          ? resume
          : new Date(current.getTime() + 60 * 60 * 1000);
      continue;
    }

    const pauseAt = nextSlaWeekendPauseStart(current, timezone);
    let chunkMs = pauseAt.getTime() - current.getTime();
    if (chunkMs <= 0) {
      const resume = nextSlaWeekendResume(current, timezone);
      current =
        resume.getTime() > current.getTime()
          ? resume
          : new Date(current.getTime() + 60 * 60 * 1000);
      continue;
    }
    if (chunkMs > remainingMs) chunkMs = remainingMs;
    current = new Date(current.getTime() + chunkMs);
    remainingMs -= chunkMs;
  }

  return current;
}

/** Signed SLA-clock milliseconds from `start` to `end`. Weekend pause hours are omitted. */
export function diffSlaClockMs(
  start: Date,
  end: Date,
  timezone = SLA_WEEKEND_TIMEZONE
): number {
  if (end.getTime() === start.getTime()) return 0;
  const forward = end.getTime() > start.getTime();
  const from = forward ? start : end;
  const to = forward ? end : start;
  let total = 0;
  let cursor = new Date(from);

  for (let guard = 0; guard < 366 * 4 && cursor.getTime() < to.getTime(); guard += 1) {
    if (isSlaWeekendPaused(cursor, timezone)) {
      const resume = nextSlaWeekendResume(cursor, timezone);
      if (resume.getTime() <= cursor.getTime()) {
        cursor = new Date(cursor.getTime() + 60 * 60 * 1000);
        continue;
      }
      cursor = resume.getTime() >= to.getTime() ? new Date(to) : resume;
      continue;
    }

    const pauseAt = nextSlaWeekendPauseStart(cursor, timezone);
    const segmentEndMs = Math.min(to.getTime(), pauseAt.getTime());
    if (segmentEndMs <= cursor.getTime()) {
      const resume = nextSlaWeekendResume(cursor, timezone);
      cursor =
        resume.getTime() > cursor.getTime()
          ? resume
          : new Date(cursor.getTime() + 60 * 60 * 1000);
      continue;
    }
    total += segmentEndMs - cursor.getTime();
    cursor = new Date(segmentEndMs);
  }

  return forward ? total : -total;
}
