"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { DashboardPeriod } from "@/lib/dashboard-period";
import type { QualityAppealMetricsSnapshot } from "@/lib/dispute-appeal-stats";
import { qualityAppealInfoText, qualityReportSourceLinks } from "@/lib/dispute-appeal-stats-info";
import {
  formatQualityAppealCsv,
  formatQualityAppealReportHtml,
  formatQualityAppealReportPlain,
} from "@/lib/dashboard-report-export";
import { chartColor } from "@/lib/dashboard-stats";
import { DashboardReportMenu } from "./DashboardReportMenu";
import {
  QualityChartCard,
  QualityEmptyChart,
  QualityMetricCard,
  QualityReportFilterBar,
  QualityReportFilterSelect,
  QualitySectionHeader,
  QualitySourceLink,
} from "./QualityReportUi";

interface QualityAppealsSectionProps {
  period: DashboardPeriod;
  agentFilter?: string;
  onAgentFilterChange?: (value: string) => void;
  showSectionExport?: boolean;
}

export function QualityAppealsSection({
  period,
  agentFilter: agentFilterProp,
  onAgentFilterChange,
  showSectionExport = true,
}: QualityAppealsSectionProps) {
  const [internalAgentFilter, setInternalAgentFilter] = useState<string>("all");
  const agentFilterControlled = agentFilterProp !== undefined && onAgentFilterChange !== undefined;
  const agentFilter = agentFilterControlled ? agentFilterProp : internalAgentFilter;
  const setAgentFilter = agentFilterControlled ? onAgentFilterChange : setInternalAgentFilter;
  const [metrics, setMetrics] = useState<QualityAppealMetricsSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const info = qualityAppealInfoText();
  const sources = qualityReportSourceLinks();
  const exportRef = useRef<HTMLDivElement>(null);
  const csvFilename = useMemo(
    () => `quality-appeals-${period}.csv`.replace(/[^a-z0-9._-]+/gi, "-"),
    [period]
  );
  const pdfFilename = useMemo(
    () => `quality-appeals-${period}.pdf`.replace(/[^a-z0-9._-]+/gi, "-"),
    [period]
  );

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ period });
    if (agentFilter !== "all") params.set("agent", agentFilter);

    fetch(`/api/dashboard/quality-appeal-metrics?${params}`, { cache: "no-store" })
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to load quality appeals");
        if (!cancelled) setMetrics(data as QualityAppealMetricsSnapshot);
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
  }, [period, agentFilter]);

  useEffect(() => {
    if (!agentFilterControlled) {
      setInternalAgentFilter("all");
    }
  }, [period, agentFilterControlled]);

  useEffect(() => {
    if (agentFilter !== "all" && metrics && !metrics.agentOptions.includes(agentFilter)) {
      setAgentFilter("all");
    }
  }, [agentFilter, metrics?.agentOptions]);

  if (loading) {
    return (
      <section
        className="mt-6 rounded-lg border border-zendesk-border bg-white p-4 shadow-sm"
        data-export-loading="true"
      >
        <p className="text-sm text-zendesk-muted">Loading quality appeals…</p>
      </section>
    );
  }

  if (error || !metrics) {
    return (
      <section className="mt-6 rounded-lg border border-zendesk-border bg-white p-4 shadow-sm">
        <p className="text-sm text-red-700">{error ?? "Quality appeal metrics unavailable"}</p>
      </section>
    );
  }

  const saChartData = metrics.bySa.map((row) => ({
    name: row.name,
    Approved: row.approved,
    Denied: row.denied,
  }));

  return (
    <section className="mt-6 space-y-4">
      <QualitySectionHeader
        title="Quality appeals"
        actions={
          showSectionExport ? (
            <DashboardReportMenu
              csvFilename={csvFilename}
              pdfFilename={pdfFilename}
              pdfTargetRef={exportRef}
              buildCsv={() => formatQualityAppealCsv(metrics)}
              buildPlainReport={() => formatQualityAppealReportPlain(metrics)}
              buildHtmlReport={() => formatQualityAppealReportHtml(metrics)}
            />
          ) : undefined
        }
      >
        <p>
          {metrics.periodLabel}
          {metrics.agentFilter !== "all" ? ` · agent ${metrics.agentFilter}` : " · all agents"}
          {" · "}
          Source:{" "}
          <QualitySourceLink href={sources.qualityAppeals.url} label={sources.qualityAppeals.label} />
        </p>
      </QualitySectionHeader>

      <div ref={exportRef} className="space-y-4">
      <QualityReportFilterBar>
        <QualityReportFilterSelect
          label="Agent"
          value={agentFilter}
          options={metrics.agentOptions}
          onChange={setAgentFilter}
        />
      </QualityReportFilterBar>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <QualityMetricCard
          title="Closed in period"
          subtitle="Closing date in period"
          info={info.throughput}
        >
          <p className="text-center text-4xl font-bold text-zendesk-navy">
            {metrics.closedInPeriod}
          </p>
          <p className="mt-2 text-center text-xs text-zendesk-muted">
            {metrics.openedInPeriod} opened in period (timestamp column A)
          </p>
        </QualityMetricCard>

        <QualityMetricCard
          title="Approval rate"
          subtitle="Closed in period"
          info={info.approvalRate}
        >
          <p className="text-center text-4xl font-bold text-zendesk-navy">
            {metrics.approvalRatePct != null ? `${metrics.approvalRatePct}%` : "—"}
          </p>
          <p className="mt-2 text-center text-xs text-zendesk-muted">
            Median {metrics.medianDaysToClose ?? "—"} days to close
          </p>
        </QualityMetricCard>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <QualityChartCard title="By SA" subtitle="Closed in period" info={info.bySa}>
          {saChartData.length === 0 ? (
            <QualityEmptyChart />
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={saChartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
                <Tooltip />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="Denied" fill="#c7243a" stackId="sa" />
                <Bar dataKey="Approved" fill="#1f73b7" stackId="sa" />
              </BarChart>
            </ResponsiveContainer>
          )}
        </QualityChartCard>

        <QualityChartCard title="By status" subtitle="Closed in period" info={info.byStatus}>
          {metrics.byStatus.length === 0 ? (
            <QualityEmptyChart />
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={metrics.byStatus}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
                <Tooltip />
                <Bar dataKey="value" fill="#17494d" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </QualityChartCard>

        <QualityChartCard
          title="Volume trend"
          subtitle="Opened by month"
          info={info.trend}
          className="xl:col-span-2"
        >
          {metrics.monthlyTrend.length === 0 ? (
            <QualityEmptyChart />
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={metrics.monthlyTrend}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="monthLabel" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
                <Tooltip />
                <Line
                  type="monotone"
                  dataKey="count"
                  stroke={chartColor(1)}
                  strokeWidth={2}
                  dot={{ r: 3 }}
                />
              </LineChart>
            </ResponsiveContainer>
          )}
        </QualityChartCard>
      </div>
      </div>
    </section>
  );
}
