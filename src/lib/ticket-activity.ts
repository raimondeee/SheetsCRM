import type { Ticket } from "./types";
import type { SortOrder } from "./user-preferences";

/** Parse intake timestamps from sheet Column A and similar date cells. */
export function parseSheetTimestamp(value: string): Date | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  if (/^\d+(\.\d+)?$/.test(trimmed)) {
    const serial = Number.parseFloat(trimmed);
    if (serial > 1) {
      const ms = Math.round((serial - 25569) * 86_400_000);
      const serialDate = new Date(ms);
      if (!Number.isNaN(serialDate.getTime())) return serialDate;
    }
  }

  const normalized = trimmed.includes("T") ? trimmed : trimmed.replace(" ", "T");
  const isoAttempt = new Date(normalized);
  if (!Number.isNaN(isoAttempt.getTime())) return isoAttempt;

  const direct = new Date(trimmed);
  return Number.isNaN(direct.getTime()) ? null : direct;
}

/** Sort key from Column A submission time; falls back to sheet row order. */
export function getTicketSortTime(ticket: Ticket): number {
  const parsed = parseSheetTimestamp(ticket.timestamp);
  if (parsed) return parsed.getTime();
  return ticket.rowNumber;
}

/** Sort key from latest thread activity or intake time; falls back to submission time. */
export function getTicketUpdatedSortTime(ticket: Ticket): number {
  if (ticket.lastResponseAt) {
    const updated = new Date(ticket.lastResponseAt);
    if (!Number.isNaN(updated.getTime())) return updated.getTime();
  }
  return getTicketSortTime(ticket);
}

export function resolveLastResponseAt(
  ticket: Pick<Ticket, "timestamp" | "status" | "statusChangedAt">,
  threadLastSentAt?: string | null
): string | null {
  if (
    (ticket.status === "pending" || ticket.status === "longterm_hold") &&
    ticket.statusChangedAt
  ) {
    const anchor = new Date(ticket.statusChangedAt);
    if (!Number.isNaN(anchor.getTime())) return ticket.statusChangedAt;
  }

  const threadDate = threadLastSentAt ? new Date(threadLastSentAt) : null;
  const sheetDate = parseSheetTimestamp(ticket.timestamp);

  if (threadDate && !Number.isNaN(threadDate.getTime())) {
    if (sheetDate && sheetDate > threadDate) return sheetDate.toISOString();
    return threadLastSentAt!;
  }

  return sheetDate?.toISOString() ?? null;
}

/** Apply timer fields returned from a pending status change (API or mock). */
export function applyPendingStatusTimerFields(
  ticket: Ticket,
  fields: {
    status: string;
    statusChangedAt?: string | null;
    slaDueAt?: string | null;
  }
): Ticket {
  const status = fields.status;
  const statusChangedAt =
    fields.statusChangedAt !== undefined ? fields.statusChangedAt : ticket.statusChangedAt;
  const slaDueAt = fields.slaDueAt !== undefined ? fields.slaDueAt : ticket.slaDueAt;
  const updated = {
    ...ticket,
    status,
    statusChangedAt,
    slaDueAt,
    slaBreached: slaDueAt ? new Date(slaDueAt) < new Date() : ticket.slaBreached,
  };
  return {
    ...updated,
    lastResponseAt: resolveLastResponseAt(updated),
  };
}

/** Hours since last response (thread or intake timestamp). */
export function hoursSinceLastResponse(lastResponseAt: string | null): number | null {
  if (!lastResponseAt) return null;
  const ms = Date.now() - new Date(lastResponseAt).getTime();
  if (Number.isNaN(ms)) return null;
  return Math.max(0, ms / (1000 * 60 * 60));
}

export function formatLastResponseHours(lastResponseAt: string | null): string | null {
  const hours = hoursSinceLastResponse(lastResponseAt);
  if (hours === null) return null;
  if (hours < 1) return "<1h";
  return `${Math.round(hours)}h`;
}

export function sortTicketsBySubmittedTime(tickets: Ticket[], order: SortOrder): Ticket[] {
  return [...tickets].sort((a, b) => {
    const aTime = getTicketSortTime(a);
    const bTime = getTicketSortTime(b);
    return order === "asc" ? aTime - bTime : bTime - aTime;
  });
}

/** @deprecated Use sortTicketsBySubmittedTime */
export function sortTicketsByLastResponse(tickets: Ticket[], order: SortOrder): Ticket[] {
  return sortTicketsBySubmittedTime(tickets, order);
}
