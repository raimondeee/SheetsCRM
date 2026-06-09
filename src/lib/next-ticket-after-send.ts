import { applyDashboardFilter, type DashboardFilter } from "./dashboard-filter";
import { getTicketSortTime } from "./ticket-activity";
import { ticketPassesListFilters } from "./ticket-search";
import type { Ticket } from "./types";
import type { SortOrder } from "./user-preferences";

export type NextTicketAfterSendResult =
  | { kind: "ticket"; rowId: string; statusFilter?: string }
  | { kind: "victory" };

function sortOldestFirst(tickets: Ticket[]): Ticket[] {
  return [...tickets].sort((a, b) => {
    if (a.needsInitialResponse !== b.needsInitialResponse) {
      return a.needsInitialResponse ? -1 : 1;
    }
    return getTicketSortTime(a) - getTicketSortTime(b);
  });
}

export function buildFilteredTicketList(params: {
  tickets: Ticket[];
  statusFilter: string;
  search: string;
  sortOrder: SortOrder;
  dashboardFilter: DashboardFilter | null;
}): Ticket[] {
  const matched = params.tickets.filter((t) =>
    ticketPassesListFilters({
      ticket: t,
      statusFilter: params.statusFilter,
      search: params.search,
    })
  );
  const dashFiltered = applyDashboardFilter(matched, params.dashboardFilter);
  return [...dashFiltered].sort((a, b) => {
    if (a.needsInitialResponse !== b.needsInitialResponse) {
      return a.needsInitialResponse ? -1 : 1;
    }
    const aTime = getTicketSortTime(a);
    const bTime = getTicketSortTime(b);
    return params.sortOrder === "asc" ? aTime - bTime : bTime - aTime;
  });
}

export function pickNextTicketAfterSend(params: {
  tickets: Ticket[];
  sentRowId: string;
  sentIndexInFiltered: number;
  statusFilter: string;
  search: string;
  sortOrder: SortOrder;
  dashboardFilter: DashboardFilter | null;
}): NextTicketAfterSendResult {
  const filtered = buildFilteredTicketList({
    tickets: params.tickets,
    statusFilter: params.statusFilter,
    search: params.search,
    sortOrder: params.sortOrder,
    dashboardFilter: params.dashboardFilter,
  });

  const remaining = filtered.filter((t) => t.rowId !== params.sentRowId);
  if (remaining.length > 0) {
    const startIndex =
      params.sentIndexInFiltered >= 0
        ? Math.min(params.sentIndexInFiltered, remaining.length - 1)
        : 0;
    for (let i = startIndex; i < remaining.length; i += 1) {
      return { kind: "ticket", rowId: remaining[i].rowId };
    }
    return { kind: "ticket", rowId: remaining[0].rowId };
  }

  const openTickets = sortOldestFirst(
    params.tickets.filter((t) => t.status === "open")
  );
  if (openTickets.length > 0) {
    return { kind: "ticket", rowId: openTickets[0].rowId, statusFilter: "open" };
  }

  const pendingTickets = sortOldestFirst(
    params.tickets.filter((t) => t.status === "pending")
  );
  if (pendingTickets.length > 0) {
    return { kind: "ticket", rowId: pendingTickets[0].rowId, statusFilter: "pending" };
  }

  return { kind: "victory" };
}
