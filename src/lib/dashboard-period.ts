import { parseSheetTimestamp } from "./ticket-activity";
import type { Ticket } from "./types";

export type RollingDashboardPeriod = "all" | "6m" | "3m" | "1m" | "2w";

/** Rolling window or calendar month encoded as `month:YYYY-MM`. */
export type DashboardPeriod = RollingDashboardPeriod | `month:${string}`;

export const DASHBOARD_PERIOD_OPTIONS: {
  id: RollingDashboardPeriod;
  label: string;
  description: string;
}[] = [
  { id: "all", label: "All time", description: "Every ticket in the intake sheet" },
  { id: "6m", label: "6 months", description: "Rolling last 180 days" },
  { id: "3m", label: "3 months", description: "Rolling last 90 days" },
  { id: "1m", label: "1 month", description: "Rolling last 30 days" },
  { id: "2w", label: "2 weeks", description: "Rolling last 14 days" },
];

const CALENDAR_MONTH_KEY = /^(\d{4})-(\d{2})$/;

export function isCalendarMonthPeriod(
  period: DashboardPeriod
): period is `month:${string}` {
  return period.startsWith("month:");
}

export function isRollingDashboardPeriod(
  period: DashboardPeriod
): period is RollingDashboardPeriod {
  return !isCalendarMonthPeriod(period);
}

export function calendarMonthKeyFromPeriod(period: DashboardPeriod): string | null {
  if (!isCalendarMonthPeriod(period)) return null;
  const key = period.slice("month:".length);
  return parseCalendarMonthKey(key) ? key : null;
}

export function dashboardPeriodFromCalendarMonthKey(monthKey: string): DashboardPeriod | null {
  return parseCalendarMonthKey(monthKey) ? (`month:${monthKey}` as DashboardPeriod) : null;
}

export function parseCalendarMonthKey(
  key: string
): { year: number; month: number } | null {
  const match = CALENDAR_MONTH_KEY.exec(key);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]) - 1;
  if (!Number.isFinite(year) || month < 0 || month > 11) return null;
  return { year, month };
}

export function formatCalendarMonthLabel(monthKey: string): string {
  const parsed = parseCalendarMonthKey(monthKey);
  if (!parsed) return monthKey;
  return new Date(parsed.year, parsed.month, 1).toLocaleString(undefined, {
    month: "long",
    year: "numeric",
  });
}

export function calendarMonthStartIso(monthKey: string): string | null {
  const parsed = parseCalendarMonthKey(monthKey);
  if (!parsed) return null;
  return new Date(parsed.year, parsed.month, 1).toISOString();
}

export function ticketMatchesCalendarMonth(ticket: Ticket, monthKey: string): boolean {
  const parsed = parseCalendarMonthKey(monthKey);
  if (!parsed) return false;
  const submittedAt = parseSheetTimestamp(ticket.timestamp);
  if (!submittedAt) return false;
  return (
    submittedAt.getFullYear() === parsed.year && submittedAt.getMonth() === parsed.month
  );
}

export function normalizeDashboardPeriod(value: unknown): DashboardPeriod {
  if (
    value === "all" ||
    value === "6m" ||
    value === "3m" ||
    value === "1m" ||
    value === "2w"
  ) {
    return value;
  }
  if (typeof value === "string" && isCalendarMonthPeriod(value as DashboardPeriod)) {
    const key = value.slice("month:".length);
    if (parseCalendarMonthKey(key)) return value as DashboardPeriod;
  }
  return "3m";
}

export function dashboardPeriodLabel(period: DashboardPeriod): string {
  const monthKey = calendarMonthKeyFromPeriod(period);
  if (monthKey) return formatCalendarMonthLabel(monthKey);
  return DASHBOARD_PERIOD_OPTIONS.find((o) => o.id === period)?.label ?? period;
}

/** Rolling window length in days; null = all time or calendar month. */
export function dashboardPeriodDays(period: DashboardPeriod): number | null {
  if (isCalendarMonthPeriod(period)) return null;

  switch (period) {
    case "2w":
      return 14;
    case "1m":
      return 30;
    case "3m":
      return 90;
    case "6m":
      return 180;
    case "all":
    default:
      return null;
  }
}

export function ticketMatchesDashboardPeriod(
  ticket: Ticket,
  period: DashboardPeriod
): boolean {
  const monthKey = calendarMonthKeyFromPeriod(period);
  if (monthKey) return ticketMatchesCalendarMonth(ticket, monthKey);

  const days = dashboardPeriodDays(period);
  if (days === null) return true;

  const submittedAt = parseSheetTimestamp(ticket.timestamp);
  if (!submittedAt) return false;

  const cutoff = new Date();
  cutoff.setHours(0, 0, 0, 0);
  cutoff.setDate(cutoff.getDate() - days);

  return submittedAt >= cutoff;
}
