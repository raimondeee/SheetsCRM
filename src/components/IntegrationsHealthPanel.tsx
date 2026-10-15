"use client";

import { useCallback, useEffect, useState } from "react";
import { Copy, RefreshCw } from "lucide-react";
import type {
  OpsAuthTimingSnapshot,
  OpsHealthStatus,
  OpsMetricsSnapshot,
} from "@/lib/ops-metrics";

const POLL_MS = 30_000;
const EVENT_LOOP_WARN_P95_MS = 50;
const EVENT_LOOP_WARN_MAX_MS = 200;
const AUTH_SLOW_MS = 3_000;
const REQUEST_SLOW_MS = 2_000;
const REQUEST_VERY_SLOW_MS = 10_000;

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

function formatDuration(ms: number | null | undefined): string {
  if (ms == null) return "—";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(ms >= 10_000 ? 1 : 2)}s`;
}

function durationClass(ms: number | null | undefined): string {
  if (ms == null) return "text-zendesk-navy";
  if (ms >= REQUEST_VERY_SLOW_MS) return "font-semibold text-red-700";
  if (ms >= REQUEST_SLOW_MS) return "font-medium text-amber-800";
  return "text-zendesk-navy";
}

function eventLoopIsHot(metrics: OpsMetricsSnapshot): boolean {
  const { p95Ms, maxMs, lastWindowMaxMs } = metrics.eventLoop;
  const peak = Math.max(maxMs ?? 0, lastWindowMaxMs ?? 0);
  return (p95Ms ?? 0) >= EVENT_LOOP_WARN_P95_MS || peak >= EVENT_LOOP_WARN_MAX_MS;
}

function authIsSlow(timing: OpsAuthTimingSnapshot | null): boolean {
  if (!timing) return false;
  return (timing.requestMs ?? 0) >= AUTH_SLOW_MS || (timing.handlerMs ?? 0) >= AUTH_SLOW_MS;
}

function stallBanner(metrics: OpsMetricsSnapshot): string | null {
  if (metrics.lastTicketListError) {
    return `Last ticket list refresh failed: ${metrics.lastTicketListError}`;
  }
  if (authIsSlow(metrics.auth.lastGoogleRedirect)) {
    const ms = metrics.auth.lastGoogleRedirect?.requestMs;
    return `Sign-in redirect sat in this server for ${formatDuration(ms)} — Google’s account picker had not started yet.`;
  }
  if (eventLoopIsHot(metrics) || (metrics.stalls.lastDriftMs ?? 0) >= 1_000) {
    return "Node event loop looks stalled. Cheap routes (including sign-in) will wait behind Sheets/Gmail or Webpack compile.";
  }
  if (metrics.integrations.some((i) => i.status === "error" || i.status === "warn")) {
    return "One or more integrations look degraded — check details below.";
  }
  return null;
}

function AuthTimingRow({
  label,
  timing,
}: {
  label: string;
  timing: OpsAuthTimingSnapshot | null;
}) {
  if (!timing) {
    return (
      <div className="text-[11px] text-zendesk-muted">
        <span className="font-medium text-zendesk-navy">{label}</span>
        <span className="ml-2">no attempts this process</span>
      </div>
    );
  }

  return (
    <div className="text-[11px]">
      <div className="flex flex-wrap items-baseline gap-x-2">
        <span className="font-medium text-zendesk-navy">{label}</span>
        <span className={timing.ok ? "text-zendesk-muted" : "text-red-700"}>
          {timing.ok ? "ok" : "failed"} · {formatRelativeTime(timing.at)}
        </span>
      </div>
      <dl className="mt-1 grid grid-cols-2 gap-x-3 gap-y-0.5 sm:grid-cols-4">
        <dt className="text-zendesk-muted">Request (queue + handler)</dt>
        <dd className={`text-right ${durationClass(timing.requestMs)}`}>
          {formatDuration(timing.requestMs)}
        </dd>
        <dt className="text-zendesk-muted">Handler only</dt>
        <dd className={`text-right ${durationClass(timing.handlerMs)}`}>
          {formatDuration(timing.handlerMs)}
        </dd>
      </dl>
      {timing.requestMs != null &&
        timing.handlerMs != null &&
        timing.requestMs - timing.handlerMs >= AUTH_SLOW_MS && (
          <p className="mt-1 text-[10px] text-amber-800">
            Most of the wait was before the handler ran (compile or event-loop queue).
          </p>
        )}
      {timing.error && <p className="mt-1 text-[10px] text-red-700">{timing.error}</p>}
    </div>
  );
}

export function IntegrationsHealthPanel() {
  const [metrics, setMetrics] = useState<OpsMetricsSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

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

  const banner = metrics ? stallBanner(metrics) : null;
  const inFlightGoogle = metrics
    ? [
        metrics.inFlight.sheets > 0 ? `${metrics.inFlight.sheets} Sheets` : null,
        metrics.inFlight.gmail > 0 ? `${metrics.inFlight.gmail} Gmail` : null,
        metrics.inFlight.mixmax > 0 ? `${metrics.inFlight.mixmax} Mixmax` : null,
      ].filter(Boolean)
    : [];

  async function copyDiagnostics() {
    if (!metrics) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(metrics, null, 2));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <section className="rounded-lg border border-zendesk-border bg-white p-4 shadow-sm">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-zendesk-navy">Integrations health</h2>
          <p className="text-xs text-zendesk-muted">
            API activity and server stalls from this process · updates every 30s
            {metrics
              ? ` · ticket list ~${metrics.autoRefreshSeconds}s auto-refresh`
              : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {metrics && (
            <p className="text-[10px] text-zendesk-muted">
              Updated {formatRelativeTime(metrics.generatedAt)}
            </p>
          )}
          <button
            type="button"
            onClick={() => void load()}
            className="inline-flex items-center gap-1 rounded border border-zendesk-border px-2 py-1 text-[10px] text-zendesk-navy hover:bg-gray-50"
          >
            <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </button>
          <button
            type="button"
            onClick={() => void copyDiagnostics()}
            disabled={!metrics}
            className="inline-flex items-center gap-1 rounded border border-zendesk-border px-2 py-1 text-[10px] text-zendesk-navy hover:bg-gray-50 disabled:opacity-50"
          >
            <Copy className="h-3 w-3" />
            {copied ? "Copied" : "Copy JSON"}
          </button>
        </div>
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
          {banner && (
            <div className="mb-3 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-950">
              {banner}
            </div>
          )}

          <div className="mb-3 grid grid-cols-1 gap-3 lg:grid-cols-2">
            <div className="rounded border border-zendesk-border bg-gray-50/80 px-3 py-2.5">
              <h3 className="text-xs font-semibold text-zendesk-navy">Server stall</h3>
              <p className="mt-0.5 text-[10px] text-zendesk-muted">
                {metrics.eventLoop.enabled
                  ? `Event-loop delay over the last ${Math.max(1, Math.round(metrics.eventLoop.windowMs / 1000))}s`
                  : "Heartbeat stall detector on"}
                {metrics.eventLoop.lastWindowMaxMs != null
                  ? ` · prior window max ${formatDuration(metrics.eventLoop.lastWindowMaxMs)}`
                  : ""}
                {" · key API routes are timed"}
              </p>
              <dl className="mt-2 grid grid-cols-2 gap-x-2 gap-y-1 text-[11px]">
                <dt className="text-zendesk-muted">p50 / p95 / max</dt>
                <dd className={`text-right ${eventLoopIsHot(metrics) ? "text-amber-800" : "text-zendesk-navy"}`}>
                  {formatDuration(metrics.eventLoop.p50Ms)} / {formatDuration(metrics.eventLoop.p95Ms)} /{" "}
                  {formatDuration(metrics.eventLoop.maxMs)}
                </dd>
                <dt className="text-zendesk-muted">In flight</dt>
                <dd className="text-right text-zendesk-navy">
                  {metrics.inFlight.apiRequests} API
                  {metrics.inFlight.googleCalls > 0
                    ? ` · ${metrics.inFlight.googleCalls} Google`
                    : ""}
                </dd>
                <dt className="text-zendesk-muted">Last stall</dt>
                <dd className="text-right text-zendesk-navy">
                  {metrics.stalls.lastDriftMs != null
                    ? `${formatDuration(metrics.stalls.lastDriftMs)} · ${formatRelativeTime(metrics.stalls.lastAt)}`
                    : "none"}
                </dd>
                <dt className="text-zendesk-muted">Stalls / hour</dt>
                <dd className="text-right text-zendesk-navy">{metrics.stalls.lastHour}</dd>
              </dl>
              {inFlightGoogle.length > 0 && (
                <p className="mt-1.5 text-[10px] text-zendesk-muted">
                  Google now: {inFlightGoogle.join(" · ")}
                </p>
              )}
              {metrics.inFlight.paths.length > 0 && (
                <p className="mt-1 text-[10px] text-zendesk-muted">
                  Open: {metrics.inFlight.paths.map((p) => `${p.path}×${p.count}`).join(", ")}
                </p>
              )}
            </div>

            <div className="rounded border border-zendesk-border bg-gray-50/80 px-3 py-2.5">
              <h3 className="text-xs font-semibold text-zendesk-navy">Sign-in (Google OAuth)</h3>
              <p className="mt-0.5 text-[10px] text-zendesk-muted">
                Request time is how long this Node process held the redirect. Handler-only is
                generateAuthUrl / token exchange.
              </p>
              <div className="mt-2 space-y-2">
                <AuthTimingRow
                  label="/api/auth/google"
                  timing={metrics.auth.lastGoogleRedirect}
                />
                <AuthTimingRow label="/api/auth/callback" timing={metrics.auth.lastCallback} />
              </div>
            </div>
          </div>

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

          <div className="mt-3 overflow-hidden rounded border border-zendesk-border">
            <div className="flex items-center justify-between bg-gray-50 px-3 py-1.5">
              <h3 className="text-xs font-semibold text-zendesk-navy">Recent API requests</h3>
              <p className="text-[10px] text-zendesk-muted">
                Amber ≥2s · red ≥10s · inflight = other /api calls when this one started
              </p>
            </div>
            {metrics.recentRequests.length === 0 ? (
              <p className="px-3 py-2 text-[11px] text-zendesk-muted">
                No /api requests recorded yet. Open a ticket, refresh the list, or sign in.
              </p>
            ) : (
              <div className="max-h-56 overflow-auto">
                <table className="w-full border-collapse text-left text-[10px]">
                  <thead className="sticky top-0 bg-white text-zendesk-muted">
                    <tr>
                      <th className="px-3 py-1 font-medium">Time</th>
                      <th className="px-2 py-1 font-medium">Method</th>
                      <th className="px-2 py-1 font-medium">Path</th>
                      <th className="px-2 py-1 text-right font-medium">Duration</th>
                      <th className="px-2 py-1 text-right font-medium">Inflight</th>
                      <th className="px-3 py-1 text-right font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {metrics.recentRequests.map((row, index) => (
                      <tr key={`${row.at}-${row.path}-${index}`} className="border-t border-zendesk-border/70">
                        <td className="whitespace-nowrap px-3 py-1 font-mono text-zendesk-muted">
                          {new Date(row.at).toLocaleTimeString()}
                        </td>
                        <td className="px-2 py-1 font-mono text-zendesk-navy">{row.method}</td>
                        <td className="px-2 py-1 font-mono text-zendesk-navy">{row.path}</td>
                        <td className={`px-2 py-1 text-right font-mono ${durationClass(row.durationMs)}`}>
                          {formatDuration(row.durationMs)}
                        </td>
                        <td className="px-2 py-1 text-right font-mono text-zendesk-muted">
                          {row.inFlightAtStart}
                        </td>
                        <td
                          className={`px-3 py-1 text-right font-mono ${
                            row.ok ? "text-zendesk-muted" : "text-red-700"
                          }`}
                        >
                          {row.status || "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
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
