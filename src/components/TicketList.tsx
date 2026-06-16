import { useEffect, useRef } from "react";
import type { Ticket } from "@/lib/types";
import { DEFAULT_STATUSES } from "@/lib/types";
import { getSlaCountdownPreviewForTicket, slaCountdownClassName } from "@/lib/sla-display";
import { formatLastResponseHours } from "@/lib/ticket-activity";
import { getResoAndListingValues } from "@/lib/ticket-search";
import type { SortBy, SortOrder } from "@/lib/user-preferences";
import type { TicketQualityFilter } from "@/lib/ticket-search";
import {
  ArrowDownWideNarrow,
  ArrowUpWideNarrow,
  ChevronLeft,
  ChevronRight,
  Search,
} from "lucide-react";
import { panelTextSizes, panelSortByLabel, panelSortOrderLabel } from "@/lib/panel-density";
import { ticketListPrimaryLine } from "@/lib/email-subject";

interface TicketListProps {
  tickets: Ticket[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  search: string;
  onSearch: (q: string) => void;
  loading: boolean;
  sortBy: SortBy;
  onSortByChange: (by: SortBy) => void;
  sortOrder: SortOrder;
  onSortOrderChange: (order: SortOrder) => void;
  qualityFilters: TicketQualityFilter[];
  onQualityFilterToggle: (filter: TicketQualityFilter) => void;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  initialResponseHours: number;
  fontScale?: number;
}

function statusLabel(id: string) {
  return DEFAULT_STATUSES.find((s) => s.id === id)?.label ?? id;
}

export function TicketList({
  tickets,
  selectedId,
  onSelect,
  search,
  onSearch,
  loading,
  sortBy,
  onSortByChange,
  sortOrder,
  onSortOrderChange,
  qualityFilters,
  onQualityFilterToggle,
  collapsed,
  onToggleCollapsed,
  initialResponseHours,
  fontScale = 1,
}: TicketListProps) {
  const text = panelTextSizes(fontScale);
  const initialResponseLabel = `${initialResponseHours}h+`;
  const sortNewestFirst = sortOrder === "desc";
  const missingReasonActive = qualityFilters.includes("missing_reason");
  const missingIdActive = qualityFilters.includes("missing_id");

  function qualityFilterButtonClass(active: boolean) {
    return `h-7 rounded border px-2 ${text.tiny} font-medium leading-none ${
      active
        ? "border-zendesk-green bg-green-50 text-zendesk-navy"
        : "border-zendesk-border text-zendesk-muted hover:bg-gray-100"
    }`;
  }

  const sortButtonBase = `h-7 rounded border px-2 ${text.tiny} font-medium leading-none`;
  const sortByLabel = panelSortByLabel(sortBy, text.compact);
  const sortOrderLabel = panelSortOrderLabel(sortBy, sortNewestFirst, text.compact);
  const listRef = useRef<HTMLDivElement>(null);
  const prevSelectedRef = useRef<string | null>(selectedId);

  useEffect(() => {
    if (!selectedId || selectedId === prevSelectedRef.current) return;
    prevSelectedRef.current = selectedId;

    const reduceMotion =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const selectedEl = listRef.current?.querySelector(
      `[data-ticket-id="${CSS.escape(selectedId)}"]`
    );
    selectedEl?.scrollIntoView({
      block: "nearest",
      behavior: reduceMotion ? "auto" : "smooth",
    });
  }, [selectedId, tickets]);

  if (collapsed) {
    return (
      <section className="flex h-full w-full flex-col border-r border-zendesk-border bg-white">
        <button
          type="button"
          onClick={onToggleCollapsed}
          title="Expand ticket list"
          aria-label="Expand ticket list"
          className="flex h-10 items-center justify-center border-b border-zendesk-border text-zendesk-muted hover:bg-gray-100 hover:text-zendesk-navy"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
        <div className="flex flex-1 flex-col items-center gap-2 overflow-y-auto py-2">
          <span
            className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-semibold text-zendesk-muted"
            title={`${tickets.length} ticket${tickets.length === 1 ? "" : "s"} in view`}
          >
            {tickets.length > 99 ? "99+" : tickets.length}
          </span>
          {selectedId && (
            <span
              className="h-2 w-2 rounded-full bg-blue-500"
              title="Ticket selected — expand list to switch"
            />
          )}
        </div>
      </section>
    );
  }

  return (
    <section className="flex h-full w-full min-w-0 flex-col border-r border-zendesk-border bg-white">
      <div className={`border-b border-zendesk-border ${text.compact ? "p-2" : "p-2.5"}`}>
        <div className="mb-2 flex items-center justify-between gap-1">
          <p className={`${text.micro} font-semibold uppercase tracking-wide text-zendesk-muted`}>
            Tickets
          </p>
          <button
            type="button"
            onClick={onToggleCollapsed}
            title="Collapse ticket list"
            aria-label="Collapse ticket list"
            className="rounded p-1 text-zendesk-muted hover:bg-gray-100 hover:text-zendesk-navy"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </button>
        </div>
        <div className="relative">
          <Search
            className={`absolute left-2 top-1/2 ${text.icon} -translate-y-1/2 text-zendesk-muted`}
          />
          <input
            type="search"
            placeholder={text.compact ? "Search" : "Search all tickets"}
            value={search}
            onChange={(e) => onSearch(e.target.value)}
            className={`w-full rounded border border-zendesk-border ${text.inputPy} pl-8 pr-2 ${text.body} outline-none focus:border-zendesk-green`}
          />
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          <button
            type="button"
            onClick={() => onQualityFilterToggle("missing_reason")}
            className={qualityFilterButtonClass(missingReasonActive)}
            title="Show New, Open, and Pending tickets without a contact reason"
            aria-pressed={missingReasonActive}
          >
            <span className="truncate">{text.compact ? "No reason" : "Missing reason"}</span>
          </button>
          <button
            type="button"
            onClick={() => onQualityFilterToggle("missing_id")}
            className={qualityFilterButtonClass(missingIdActive)}
            title="Show New, Open, and Pending tickets without an Airbnb user ID"
            aria-pressed={missingIdActive}
          >
            <span className="truncate">{text.compact ? "No ID" : "Missing ID"}</span>
          </button>
        </div>
        <div className="mt-2 grid grid-cols-[minmax(0,1fr)_5rem] items-stretch gap-2">
          <button
            type="button"
            onClick={() => onSortByChange(sortBy === "submitted" ? "updated" : "submitted")}
            className={`${sortButtonBase} min-w-0 truncate ${
              sortBy === "updated"
                ? "border-zendesk-green bg-green-50 text-zendesk-navy"
                : "border-zendesk-border text-zendesk-muted hover:bg-gray-100"
            }`}
            title={
              sortBy === "submitted"
                ? "Sorted by form submission date — click for recently updated"
                : "Sorted by recently updated — click for form submission date"
            }
            aria-pressed={sortBy === "updated"}
          >
            <span className="block truncate">{sortByLabel}</span>
          </button>
          <button
            type="button"
            onClick={() => onSortOrderChange(sortNewestFirst ? "asc" : "desc")}
            className={`${sortButtonBase} flex w-full shrink-0 items-center justify-center gap-1 border-zendesk-border text-zendesk-muted hover:bg-gray-100`}
            title={
              sortNewestFirst
                ? sortBy === "updated"
                  ? "Most recently updated first — click for least recent"
                  : "Newest form submissions first — click for oldest first"
                : sortBy === "updated"
                  ? "Least recently updated first — click for most recent"
                  : "Oldest form submissions first — click for newest first"
            }
          >
            {sortNewestFirst ? (
              <ArrowDownWideNarrow className={`${text.icon} shrink-0`} />
            ) : (
              <ArrowUpWideNarrow className={`${text.icon} shrink-0`} />
            )}
            <span className="truncate">{sortOrderLabel}</span>
          </button>
        </div>
      </div>
      <div ref={listRef} className="flex-1 overflow-y-auto scroll-smooth">
        {loading && (
          <p className={`p-4 ${text.body} text-zendesk-muted`}>Loading tickets...</p>
        )}
        {!loading && tickets.length === 0 && (
          <p className={`p-4 ${text.body} text-zendesk-muted`}>No tickets match this view.</p>
        )}
        {tickets.map((ticket) => {
          const lastResponseLabel = formatLastResponseHours(ticket.lastResponseAt);
          const slaPreview = getSlaCountdownPreviewForTicket(ticket);
          const [reso, listing] = getResoAndListingValues(ticket);
          const idHint =
            reso && listing
              ? `Reso ${reso} · Listing ${listing}`
              : reso
                ? `Reso ${reso}`
                : listing
                  ? `Listing ${listing}`
                  : null;
          return (
            <button
              key={ticket.rowId}
              type="button"
              data-ticket-id={ticket.rowId}
              onClick={() => onSelect(ticket.rowId)}
              className={`block w-full border-b border-zendesk-border text-left transition-colors duration-200 ${
                text.compact ? "px-2 py-2" : "px-3 py-2.5"
              } ${
                selectedId === ticket.rowId
                  ? "bg-blue-50 ring-1 ring-inset ring-blue-200/80"
                  : "hover:bg-gray-100"
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <p className={`line-clamp-1 ${text.body} font-medium`}>
                  {ticketListPrimaryLine(ticket)}
                </p>
                <div className="flex shrink-0 items-center gap-1">
                  {ticket.needsInitialResponse && (
                    <span
                      className={`rounded bg-red-600 px-1.5 py-0.5 ${text.tiny} font-semibold text-white`}
                      title={`No initial response within ${initialResponseHours} hours`}
                    >
                      {initialResponseLabel}
                    </span>
                  )}
                  {lastResponseLabel && (
                    <span
                      className={`rounded bg-gray-100 px-1.5 py-0.5 ${text.tiny} font-medium text-zendesk-muted`}
                      title="Hours since last response"
                    >
                      {lastResponseLabel}
                    </span>
                  )}
                  {slaPreview && (
                    <span
                      className={`rounded px-1.5 py-0.5 ${text.tiny} font-semibold ${slaCountdownClassName(slaPreview.tone)}`}
                      title={`Response SLA due ${ticket.slaDueAt ? new Date(ticket.slaDueAt).toLocaleString() : ""}`}
                    >
                      {slaPreview.label}
                    </span>
                  )}
                </div>
              </div>
              <p className={`mt-0.5 line-clamp-1 ${text.small} text-zendesk-muted`}>
                {ticket.requesterName || ticket.requesterEmail}
              </p>
              {idHint && (
                <p className={`mt-0.5 line-clamp-1 font-mono ${text.tiny} text-zendesk-muted`}>{idHint}</p>
              )}
              <div className={`mt-1 flex items-center justify-between ${text.tiny} text-zendesk-muted`}>
                <span>{statusLabel(ticket.status)}</span>
                <span>{ticket.timestamp?.slice(0, 10)}</span>
              </div>
            </button>
          );
        })}
      </div>
    </section>
  );
}
