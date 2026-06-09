import type { Ticket } from "./types";
import { getTicketSortTime, hoursSinceLastResponse, parseSheetTimestamp } from "./ticket-activity";
import type { SortOrder } from "./user-preferences";

export const INITIAL_RESPONSE_HOURS = 48;

export function ticketHasOutboundResponse(
  ticket: Ticket,
  outboundTicketIds: Set<string>
): boolean {
  return outboundTicketIds.has(ticket.rowId);
}

export function needsInitialResponse(
  ticket: Ticket,
  outboundTicketIds: Set<string>,
  thresholdHours = INITIAL_RESPONSE_HOURS
): boolean {
  if (ticketHasOutboundResponse(ticket, outboundTicketIds)) return false;
  const intake = parseSheetTimestamp(ticket.timestamp);
  if (!intake) return false;
  const hours = hoursSinceLastResponse(intake.toISOString());
  return hours !== null && hours >= thresholdHours;
}

export function sortTicketsWithPriority(
  tickets: Ticket[],
  outboundTicketIds: Set<string>,
  sortOrder: SortOrder
): Ticket[] {
  return [...tickets].sort((a, b) => {
    const aUrgent = needsInitialResponse(a, outboundTicketIds);
    const bUrgent = needsInitialResponse(b, outboundTicketIds);
    if (aUrgent !== bUrgent) return aUrgent ? -1 : 1;

    const aTime = getTicketSortTime(a);
    const bTime = getTicketSortTime(b);
    return sortOrder === "asc" ? aTime - bTime : bTime - aTime;
  });
}
