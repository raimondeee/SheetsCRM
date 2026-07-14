"use client";

import { useEffect, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { DashboardPeriod } from "@/lib/dashboard-period";
import { formatBusinessMinutes } from "@/lib/business-hours";
import type { ServiceMetricsSnapshot } from "@/lib/service-metrics";
import { serviceMetricsInfoText } from "@/lib/service-metrics-info";
import { ChartInfoTooltip } from "./ChartInfoTooltip";

interface ServiceMetricsSectionProps {
  period: DashboardPeriod;
  marketManager: string;
}

export function ServiceMetricsSection({ period, marketManager }: ServiceMetricsSectionProps) {
  const [metrics, setMetrics] = useState<ServiceMetricsSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const info = serviceMetricsInfoText();

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ period });
    if (marketManager !== "all") params.set("marketManager", marketManager);

    fetch(`/api/dashboard/service-metrics?${params}`, { cache: "no-store" })
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to load service metrics");
        if (!cancelled) setMetrics(data as ServiceMetricsSnapshot);
      })
      .catch((err) => {
        if (!cancelled) {
          setMetrics(null);
          setError(err instanceof Error ? err.message : "Failed to load");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [period, marketManager]);

  if (loading) {
    return (
      <section
        className="mt-6 rounded-lg border border-zendesk-border bg-white p-4 shadow-sm"
        data-export-loading="true"
      >
        <p className="text-sm text-zendesk-muted">Loading service performance…</p>
      </section>
    );
  }

  if (error || !metrics) {
    return (
      <section className="mt-6 rounded-lg border border-zendesk-border bg-white p-4 shadow-sm">
        <p className="text-sm text-red-700">{error ?? "Service metrics unavailable"}</p>
      </section>
    );
  }

  const touchChartData = [
    { name: "1 reply", value: metrics.touches.distribution.one },
    { name: "2–3 replies", value: metrics.touches.distribution.twoToThree },
    { name: "4+ replies", value: metrics.touches.distribution.fourPlus },
  ];

  return (
    <section className="mt-6 space-y-4">
      <header className="rounded-lg border border-zendesk-border bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h2 className="text-base font-semibold text-zendesk-navy">Service performance</h2>
            <p className="mt-1 text-xs text-zendesk-muted">
              {metrics.periodLabel}
              {metrics.marketManager !== "all" ? ` · ${metrics.marketManager}` : ""} ·{" "}
              {metrics.businessHoursLabel} · metrics from{" "}
              {new Date(metrics.metricsEpochIso).toLocaleDateString()} onward only
            </p>
          </div>
        </div>
        <p className="mt-2 text-xs text-zendesk-muted">{metrics.coverageNote}</p>
      </header>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          title="Throughput"
          info={info.throughput}
          subtitle="Created vs resolved in period"
        >
          <div className="flex justify-around text-center">
            <div>
              <p className="text-3xl font-bold text-zendesk-navy">
                {metrics.throughput.createdInPeriod}
              </p>
              <p className="text-xs text-zendesk-muted">Created</p>
            </div>
            <div>
              <p className="text-3xl font-bold text-zendesk-teal">
                {metrics.throughput.resolvedInPeriod}
              </p>
              <p className="text-xs text-zendesk-muted">Resolved</p>
            </div>
          </div>
          <p className="mt-3 text-center text-xs text-zendesk-muted">
            Backlog change:{" "}
            <span
              className={
                metrics.throughput.backlogDelta > 0
                  ? "font-medium text-amber-800"
                  : metrics.throughput.backlogDelta < 0
                    ? "font-medium text-emerald-800"
                    : ""
              }
            >
              {metrics.throughput.backlogDelta > 0 ? "+" : ""}
              {metrics.throughput.backlogDelta}
            </span>
          </p>
        </MetricCard>

        <MetricCard
          title="First reply time"
          info={info.initialResponse}
          subtitle="Median · created in period"
        >
          <p className="text-center text-4xl font-bold text-zendesk-navy">
            {formatBusinessMinutes(metrics.initialResponse.medianMinutes)}
          </p>
          {metrics.initialResponse.withinTargetPct != null ? (
            <p className="mt-2 text-center text-xs text-zendesk-muted">
              {metrics.initialResponse.withinTargetPct}% within{" "}
              {metrics.initialResponse.targetBusinessHours}h target
            </p>
          ) : null}
          <p className="mt-1 text-center text-[11px] text-zendesk-muted">
            n={metrics.initialResponse.count}
            {metrics.initialResponse.p90Minutes != null
              ? ` · P90 ${formatBusinessMinutes(metrics.initialResponse.p90Minutes)}`
              : ""}
          </p>
        </MetricCard>

        <MetricCard
          title="Handle time"
          info={info.handleTime}
          subtitle="Median · resolved in period"
        >
          <p className="text-center text-4xl font-bold text-zendesk-navy">
            {formatBusinessMinutes(metrics.handleTime.medianMinutes)}
          </p>
          <p className="mt-2 text-center text-xs text-zendesk-muted">
            First agent reply → Resolved
          </p>
          <p className="mt-1 text-center text-[11px] text-zendesk-muted">
            n={metrics.handleTime.count}
          </p>
        </MetricCard>

        <MetricCard
          title="Touches & FCR"
          info={`${info.touches} ${info.fcr}`}
          subtitle="Resolved in period"
        >
          <p className="text-center text-4xl font-bold text-zendesk-navy">
            {metrics.touches.median ?? "—"}
          </p>
          <p className="mt-2 text-center text-xs text-zendesk-muted">
            Median agent replies before resolve
          </p>
          {metrics.firstContactResolutionPct != null ? (
            <p className="mt-1 text-center text-[11px] text-zendesk-muted">
              {metrics.firstContactResolutionPct}% first-contact resolution
            </p>
          ) : null}
        </MetricCard>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <ChartCard
          title="First reply trend"
          info={info.initialTrend}
          subtitle="Median by week · created cohort"
        >
          {metrics.initialResponseTrend.length === 0 ? (
            <EmptyChart />
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={metrics.initialResponseTrend}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="weekLabel" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
                <Tooltip
                  formatter={(value: number) => [formatBusinessMinutes(value), "Median"]}
                />
                <Line
                  type="monotone"
                  dataKey="medianMinutes"
                  stroke="#17494d"
                  strokeWidth={2}
                  dot={{ r: 3 }}
                />
              </LineChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        <ChartCard
          title="Touches distribution"
          info={info.touches}
          subtitle="Resolved in period"
        >
          {metrics.touches.count === 0 ? (
            <EmptyChart />
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={touchChartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
                <Tooltip />
                <Bar dataKey="value" fill="#30aabc" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartCard>
      </div>
    </section>
  );
}

function MetricCard({
  title,
  subtitle,
  info,
  children,
}: {
  title: string;
  subtitle: string;
  info: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-zendesk-border bg-white p-4 shadow-sm">
      <header className="mb-3 flex items-start justify-between gap-2 border-b border-zendesk-border/60 pb-2">
        <div>
          <h3 className="text-sm font-semibold text-zendesk-navy">{title}</h3>
          <p className="text-xs text-zendesk-muted">{subtitle}</p>
        </div>
        <ChartInfoTooltip title={title}>{info}</ChartInfoTooltip>
      </header>
      {children}
    </section>
  );
}

function ChartCard({
  title,
  subtitle,
  info,
  children,
}: {
  title: string;
  subtitle: string;
  info: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-zendesk-border bg-white p-4 shadow-sm">
      <header className="mb-3 flex items-start justify-between gap-2 border-b border-zendesk-border/60 pb-2">
        <div>
          <h3 className="text-sm font-semibold text-zendesk-navy">{title}</h3>
          <p className="text-xs text-zendesk-muted">{subtitle}</p>
        </div>
        <ChartInfoTooltip title={title}>{info}</ChartInfoTooltip>
      </header>
      {children}
    </section>
  );
}

function EmptyChart() {
  return <p className="py-12 text-center text-sm text-zendesk-muted">No data in this period</p>;
}
