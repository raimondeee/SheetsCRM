import { DEFAULT_TIMER_SETTINGS, type TimerSettings } from "./timer-settings";
import type { Ticket } from "./types";
import { resolveLastResponseAt } from "./ticket-activity";
import { needsInitialResponse, ticketHasOutboundResponse } from "./ticket-priority";
import {
  getInitialResponseSlaClearedTicketIds,
  getLastThreadResponseMap,
  getOutboundTicketIds,
} from "./overlay-db";

export function enrichTicketsWithLastResponse(
  tickets: Ticket[],
  timerSettings: TimerSettings = DEFAULT_TIMER_SETTINGS
): Ticket[] {
  const threadLast = getLastThreadResponseMap();
  const outboundIds = getOutboundTicketIds();
  const clearedIds = getInitialResponseSlaClearedTicketIds();

  return tickets.map((ticket) => {
    const withResponse = {
      ...ticket,
      lastResponseAt: resolveLastResponseAt(ticket, threadLast.get(ticket.rowId)),
    };
    const overdue =
      needsInitialResponse(
        withResponse,
        outboundIds,
        timerSettings.initialResponseHours
      ) && !clearedIds.has(ticket.rowId);
    return {
      ...withResponse,
      needsInitialResponse: overdue,
    };
  });
}

export { getOutboundTicketIds, ticketHasOutboundResponse };
