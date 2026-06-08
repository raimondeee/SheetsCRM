import type { Ticket } from "@/lib/types";
import { DEFAULT_STATUSES } from "@/lib/types";
import { formatLastResponseHours } from "@/lib/ticket-activity";
import type { SortOrder } from "@/lib/user-preferences";
import { ArrowDownWideNarrow, ArrowUpWideNarrow, Search } from "lucide-react";

interface TicketListProps {
  tickets: Ticket[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  search: string;
  onSearch: (q: string) => void;
  loading: boolean;
  sortOrder: SortOrder;
  onSortOrderChange: (order: SortOrder) => void;
  refreshLabel?: string;
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
  sortOrder,
  onSortOrderChange,
  refreshLabel,
}: TicketListProps) {
  return (
    <section className="flex w-80 shrink-0 flex-col border-r border-zendesk-border">
      <div className="border-b border-zendesk-border p-3">
        {refreshLabel && (
          <p className="mb-2 text-center text-[10px] text-zendesk-muted">{refreshLabel}</p>
        )}
        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-zendesk-muted" />
          <input
            type="search"
            placeholder="Search tickets..."
            value={search}
            onChange={(e) => onSearch(e.target.value)}
            className="w-full rounded border border-zendesk-border py-2 pl-9 pr-3 text-sm outline-none focus:border-zendesk-green"
          />
        </div>
        <div className="mt-2 flex items-center justify-between">
          <span className="text-[10px] text-zendesk-muted">Sort by last response</span>
          <button
            type="button"
            onClick={() => onSortOrderChange(sortOrder === "desc" ? "asc" : "desc")}
            className="flex items-center gap-1 rounded border border-zendesk-border px-2 py-0.5 text-[10px] font-medium text-zendesk-muted hover:bg-gray-50"
            title={sortOrder === "desc" ? "Newest first — click for oldest first" : "Oldest first — click for newest first"}
          >
            {sortOrder === "desc" ? (
              <>
                <ArrowDownWideNarrow className="h-3 w-3" />
                Newest
              </>
            ) : (
              <>
                <ArrowUpWideNarrow className="h-3 w-3" />
                Oldest
              </>
            )}
          </button>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto">
        {loading && (
          <p className="p-4 text-sm text-zendesk-muted">Loading tickets...</p>
        )}
        {!loading && tickets.length === 0 && (
          <p className="p-4 text-sm text-zendesk-muted">No tickets match this view.</p>
        )}
        {tickets.map((ticket) => {
          const lastResponseLabel = formatLastResponseHours(ticket.lastResponseAt);
          return (
            <button
              key={ticket.rowId}
              type="button"
              onClick={() => onSelect(ticket.rowId)}
              className={`block w-full border-b border-zendesk-border px-4 py-3 text-left transition-colors ${
                selectedId === ticket.rowId ? "bg-blue-50" : "hover:bg-gray-50"
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <p className="line-clamp-1 text-sm font-medium">{ticket.subject || "No subject"}</p>
                <div className="flex shrink-0 items-center gap-1">
                  {lastResponseLabel && (
                    <span
                      className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-zendesk-muted"
                      title="Hours since last response"
                    >
                      {lastResponseLabel}
                    </span>
                  )}
                  {ticket.slaBreached && (
                    <span className="rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-semibold text-red-700">
                      SLA
                    </span>
                  )}
                </div>
              </div>
              <p className="mt-0.5 line-clamp-1 text-xs text-zendesk-muted">
                {ticket.requesterName || ticket.requesterEmail}
              </p>
              <div className="mt-1 flex items-center justify-between text-xs text-zendesk-muted">
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
