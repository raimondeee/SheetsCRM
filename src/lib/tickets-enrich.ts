import { loadWorkspaceBusinessHours } from "./business-hours-loader";
import { loadPauseIntervalsMap } from "./business-time-pauses";
import { DEFAULT_TIMER_SETTINGS, type TimerSettings } from "./timer-settings";
import type { Ticket } from "./types";
import { resolveLastResponseAt } from "./ticket-activity";
import { needsInitialResponse, ticketHasOutboundResponse } from "./ticket-priority";
import {
  getFirstInboundAtMap,
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
  const businessHours = loadWorkspaceBusinessHours();
  const now = new Date();
  const pauseMap = loadPauseIntervalsMap(now);
  const firstInboundMap = getFirstInboundAtMap();

  return tickets.map((ticket) => {
    const withResponse = {
      ...ticket,
      lastResponseAt: resolveLastResponseAt(ticket, threadLast.get(ticket.rowId)),
    };
    const overdue =
      needsInitialResponse(
        withResponse,
        outboundIds,
        timerSettings.initialResponseHours,
        {
          businessHours,
          pauses: pauseMap.get(ticket.rowId) ?? [],
          firstInboundAt: firstInboundMap.get(ticket.rowId) ?? null,
          now,
        }
      ) && !clearedIds.has(ticket.rowId);
    return {
      ...withResponse,
      needsInitialResponse: overdue,
    };
  });
}

export { getOutboundTicketIds, ticketHasOutboundResponse };
