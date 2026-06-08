import { DEFAULT_STATUSES } from "@/lib/types";

interface SidebarProps {
  statusFilter: string;
  onStatusFilter: (id: string) => void;
  counts: Record<string, number>;
}

export function Sidebar({ statusFilter, onStatusFilter, counts }: SidebarProps) {
  return (
    <aside className="flex w-52 shrink-0 flex-col border-r border-zendesk-border bg-zendesk-sidebar">
      <div className="border-b border-zendesk-border px-4 py-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-zendesk-muted">Views</p>
      </div>
      <nav className="flex-1 overflow-y-auto p-2">
        <button
          type="button"
          onClick={() => onStatusFilter("all")}
          className={`mb-1 flex w-full items-center justify-between rounded px-3 py-2 text-left text-sm ${
            statusFilter === "all" ? "bg-white font-medium shadow-sm" : "hover:bg-white/60"
          }`}
        >
          <span>All tickets</span>
          <span className="text-xs text-zendesk-muted">{counts.all ?? 0}</span>
        </button>
        {DEFAULT_STATUSES.map((status) => (
          <button
            key={status.id}
            type="button"
            onClick={() => onStatusFilter(status.id)}
            className={`mb-1 flex w-full items-center justify-between rounded px-3 py-2 text-left text-sm ${
              statusFilter === status.id ? "bg-white font-medium shadow-sm" : "hover:bg-white/60"
            }`}
          >
            <span className="flex items-center gap-2">
              <span
                className="inline-block h-2 w-2 rounded-full"
                style={{ backgroundColor: status.color }}
              />
              {status.label}
            </span>
            <span className="text-xs text-zendesk-muted">{counts[status.id] ?? 0}</span>
          </button>
        ))}
      </nav>
      <div className="border-t border-zendesk-border p-3 text-xs text-zendesk-muted">
        Status is stored in CRM overlay — sheet Column N is read-only reference.
        <br />
        Use the sliders icon in the header to set your default view.
      </div>
    </aside>
  );
}
