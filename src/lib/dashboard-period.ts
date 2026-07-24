import { parseSheetTimestamp } from "./ticket-activity";
import type { Ticket } from "./types";

/** Rolling / to-date windows (calendar months use `month:YYYY-MM`). */
export type RollingDashboardPeriod =
  | "all"
  | "6m"
  | "3m"
  | "6w"
  | "mtd"
  | "qtd"
  | "ytd";

/** Rolling window or calendar month encoded as `month:YYYY-MM`. */
export type DashboardPeriod = RollingDashboardPeriod | `month:${string}`;

export const DASHBOARD_PERIOD_OPTIONS: {
  id: RollingDashboardPeriod;
  /** Abbreviated picker label. */
  label: string;
  /** Longer label for report headers and summaries. */
  reportLabel: string;
  description: string;
}[] = [
  {
    id: "all",
    label: "All",
    reportLabel: "All time",
    description: "Every ticket in the intake sheet",
  },
  {
    id: "6m",
    label: "6M",
    reportLabel: "Last 6 months",
    description: "Rolling last 180 days",
  },
  {
    id: "3m",
    label: "3M",
    reportLabel: "Last 3 months",
    description: "Rolling last 90 days",
  },
  {
    id: "6w",
    label: "6W",
    reportLabel: "Last 6 weeks",
    description: "Rolling last 42 days",
  },
  {
    id: "mtd",
    label: "MTD",
    reportLabel: "Month to date",
    description: "From the 1st of the current calendar month",
  },
  {
    id: "qtd",
    label: "QTD",
    reportLabel: "Quarter to date",
    description: "From the first day of the current calendar quarter",
  },
  {
    id: "ytd",
    label: "YTD",
    reportLabel: "Year to date",
    description: "From January 1 of the current calendar year",
  },
];

const CALENDAR_MONTH_KEY = /^(\d{4})-(\d{2})$/;

const ROLLING_PERIOD_IDS = new Set<string>(
  DASHBOARD_PERIOD_OPTIONS.map((opt) => opt.id)
);

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
  if (typeof value === "string" && ROLLING_PERIOD_IDS.has(value)) {
    return value as RollingDashboardPeriod;
  }
  // Migrate removed presets from saved preferences.
  if (value === "1m") return "mtd";
  if (value === "2w") return "6w";

  if (typeof value === "string" && isCalendarMonthPeriod(value as DashboardPeriod)) {
    const key = value.slice("month:".length);
    if (parseCalendarMonthKey(key)) return value as DashboardPeriod;
  }
  return "3m";
}

export function dashboardPeriodLabel(period: DashboardPeriod): string {
  const monthKey = calendarMonthKeyFromPeriod(period);
  if (monthKey) return formatCalendarMonthLabel(monthKey);
  return (
    DASHBOARD_PERIOD_OPTIONS.find((o) => o.id === period)?.reportLabel ??
    DASHBOARD_PERIOD_OPTIONS.find((o) => o.id === period)?.label ??
    period
  );
}

function startOfLocalDay(date: Date): Date {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  return start;
}

/**
 * Inclusive lower bound for rolling / to-date windows.
 * `null` = all time (no cutoff) or calendar-month period (handled separately).
 */
export function dashboardPeriodStart(
  period: DashboardPeriod,
  now: Date = new Date()
): Date | null {
  if (isCalendarMonthPeriod(period) || period === "all") return null;

  switch (period) {
    case "mtd":
      return startOfLocalDay(new Date(now.getFullYear(), now.getMonth(), 1));
    case "qtd": {
      const quarterStartMonth = Math.floor(now.getMonth() / 3) * 3;
      return startOfLocalDay(new Date(now.getFullYear(), quarterStartMonth, 1));
    }
    case "ytd":
      return startOfLocalDay(new Date(now.getFullYear(), 0, 1));
    case "6w":
    case "3m":
    case "6m": {
      const days = dashboardPeriodDays(period);
      if (days == null) return null;
      const cutoff = startOfLocalDay(now);
      cutoff.setDate(cutoff.getDate() - days);
      return cutoff;
    }
    default:
      return null;
  }
}

/** Rolling window length in days; null = all time, to-date, or calendar month. */
export function dashboardPeriodDays(period: DashboardPeriod): number | null {
  if (isCalendarMonthPeriod(period)) return null;

  switch (period) {
    case "6w":
      return 42;
    case "3m":
      return 90;
    case "6m":
      return 180;
    case "mtd":
    case "qtd":
    case "ytd":
    case "all":
    default:
      return null;
  }
}

export function dateMatchesDashboardPeriod(
  date: Date,
  period: DashboardPeriod,
  now: Date = new Date()
): boolean {
  const monthKey = calendarMonthKeyFromPeriod(period);
  if (monthKey) {
    const parsed = parseCalendarMonthKey(monthKey);
    if (!parsed) return false;
    return date.getFullYear() === parsed.year && date.getMonth() === parsed.month;
  }

  if (period === "all") return true;

  const start = dashboardPeriodStart(period, now);
  if (!start) return true;
  return date >= start;
}

export function ticketMatchesDashboardPeriod(
  ticket: Ticket,
  period: DashboardPeriod
): boolean {
  const submittedAt = parseSheetTimestamp(ticket.timestamp);
  if (!submittedAt) return false;
  return dateMatchesDashboardPeriod(submittedAt, period);
}
