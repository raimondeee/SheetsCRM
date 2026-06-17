import { ChevronLeft, ChevronRight, LayoutDashboard, Mail, Ticket } from "lucide-react";
import { DEFAULT_STATUSES } from "@/lib/types";
import { panelTextSizes } from "@/lib/panel-density";
import { SidebarCalendarPanel } from "./SidebarCalendarPanel";

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
  calendarEnabled?: boolean;
  onOpenUnreadInbox?: () => void;
}

function sidebarNavItemClass(
  selected: boolean,
  text: ReturnType<typeof panelTextSizes>,
  accentColor?: string
) {
  const labelSize = text.compact ? text.small : text.body;
  const base = `mb-1 flex w-full items-center justify-between rounded-r-md border-l-4 py-1 pr-2 pl-1.5 text-left ${labelSize} leading-tight transition-colors`;
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
  calendarEnabled = false,
  onOpenUnreadInbox,
}: SidebarProps) {
  const text = panelTextSizes(fontScale);
  const inboxShortcutFromDashboard = activeView === "dashboard";
  const inboxLabel = inboxShortcutFromDashboard ? "Inbox" : "All tickets";
  const inboxStatusId = inboxShortcutFromDashboard ? "new" : "all";
  const inboxCount = counts[inboxStatusId] ?? 0;
  const inboxSelected = activeView === "tickets" && statusFilter === inboxStatusId;

  function openInbox() {
    onViewChange("tickets");
    onStatusFilter(inboxStatusId);
  }

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
            onClick={openInbox}
            title={`${inboxLabel} (${inboxCount})`}
            className={`${sidebarIconButtonClass(inboxSelected)} relative h-9 w-9`}
          >
            <Ticket className="h-4 w-4 text-zendesk-navy" />
            {inboxCount > 0 && (
              <span className="absolute -right-0.5 -top-0.5 min-w-[1rem] rounded-full bg-zendesk-navy px-1 text-center text-[9px] font-semibold leading-4 text-white">
                {inboxCount > 99 ? "99+" : inboxCount}
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
        {onOpenUnreadInbox && (
          <button
            type="button"
            onClick={onOpenUnreadInbox}
            title="Open unread Gmail inbox"
            aria-label="Open unread Gmail inbox"
            className="mx-1 mb-2 flex h-9 w-9 items-center justify-center rounded-md border border-zendesk-border bg-white text-zendesk-navy shadow-sm hover:bg-gray-100"
          >
            <Mail className="h-4 w-4" />
          </button>
        )}
      </aside>
    );
  }

  return (
    <aside className="flex h-full min-h-0 w-full flex-col border-r border-zendesk-border bg-zendesk-sidebar">
      <div className={`flex items-center justify-between border-b border-zendesk-border ${text.compact ? "px-2 py-1.5" : "px-3 py-2"}`}>
        <p className={`${text.micro} font-semibold uppercase tracking-wide text-zendesk-muted`}>Views</p>
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
      <nav className={`min-h-0 flex-1 overflow-y-auto ${text.compact ? "p-1.5" : "p-2"}`}>
        <button
          type="button"
          onClick={() => onViewChange("dashboard")}
          className={sidebarNavItemClass(activeView === "dashboard", text)}
        >
          <span className="flex min-w-0 items-center gap-1.5">
            <LayoutDashboard className={`${text.icon} shrink-0 text-zendesk-teal`} />
            <span className="truncate">Dashboard</span>
          </span>
        </button>
        <button
          type="button"
          onClick={openInbox}
          className={`${sidebarNavItemClass(inboxSelected, text)} mb-2`}
        >
          <span className="truncate">{inboxLabel}</span>
          <span className={`shrink-0 ${text.micro} ${inboxSelected ? "font-semibold text-zendesk-navy" : "text-zendesk-muted"}`}>
            {inboxCount}
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
                <span className="flex min-w-0 items-center gap-1.5">
                  <span
                    className={`inline-block shrink-0 rounded-full ${text.compact ? "h-1.5 w-1.5" : "h-2 w-2"}`}
                    style={{ backgroundColor: status.color }}
                  />
                  <span className="truncate">{status.label}</span>
                </span>
                <span className={`shrink-0 ${text.micro} ${selected ? "font-semibold text-zendesk-navy" : "text-zendesk-muted"}`}>
                  {counts[status.id] ?? 0}
                </span>
              </button>
            );
            })}
          </>
        )}
      </nav>
      <div className="mt-auto shrink-0 pb-14">
        <SidebarCalendarPanel enabled={calendarEnabled} fontScale={fontScale} />
        {onOpenUnreadInbox && (
          <div className={`border-t border-zendesk-border ${text.compact ? "p-2" : "p-2.5"}`}>
            <button
              type="button"
              onClick={onOpenUnreadInbox}
              className={`flex w-full items-center justify-center gap-1.5 rounded border border-zendesk-border bg-white px-2 py-2 ${text.tiny} font-medium text-zendesk-navy shadow-sm hover:bg-gray-100`}
              title="Open unread Gmail inbox"
            >
              <Mail className={`${text.icon} shrink-0`} />
              <span className="truncate">Unread Gmail</span>
            </button>
          </div>
        )}
      </div>
    </aside>
  );
}
