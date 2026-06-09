import type { Ticket } from "./types";
import { resolveLastResponseAt } from "./ticket-activity";
import { needsInitialResponse, ticketHasOutboundResponse } from "./ticket-priority";
import { getLastThreadResponseMap, getOutboundTicketIds } from "./overlay-db";

export function enrichTicketsWithLastResponse(tickets: Ticket[]): Ticket[] {
  const threadLast = getLastThreadResponseMap();
  const outboundIds = getOutboundTicketIds();

  return tickets.map((ticket) => {
    const withResponse = {
      ...ticket,
      lastResponseAt: resolveLastResponseAt(ticket, threadLast.get(ticket.rowId)),
    };
    return {
      ...withResponse,
      needsInitialResponse: needsInitialResponse(withResponse, outboundIds),
    };
  });
}

export { getOutboundTicketIds, ticketHasOutboundResponse };
