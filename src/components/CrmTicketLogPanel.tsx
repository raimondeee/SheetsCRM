"use client";

import { useEffect, useState } from "react";

interface CrmLogSettings {
  status: string;
  statusLabel: string;
  statusSource: "sheet" | "crm";
  statusChangedAt: string | null;
  pendingReopenHours: number | null;
  pendingTimerLabel: string;
  pendingReopenDueAt: string | null;
  slaHours: number;
  slaDueAt: string | null;
}

interface CrmLogEvent {
  id: string;
  kind: string;
  summary: string;
  detail: Record<string, unknown> | null;
  createdAt: string;
}

interface CrmTicketLogPanelProps {
  rowId: string;
  fillHeight?: boolean;
}

function formatWhen(iso: string | null): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString();
}

function kindLabel(kind: string): string {
  switch (kind) {
    case "status_change":
      return "Status";
    case "pending_timer":
      return "Pending timer";
    case "auto_reopen":
      return "Auto-reopen";
    case "sla_change":
      return "SLA";
    case "anchor_backfill":
      return "Timer restored";
    default:
      return kind;
  }
}

export function CrmTicketLogPanel({ rowId, fillHeight = false }: CrmTicketLogPanelProps) {
  const [settings, setSettings] = useState<CrmLogSettings | null>(null);
  const [events, setEvents] = useState<CrmLogEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    void (async () => {
      try {
        const res = await fetch(`/api/tickets/${encodeURIComponent(rowId)}/crm-log`);
        const data = await res.json();
        if (!res.ok || data.error) {
          throw new Error(data.error || "Failed to load CRM log");
        }
        if (cancelled) return;
        setSettings(data.settings ?? null);
        setEvents(Array.isArray(data.events) ? data.events : []);
      } catch (err) {
        if (cancelled) return;
        setSettings(null);
        setEvents([]);
        setError(err instanceof Error ? err.message : "Failed to load CRM log");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [rowId]);

  const pendingDuePassed =
    settings?.pendingReopenDueAt &&
    new Date(settings.pendingReopenDueAt).getTime() <= Date.now();

  return (
    <div
      className={
        fillHeight
          ? "flex h-full flex-col overflow-hidden p-2.5 pb-1.25"
          : "overflow-y-auto p-2.5 pb-1.25"
      }
    >
      <div className={`crm-notes-panel ${fillHeight ? "flex min-h-0 flex-1 flex-col" : ""}`}>
        <div
          className={`crm-notes-content text-sm ${fillHeight ? "crm-notes-content-compose" : ""}`}
        >
          {loading ? (
            <p className="text-xs text-zendesk-muted">Loading CRM log…</p>
          ) : error ? (
            <p className="text-xs text-red-600">{error}</p>
          ) : (
            <div className="space-y-4">
              {settings && (
                <section>
                  <h4 className="text-[10px] font-semibold uppercase tracking-wide text-zendesk-muted">
                    Current CRM settings
                  </h4>
                  <dl className="mt-2 space-y-1.5 text-xs">
                    <div className="flex justify-between gap-3">
                      <dt className="text-zendesk-muted">Status</dt>
                      <dd className="font-medium text-zendesk-navy">
                        {settings.statusLabel}
                        <span className="ml-1 font-normal text-zendesk-muted">
                          ({settings.statusSource})
                        </span>
                      </dd>
                    </div>
                    {settings.status === "pending" && (
                      <>
                        <div className="flex justify-between gap-3">
                          <dt className="text-zendesk-muted">Pending since</dt>
                          <dd className="text-zendesk-navy">
                            {formatWhen(settings.statusChangedAt)}
                          </dd>
                        </div>
                        <div className="flex justify-between gap-3">
                          <dt className="text-zendesk-muted">Auto-reopen timer</dt>
                          <dd className="text-right text-zendesk-navy">
                            {settings.pendingTimerLabel}
                          </dd>
                        </div>
                        <div className="flex justify-between gap-3">
                          <dt className="text-zendesk-muted">Reopen due</dt>
                          <dd
                            className={
                              pendingDuePassed
                                ? "font-medium text-amber-900"
                                : "text-zendesk-navy"
                            }
                          >
                            {formatWhen(settings.pendingReopenDueAt)}
                            {pendingDuePassed ? " (overdue)" : ""}
                          </dd>
                        </div>
                      </>
                    )}
                    <div className="flex justify-between gap-3">
                      <dt className="text-zendesk-muted">Response SLA</dt>
                      <dd className="text-zendesk-navy">
                        {settings.slaHours}h
                        {settings.slaDueAt ? ` · due ${formatWhen(settings.slaDueAt)}` : ""}
                      </dd>
                    </div>
                  </dl>
                </section>
              )}

              <section>
                <h4 className="text-[10px] font-semibold uppercase tracking-wide text-zendesk-muted">
                  CRM activity
                </h4>
                {events.length === 0 ? (
                  <p className="mt-2 text-xs text-zendesk-muted">
                    No CRM events recorded yet. Status changes and timers are logged from here on.
                  </p>
                ) : (
                  <ul className="mt-2 space-y-2">
                    {events.map((event) => (
                      <li
                        key={event.id}
                        className="rounded border border-zendesk-border/60 bg-white/50 px-2.5 py-2 text-xs"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <span className="font-medium text-zendesk-navy">{event.summary}</span>
                          <span className="shrink-0 text-[10px] text-zendesk-muted">
                            {formatWhen(event.createdAt)}
                          </span>
                        </div>
                        <p className="mt-0.5 text-[10px] uppercase tracking-wide text-zendesk-muted">
                          {kindLabel(event.kind)}
                        </p>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </div>
          )}
        </div>
        <p className="mt-1 text-[10px] text-zendesk-muted">
          CRM-only log — status changes, timers, and auto-reopens
        </p>
      </div>
    </div>
  );
}
