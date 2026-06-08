import type { Ticket } from "./types";
import type { SortOrder } from "./user-preferences";

export function parseSheetTimestamp(value: string): Date | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const d = new Date(trimmed);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function resolveLastResponseAt(
  ticket: Ticket,
  threadLastSentAt?: string | null
): string | null {
  const threadDate = threadLastSentAt ? new Date(threadLastSentAt) : null;
  const sheetDate = parseSheetTimestamp(ticket.timestamp);

  if (threadDate && !Number.isNaN(threadDate.getTime())) {
    if (sheetDate && sheetDate > threadDate) return sheetDate.toISOString();
    return threadLastSentAt!;
  }

  return sheetDate?.toISOString() ?? null;
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

export function sortTicketsByLastResponse(tickets: Ticket[], order: SortOrder): Ticket[] {
  const sorted = [...tickets].sort((a, b) => {
    const aTime = a.lastResponseAt ? new Date(a.lastResponseAt).getTime() : 0;
    const bTime = b.lastResponseAt ? new Date(b.lastResponseAt).getTime() : 0;
    return order === "asc" ? aTime - bTime : bTime - aTime;
  });
  return sorted;
}
