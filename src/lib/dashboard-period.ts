import { parseSheetTimestamp } from "./ticket-activity";
import type { Ticket } from "./types";

export type DashboardPeriod = "all" | "6m" | "3m" | "1m" | "2w";

export const DASHBOARD_PERIOD_OPTIONS: {
  id: DashboardPeriod;
  label: string;
  description: string;
}[] = [
  { id: "all", label: "All time", description: "Every ticket in the intake sheet" },
  { id: "6m", label: "6 months", description: "Rolling last 180 days" },
  { id: "3m", label: "3 months", description: "Rolling last 90 days" },
  { id: "1m", label: "1 month", description: "Rolling last 30 days" },
  { id: "2w", label: "2 weeks", description: "Rolling last 14 days" },
];

export function dashboardPeriodLabel(period: DashboardPeriod): string {
  return DASHBOARD_PERIOD_OPTIONS.find((o) => o.id === period)?.label ?? period;
}

/** Rolling window length in days; null = all time. */
export function dashboardPeriodDays(period: DashboardPeriod): number | null {
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
  const days = dashboardPeriodDays(period);
  if (days === null) return true;

  const submittedAt = parseSheetTimestamp(ticket.timestamp);
  if (!submittedAt) return false;

  const cutoff = new Date();
  cutoff.setHours(0, 0, 0, 0);
  cutoff.setDate(cutoff.getDate() - days);

  return submittedAt >= cutoff;
}
