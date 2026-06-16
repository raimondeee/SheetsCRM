"use client";

import { useCallback, useEffect, useState } from "react";
import type { OpsHealthStatus, OpsMetricsSnapshot } from "@/lib/ops-metrics";

const POLL_MS = 30_000;

function statusDotClass(status: OpsHealthStatus): string {
  switch (status) {
    case "ok":
      return "bg-emerald-500";
    case "warn":
      return "bg-amber-500";
    case "error":
      return "bg-red-500";
    case "disabled":
      return "bg-gray-300";
    default:
      return "bg-slate-400";
  }
}

function statusLabel(status: OpsHealthStatus): string {
  switch (status) {
    case "ok":
      return "Healthy";
    case "warn":
      return "Degraded";
    case "error":
      return "Error";
    case "disabled":
      return "Not configured";
    default:
      return "Idle";
  }
}

function formatRelativeTime(iso: string | null): string {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return "just now";
  if (ms < 60 * 60_000) return `${Math.round(ms / 60_000)}m ago`;
  if (ms < 24 * 60 * 60_000) return `${Math.round(ms / (60 * 60_000))}h ago`;
  return new Date(iso).toLocaleString();
}

export function IntegrationsHealthPanel() {
  const [metrics, setMetrics] = useState<OpsMetricsSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/ops/metrics", { cache: "no-store" });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
      setMetrics((await res.json()) as OpsMetricsSnapshot);
      setFetchError(null);
    } catch (error) {
      setFetchError(error instanceof Error ? error.message : "Failed to load metrics");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const id = setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, POLL_MS);
    return () => clearInterval(id);
  }, [load]);

  const hasProblem =
    metrics?.integrations.some((i) => i.status === "error" || i.status === "warn") ||
    Boolean(metrics?.lastTicketListError);

  return (
    <section className="rounded-lg border border-zendesk-border bg-white p-4 shadow-sm">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-zendesk-navy">Integrations health</h2>
          <p className="text-xs text-zendesk-muted">
            API activity from this server · updates every 30s
            {metrics
              ? ` · ticket list ~${metrics.autoRefreshSeconds}s auto-refresh`
              : ""}
          </p>
        </div>
        {metrics && (
          <p className="text-[10px] text-zendesk-muted">
            Updated {formatRelativeTime(metrics.generatedAt)}
          </p>
        )}
      </div>

      {loading && !metrics && (
        <p className="text-xs text-zendesk-muted">Loading integration metrics…</p>
      )}

      {fetchError && (
        <p className="mb-2 rounded border border-red-200 bg-red-50 px-2 py-1.5 text-xs text-red-800">
          {fetchError}
        </p>
      )}

      {metrics && (
        <>
          {(hasProblem || metrics.lastTicketListError) && (
            <div className="mb-3 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-950">
              {metrics.lastTicketListError ? (
                <p>
                  <span className="font-medium">Last ticket list refresh failed:</span>{" "}
                  {metrics.lastTicketListError}
                </p>
              ) : (
                <p>One or more integrations look degraded — check details below.</p>
              )}
            </div>
          )}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {metrics.integrations.map((integration) => (
              <div
                key={integration.id}
                className="rounded border border-zendesk-border bg-gray-50/80 px-3 py-2.5"
              >
                <div className="flex items-center gap-2">
                  <span
                    className={`h-2.5 w-2.5 shrink-0 rounded-full ${statusDotClass(integration.status)}`}
                    aria-hidden
                  />
                  <span className="text-sm font-medium text-zendesk-navy">
                    {integration.label}
                  </span>
                  <span className="ml-auto text-[10px] font-medium uppercase tracking-wide text-zendesk-muted">
                    {statusLabel(integration.status)}
                  </span>
                </div>
                <dl className="mt-2 grid grid-cols-2 gap-x-2 gap-y-1 text-[11px]">
                  <dt className="text-zendesk-muted">Last hour</dt>
                  <dd className="text-right font-medium text-zendesk-navy">
                    {integration.callsLastHour} calls
                  </dd>
                  <dt className="text-zendesk-muted">Projected / hr</dt>
                  <dd className="text-right font-medium text-zendesk-navy">
                    ~{integration.projectedCallsPerHour}
                  </dd>
                  {integration.successRateLastHour != null && (
                    <>
                      <dt className="text-zendesk-muted">Success</dt>
                      <dd className="text-right text-zendesk-navy">
                        {integration.successRateLastHour}%
                      </dd>
                    </>
                  )}
                  {integration.avgLatencyMs != null && (
                    <>
                      <dt className="text-zendesk-muted">Avg latency</dt>
                      <dd className="text-right text-zendesk-navy">
                        {integration.avgLatencyMs}ms
                      </dd>
                    </>
                  )}
                  <dt className="text-zendesk-muted">Last OK</dt>
                  <dd className="text-right text-zendesk-navy">
                    {formatRelativeTime(integration.lastSuccessAt)}
                  </dd>
                </dl>
                {integration.lastError && integration.status !== "ok" && (
                  <p
                    className="mt-2 line-clamp-2 text-[10px] leading-snug text-red-700"
                    title={integration.lastError}
                  >
                    {integration.lastError}
                  </p>
                )}
                {integration.recentOperations.length > 0 && (
                  <p className="mt-1.5 text-[10px] text-zendesk-muted">
                    Recent: {integration.recentOperations.join(", ")}
                  </p>
                )}
              </div>
            ))}
          </div>

          <p className="mt-3 text-[10px] text-zendesk-muted">
            Ticket list refreshes (last hour): {metrics.ticketListRefreshesLastHour}
            {metrics.lastTicketListRefreshAt
              ? ` · last ${formatRelativeTime(metrics.lastTicketListRefreshAt)}`
              : ""}
            . Projected rate extrapolates the last 15 minutes. Google Cloud Console shows
            official quota limits.
          </p>
        </>
      )}
    </section>
  );
}
