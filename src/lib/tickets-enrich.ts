import type { Ticket } from "./types";
import { resolveLastResponseAt } from "./ticket-activity";
import { getLastThreadResponseMap } from "./overlay-db";

export function enrichTicketsWithLastResponse(tickets: Ticket[]): Ticket[] {
  const threadLast = getLastThreadResponseMap();
  return tickets.map((ticket) => ({
    ...ticket,
    lastResponseAt: resolveLastResponseAt(ticket, threadLast.get(ticket.rowId)),
  }));
}
