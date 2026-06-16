import type { Ticket } from "./types";
import {
  dashboardPeriodLabel,
  formatCalendarMonthLabel,
  ticketMatchesDashboardPeriod,
  type DashboardPeriod,
} from "./dashboard-period";
import { shortMarketManagerLabel } from "./dashboard-stats";
import { parseSheetTimestamp } from "./ticket-activity";

export interface DashboardFilter {
  period?: DashboardPeriod;
  monthStart?: string;
  contactReason?: string;
  marketManager?: string;
  requesterName?: string;
  requesterEmail?: string;
  statusBucket?: "Resolved" | "Pending";
  weekLabel?: string;
}

export function applyDashboardFilter(tickets: Ticket[], filter: DashboardFilter | null): Ticket[] {
  if (!filter || Object.keys(filter).length === 0) return tickets;

  return tickets.filter((ticket) => {
    if (filter.monthStart) {
      const d = parseSheetTimestamp(ticket.timestamp);
      if (!d) return false;
      const ticketMonthStart = new Date(d.getFullYear(), d.getMonth(), 1).toISOString();
      if (ticketMonthStart !== filter.monthStart) return false;
    } else if (filter.period && !ticketMatchesDashboardPeriod(ticket, filter.period)) {
      return false;
    }
    if (filter.contactReason && ticket.contactReason.trim() !== filter.contactReason) {
      return false;
    }
    if (
      filter.marketManager &&
      shortMarketManagerLabel(ticket.marketManager) !== filter.marketManager &&
      ticket.marketManager.trim() !== filter.marketManager
    ) {
      return false;
    }
    if (filter.requesterName && ticket.requesterName.trim() !== filter.requesterName) {
      return false;
    }
    if (
      filter.requesterEmail &&
      !ticket.requesterEmail.toLowerCase().includes(filter.requesterEmail.toLowerCase())
    ) {
      return false;
    }
    if (filter.statusBucket) {
      const resolved = /resolved|solved|closed|complete|done/i.test(ticket.sheetStatus);
      const pending = /pending|awaiting|waiting|open|in progress|new/i.test(ticket.sheetStatus);
      if (filter.statusBucket === "Resolved" && !resolved) return false;
      if (filter.statusBucket === "Pending" && !pending) return false;
    }
    if (filter.weekLabel) {
      const d = parseSheetTimestamp(ticket.timestamp);
      if (!d) return false;
      const weekStart = getWeekStartSunday(d);
      const label = `${weekStart.getMonth() + 1}/${weekStart.getDate()}/${weekStart.getFullYear()}`;
      if (label !== filter.weekLabel) return false;
    }
    return true;
  });
}

function getWeekStartSunday(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - d.getDay());
  return d;
}

export function dashboardFilterLabel(filter: DashboardFilter | null): string | null {
  if (!filter) return null;
  const parts: string[] = [];
  if (filter.monthStart) {
    const d = new Date(filter.monthStart);
    if (!Number.isNaN(d.getTime())) {
      const monthKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      parts.push(`Month: ${formatCalendarMonthLabel(monthKey)}`);
    }
  } else if (filter.period && filter.period !== "all") {
    parts.push(`Period: ${dashboardPeriodLabel(filter.period)}`);
  }
  if (filter.contactReason) parts.push(`Reason: ${filter.contactReason}`);
  if (filter.marketManager) parts.push(`MM: ${filter.marketManager}`);
  if (filter.requesterName) parts.push(`Host: ${filter.requesterName}`);
  if (filter.requesterEmail) parts.push(`Email: ${filter.requesterEmail}`);
  if (filter.statusBucket) parts.push(`Status: ${filter.statusBucket}`);
  if (filter.weekLabel) parts.push(`Week: ${filter.weekLabel}`);
  return parts.length > 0 ? parts.join(" · ") : null;
}
