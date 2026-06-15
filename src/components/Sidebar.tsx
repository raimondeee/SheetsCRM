import { ChevronLeft, ChevronRight, LayoutDashboard, Ticket } from "lucide-react";
import { DEFAULT_STATUSES } from "@/lib/types";
import { panelTextSizes } from "@/lib/panel-density";

export type AppView = "tickets" | "dashboard";

interface SidebarProps {
  activeView: AppView;
  onViewChange: (view: AppView) => void;
  statusFilter: string;
  onStatusFilter: (id: string) => void;
  counts: Record<string, number>;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  fontScale?: number;
}

function sidebarNavItemClass(
  selected: boolean,
  text: ReturnType<typeof panelTextSizes>,
  accentColor?: string
) {
  const base = `mb-1 flex w-full items-center justify-between rounded-r-md border-l-4 py-1.5 pr-2.5 pl-2 text-left ${text.body} transition-colors`;
  if (selected) {
    const borderClass = accentColor ? "" : "border-zendesk-green";
    return `${base} ${borderClass} bg-blue-50 font-semibold text-zendesk-navy shadow-sm ring-1 ring-inset ring-blue-200/80`;
  }
  return `${base} border-transparent text-zendesk-muted hover:border-zendesk-border hover:bg-white/90 hover:text-zendesk-navy`;
}

function sidebarIconButtonClass(selected: boolean) {
  const base = "flex items-center justify-center rounded-md transition-colors";
  if (selected) {
    return `${base} bg-blue-50 text-zendesk-navy shadow-sm ring-2 ring-zendesk-green/50`;
  }
  return `${base} text-zendesk-muted hover:bg-white/90 hover:text-zendesk-navy`;
}

export function Sidebar({
  activeView,
  onViewChange,
  statusFilter,
  onStatusFilter,
  counts,
  collapsed,
  onToggleCollapsed,
  fontScale = 1,
}: SidebarProps) {
  const text = panelTextSizes(fontScale);
  if (collapsed) {
    return (
      <aside className="flex h-full w-full flex-col border-r border-zendesk-border bg-zendesk-sidebar">
        <button
          type="button"
          onClick={onToggleCollapsed}
          title="Expand views"
          aria-label="Expand views"
          className="flex h-10 items-center justify-center border-b border-zendesk-border text-zendesk-muted hover:bg-white/60 hover:text-zendesk-navy"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
        <nav className="flex flex-1 flex-col items-center gap-1 overflow-y-auto p-1">
          <button
            type="button"
            onClick={() => onViewChange("dashboard")}
            title="Dashboard"
            className={`${sidebarIconButtonClass(activeView === "dashboard")} h-9 w-9`}
          >
            <LayoutDashboard className="h-4 w-4 text-zendesk-teal" />
          </button>
          <button
            type="button"
            onClick={() => {
              onViewChange("tickets");
              onStatusFilter("all");
            }}
            title={`All tickets (${counts.all ?? 0})`}
            className={`${sidebarIconButtonClass(activeView === "tickets" && statusFilter === "all")} relative h-9 w-9`}
          >
            <Ticket className="h-4 w-4 text-zendesk-navy" />
            {(counts.all ?? 0) > 0 && (
              <span className="absolute -right-0.5 -top-0.5 min-w-[1rem] rounded-full bg-zendesk-navy px-1 text-center text-[9px] font-semibold leading-4 text-white">
                {(counts.all ?? 0) > 99 ? "99+" : counts.all}
              </span>
            )}
          </button>
          {activeView === "tickets" &&
            DEFAULT_STATUSES.map((status) => (
              <button
                key={status.id}
                type="button"
                onClick={() => {
                  onViewChange("tickets");
                  onStatusFilter(status.id);
                }}
                title={`${status.label} (${counts[status.id] ?? 0})`}
                className={`${sidebarIconButtonClass(statusFilter === status.id)} h-7 w-7`}
              >
                <span
                  className="inline-block h-2.5 w-2.5 rounded-full"
                  style={{ backgroundColor: status.color }}
                />
              </button>
            ))}
        </nav>
      </aside>
    );
  }

  return (
    <aside className="flex h-full w-full flex-col border-r border-zendesk-border bg-zendesk-sidebar">
      <div className="flex items-center justify-between border-b border-zendesk-border px-3 py-2">
        <p className={`${text.tiny} font-semibold uppercase tracking-wide text-zendesk-muted`}>Views</p>
        <button
          type="button"
          onClick={onToggleCollapsed}
          title="Collapse views"
          aria-label="Collapse views"
          className="rounded p-1 text-zendesk-muted hover:bg-white/60 hover:text-zendesk-navy"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
        </button>
      </div>
      <nav className="flex-1 overflow-y-auto p-2">
        <button
          type="button"
          onClick={() => onViewChange("dashboard")}
          className={sidebarNavItemClass(activeView === "dashboard", text)}
        >
          <span className="flex min-w-0 items-center gap-2">
            <LayoutDashboard className="h-4 w-4 shrink-0 text-zendesk-teal" />
            <span>Dashboard</span>
          </span>
        </button>
        <button
          type="button"
          onClick={() => {
            onViewChange("tickets");
            onStatusFilter("all");
          }}
          className={`${sidebarNavItemClass(activeView === "tickets" && statusFilter === "all", text)} mb-2`}
        >
          <span>All tickets</span>
          <span className={`${text.small} ${activeView === "tickets" && statusFilter === "all" ? "font-semibold text-zendesk-navy" : "text-zendesk-muted"}`}>
            {counts.all ?? 0}
          </span>
        </button>
        {activeView === "tickets" && (
          <>
            {DEFAULT_STATUSES.map((status) => {
              const selected = activeView === "tickets" && statusFilter === status.id;
              return (
              <button
                key={status.id}
                type="button"
                onClick={() => {
                  onViewChange("tickets");
                  onStatusFilter(status.id);
                }}
                className={sidebarNavItemClass(selected, text, status.color)}
                style={selected ? { borderLeftColor: status.color } : undefined}
              >
                <span className="flex min-w-0 items-center gap-2">
                  <span
                    className="inline-block h-2 w-2 shrink-0 rounded-full"
                    style={{ backgroundColor: status.color }}
                  />
                  <span className="truncate">{status.label}</span>
                </span>
                <span className={`shrink-0 ${text.small} ${selected ? "font-semibold text-zendesk-navy" : "text-zendesk-muted"}`}>
                  {counts[status.id] ?? 0}
                </span>
              </button>
            );
            })}
          </>
        )}
      </nav>
      <div className={`hidden border-t border-zendesk-border p-2.5 ${text.tiny} leading-snug text-zendesk-muted xl:block`}>
        Status is stored in CRM overlay — sheet Column N is read-only reference.
      </div>
    </aside>
  );
}
