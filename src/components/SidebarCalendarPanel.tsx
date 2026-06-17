"use client";

import { useCallback, useEffect, useState } from "react";
import { Calendar, ChevronDown, ChevronUp, ExternalLink, RefreshCw } from "lucide-react";
import {
  CALENDAR_SIDEBAR_COLLAPSED_KEY,
  CALENDAR_SIDEBAR_POLL_MS,
  calendarEventCardClass,
  calendarEventHighlight,
  formatCalendarEventWhen,
  type CalendarUpcomingEvent,
} from "@/lib/calendar-reminders";
import { usePersistedBoolean } from "@/hooks/usePersistedBoolean";
import { panelTextSizes } from "@/lib/panel-density";

interface SidebarCalendarPanelProps {
  enabled: boolean;
  fontScale?: number;
}

function calendarStatusMessage(error: string | null): string | null {
  if (!error) return null;
  if (error === "calendar_scope_required") {
    return "Sign out and sign in again to grant Calendar access.";
  }
  if (error === "calendar_api_disabled") {
    return "Enable Google Calendar API in your Google Cloud project.";
  }
  if (error === "calendar_permission_denied") {
    return "Calendar access was denied. Sign out and sign in again.";
  }
  if (error === "calendar_auth_required") {
    return "Sign in with Google to see calendar events.";
  }
  if (error === "network_error") {
    return "Could not reach the calendar service. Try refresh.";
  }
  if (error.length > 120) {
    return "Could not load calendar events. Try refresh.";
  }
  return error;
}

export function SidebarCalendarPanel({ enabled, fontScale = 1 }: SidebarCalendarPanelProps) {
  const text = panelTextSizes(fontScale);
  const [events, setEvents] = useState<CalendarUpcomingEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [collapsed, setCollapsed] = usePersistedBoolean(CALENDAR_SIDEBAR_COLLAPSED_KEY, false);
  const [nowMs, setNowMs] = useState(() => Date.now());

  const load = useCallback(async () => {
    if (!enabled) return;
    setLoading(true);
    try {
      const res = await fetch("/api/calendar/upcoming", { cache: "no-store", credentials: "same-origin" });
      if (!res.ok) {
        setEvents([]);
        setError(`http_${res.status}`);
        return;
      }
      const data = (await res.json()) as {
        upcoming?: CalendarUpcomingEvent[];
        enabled?: boolean;
        error?: string | null;
      };
      if (!data.enabled) {
        setEvents([]);
        setError("calendar_auth_required");
        return;
      }
      const nextEvents = Array.isArray(data.upcoming) ? data.upcoming : [];
      setEvents(nextEvents);
      setError(nextEvents.length > 0 ? null : (data.error ?? null));
    } catch {
      setEvents([]);
      setError("network_error");
    } finally {
      setLoading(false);
    }
  }, [enabled]);

  useEffect(() => {
    if (!enabled) {
      setEvents([]);
      setError(null);
      return;
    }

    void load();
    const intervalId = window.setInterval(() => void load(), CALENDAR_SIDEBAR_POLL_MS);
    const onVisibility = () => {
      if (document.visibilityState === "visible") void load();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [enabled, load]);

  useEffect(() => {
    if (!enabled || collapsed) return;
    const tickId = window.setInterval(() => setNowMs(Date.now()), 15_000);
    return () => window.clearInterval(tickId);
  }, [enabled, collapsed]);

  if (!enabled) return null;

  const status = events.length === 0 ? calendarStatusMessage(error) : null;
  const soonCount = events.filter((e) => calendarEventHighlight(e, nowMs) === "soon").length;

  return (
    <section
      className={`shrink-0 border-t border-zendesk-border ${text.compact ? "p-2" : "p-2.5"}`}
      aria-label="Upcoming calendar events"
    >
      <div className="mb-1 flex items-center justify-between gap-1">
        <button
          type="button"
          onClick={() => setCollapsed(!collapsed)}
          className="flex min-w-0 flex-1 items-center gap-1.5 rounded text-left hover:opacity-80"
          aria-expanded={!collapsed}
          title={collapsed ? "Expand calendar" : "Collapse calendar"}
        >
          <Calendar className={`${text.icon} shrink-0 text-zendesk-teal`} />
          <p className={`${text.micro} font-semibold uppercase tracking-wide text-zendesk-muted`}>
            Calendar
          </p>
          {!collapsed && soonCount > 0 && (
            <span className="rounded bg-amber-200 px-1 py-px text-[8px] font-semibold text-amber-900">
              {soonCount}
            </span>
          )}
          {collapsed ? (
            <ChevronDown className={`${text.icon} shrink-0 text-zendesk-muted`} />
          ) : (
            <ChevronUp className={`${text.icon} shrink-0 text-zendesk-muted`} />
          )}
        </button>
        {!collapsed && (
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            title="Refresh calendar"
            aria-label="Refresh calendar"
            className="rounded p-1 text-zendesk-muted hover:bg-white/80 hover:text-zendesk-navy disabled:opacity-50"
          >
            <RefreshCw className={`${text.icon} ${loading ? "animate-spin" : ""}`} />
          </button>
        )}
      </div>

      {!collapsed && (
        <>
          {status && (
            <p className={`${text.tiny} leading-snug text-amber-800`} title={error ?? undefined}>
              {status}
            </p>
          )}

          {!status && events.length === 0 && !loading && (
            <p className={`${text.tiny} text-zendesk-muted`}>
              No upcoming events on your primary calendar.
            </p>
          )}

          {events.length > 0 && (
            <ul className="mt-1 max-h-48 space-y-1 overflow-y-auto">
              {events.map((event) => {
                const when = formatCalendarEventWhen(event.start, event.allDay);
                const highlight = calendarEventHighlight(event, nowMs);
                const cardClass = calendarEventCardClass(highlight);
                const content = (
                  <>
                    <p className={`line-clamp-2 ${text.tiny} font-medium leading-snug text-zendesk-navy`}>
                      {event.summary}
                    </p>
                    <p className={`mt-0.5 ${text.micro} text-zendesk-muted`}>{when}</p>
                  </>
                );

                if (event.htmlLink) {
                  return (
                    <li key={event.id}>
                      <a
                        href={event.htmlLink}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={`block rounded border px-2 py-1.5 ${cardClass} ${text.tiny}`}
                        title="Open in Google Calendar"
                      >
                        {content}
                        <span className={`mt-1 inline-flex items-center gap-0.5 ${text.micro} text-blue-600`}>
                          Open
                          <ExternalLink className="h-2.5 w-2.5" />
                        </span>
                      </a>
                    </li>
                  );
                }

                return (
                  <li key={event.id} className={`rounded border px-2 py-1.5 ${cardClass} ${text.tiny}`}>
                    {content}
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
