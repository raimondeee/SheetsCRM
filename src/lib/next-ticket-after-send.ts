import { applyDashboardFilter, type DashboardFilter } from "./dashboard-filter";
import { getTicketSortTime, getTicketUpdatedSortTime } from "./ticket-activity";
import { compareSearchResultStatusRank, ticketPassesListFilters, ticketPassesQualityFilters, type TicketQualityFilter } from "./ticket-search";
import type { Ticket } from "./types";
import type { SortBy, SortOrder } from "./user-preferences";

function getSortTime(ticket: Ticket, sortBy: SortBy): number {
  return sortBy === "updated" ? getTicketUpdatedSortTime(ticket) : getTicketSortTime(ticket);
}

export type NextTicketAfterSendResult =
  | { kind: "ticket"; rowId: string; statusFilter?: string }
  | { kind: "victory" };

/** After the current view is exhausted, try these status folders in order. */
export const HANDOFF_STATUS_FALLBACK_ORDER = [
  "open",
  "new",
  "pending",
  "longterm_hold",
] as const;

function compareTicketsForList(a: Ticket, b: Ticket, sortBy: SortBy, sortOrder: SortOrder): number {
  if (a.needsInitialResponse !== b.needsInitialResponse) {
    return a.needsInitialResponse ? -1 : 1;
  }
  const aTime = getSortTime(a, sortBy);
  const bTime = getSortTime(b, sortBy);
  return sortOrder === "asc" ? aTime - bTime : bTime - aTime;
}

export function buildFilteredTicketList(params: {
  tickets: Ticket[];
  statusFilter: string;
  search: string;
  sortBy: SortBy;
  sortOrder: SortOrder;
  dashboardFilter: DashboardFilter | null;
  qualityFilters?: TicketQualityFilter[];
}): Ticket[] {
  const matched = params.tickets.filter((t) =>
    ticketPassesListFilters({
      ticket: t,
      statusFilter: params.statusFilter,
      search: params.search,
    }) && ticketPassesQualityFilters(t, params.qualityFilters ?? [])
  );
  const dashFiltered = applyDashboardFilter(matched, params.dashboardFilter);
  const hasSearch = params.search.trim().length > 0;
  return [...dashFiltered].sort((a, b) => {
    if (hasSearch) {
      const statusRank = compareSearchResultStatusRank(a, b);
      if (statusRank !== 0) return statusRank;
    }
    return compareTicketsForList(a, b, params.sortBy, params.sortOrder);
  });
}

function buildStatusQueue(params: {
  tickets: Ticket[];
  status: string;
  search: string;
  sortBy: SortBy;
  sortOrder: SortOrder;
  dashboardFilter: DashboardFilter | null;
  qualityFilters?: TicketQualityFilter[];
  excludeRowId?: string;
}): Ticket[] {
  return buildFilteredTicketList({
    tickets: params.tickets.filter(
      (t) => t.status === params.status && t.rowId !== params.excludeRowId
    ),
    statusFilter: "all",
    search: params.search,
    sortBy: params.sortBy,
    sortOrder: params.sortOrder,
    dashboardFilter: params.dashboardFilter,
    qualityFilters: params.qualityFilters,
  });
}

function pickFromStatusFallbacks(params: {
  tickets: Ticket[];
  sentRowId: string;
  search: string;
  sortBy: SortBy;
  sortOrder: SortOrder;
  dashboardFilter: DashboardFilter | null;
  qualityFilters?: TicketQualityFilter[];
}): NextTicketAfterSendResult | null {
  for (const status of HANDOFF_STATUS_FALLBACK_ORDER) {
    const queue = buildStatusQueue({
      tickets: params.tickets,
      status,
      search: params.search,
      sortBy: params.sortBy,
      sortOrder: params.sortOrder,
      dashboardFilter: params.dashboardFilter,
      qualityFilters: params.qualityFilters,
      excludeRowId: params.sentRowId,
    });
    if (queue.length > 0) {
      return { kind: "ticket", rowId: queue[0].rowId, statusFilter: status };
    }
  }
  return null;
}

export function pickNextTicketAfterSend(params: {
  tickets: Ticket[];
  sentRowId: string;
  statusFilter: string;
  search: string;
  sortBy: SortBy;
  sortOrder: SortOrder;
  dashboardFilter: DashboardFilter | null;
  qualityFilters?: TicketQualityFilter[];
}): NextTicketAfterSendResult {
  const visibleList = buildFilteredTicketList({
    tickets: params.tickets,
    statusFilter: params.statusFilter,
    search: params.search,
    sortBy: params.sortBy,
    sortOrder: params.sortOrder,
    dashboardFilter: params.dashboardFilter,
    qualityFilters: params.qualityFilters,
  });

  const sentIndex = visibleList.findIndex((t) => t.rowId === params.sentRowId);
  if (sentIndex >= 0 && sentIndex < visibleList.length - 1) {
    return { kind: "ticket", rowId: visibleList[sentIndex + 1].rowId };
  }

  const remaining = visibleList.filter((t) => t.rowId !== params.sentRowId);
  if (remaining.length > 0) {
    return { kind: "ticket", rowId: remaining[0].rowId };
  }

  const fallback = pickFromStatusFallbacks(params);
  if (fallback) return fallback;

  return { kind: "victory" };
}
