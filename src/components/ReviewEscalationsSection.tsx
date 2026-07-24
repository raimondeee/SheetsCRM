"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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
import type { ReviewEscalationMetricsSnapshot } from "@/lib/dispute-appeal-stats";
import { reviewEscalationInfoText, qualityReportSourceLinks } from "@/lib/dispute-appeal-stats-info";
import {
  formatReviewEscalationCsv,
  formatReviewEscalationReportHtml,
  formatReviewEscalationReportPlain,
} from "@/lib/dashboard-report-export";
import { chartColor } from "@/lib/dashboard-stats";
import {
  DashboardReportMenu,
  type DashboardImageSection,
} from "./DashboardReportMenu";
import {
  QualityChartCard,
  QualityEmptyChart,
  QualityMetricCard,
  QualityReportFilterBar,
  QualityReportFilterSelect,
  QualitySectionHeader,
  QualitySourceLink,
} from "./QualityReportUi";

interface ReviewEscalationsSectionProps {
  period: DashboardPeriod;
  marketManager?: string;
  teamFilter?: string;
  onTeamFilterChange?: (value: string) => void;
  showSectionExport?: boolean;
}

export function ReviewEscalationsSection({
  period,
  marketManager = "all",
  teamFilter: teamFilterProp,
  onTeamFilterChange,
  showSectionExport = true,
}: ReviewEscalationsSectionProps) {
  const [internalTeamFilter, setInternalTeamFilter] = useState<string>("all");
  const teamFilterControlled = teamFilterProp !== undefined && onTeamFilterChange !== undefined;
  const teamFilter = teamFilterControlled ? teamFilterProp : internalTeamFilter;
  const setTeamFilter = teamFilterControlled ? onTeamFilterChange : setInternalTeamFilter;
  const [metrics, setMetrics] = useState<ReviewEscalationMetricsSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const info = reviewEscalationInfoText();
  const sources = qualityReportSourceLinks();
  const reviewPrintRef = useRef<HTMLDivElement>(null);
  const overviewImageRef = useRef<HTMLDivElement>(null);
  const chartsImageRef = useRef<HTMLDivElement>(null);
  const csvFilename = useMemo(
    () => `review-escalations-${period}.csv`.replace(/[^a-z0-9._-]+/gi, "-"),
    [period]
  );

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ period });
    if (marketManager !== "all") params.set("marketManager", marketManager);
    if (teamFilter !== "all") params.set("team", teamFilter);

    fetch(`/api/dashboard/review-escalation-metrics?${params}`, { cache: "no-store" })
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to load review escalations");
        if (!cancelled) setMetrics(data as ReviewEscalationMetricsSnapshot);
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
  }, [period, marketManager, teamFilter]);

  useEffect(() => {
    if (!teamFilterControlled) {
      setInternalTeamFilter("all");
    }
  }, [period, marketManager, teamFilterControlled]);

  useEffect(() => {
    if (teamFilter !== "all" && metrics && !metrics.teamOptions.includes(teamFilter)) {
      setTeamFilter("all");
    }
  }, [teamFilter, metrics?.teamOptions]);

  if (loading) {
    return (
      <section
        className="mt-6 rounded-lg border border-zendesk-border bg-white p-4 shadow-sm"
        data-export-loading="true"
      >
        <p className="text-sm text-zendesk-muted">Loading review escalations…</p>
      </section>
    );
  }

  if (error || !metrics) {
    return (
      <section className="mt-6 rounded-lg border border-zendesk-border bg-white p-4 shadow-sm">
        <p className="text-sm text-red-700">{error ?? "Review escalation metrics unavailable"}</p>
      </section>
    );
  }

  const outcomeChartData = [
    { name: "Removed", value: metrics.outcomeMix.removed },
    { name: "Upheld", value: metrics.outcomeMix.upheld },
    { name: "Other", value: metrics.outcomeMix.other },
  ].filter((d) => d.value > 0);

  const singleTeamView = metrics.teamFilter !== "all";
  const imageSections: DashboardImageSection[] = [
    {
      filename: `01-review-escalations-overview-${period}.png`.replace(/[^a-z0-9._-]+/gi, "-"),
      label: "Review escalation overview",
      getElement: () => overviewImageRef.current,
    },
    {
      filename: `02-review-escalations-charts-${period}.png`.replace(/[^a-z0-9._-]+/gi, "-"),
      label: "Review escalation charts",
      getElement: () => chartsImageRef.current,
    },
  ];

  return (
    <section className="mt-6 space-y-4">
      <QualitySectionHeader
        title="Review escalations"
        actions={
          showSectionExport ? (
            <DashboardReportMenu
              csvFilename={csvFilename}
              printTargetRef={reviewPrintRef}
              imageSections={imageSections}
              buildCsv={() => formatReviewEscalationCsv(metrics)}
              buildPlainReport={() => formatReviewEscalationReportPlain(metrics)}
              buildHtmlReport={() => formatReviewEscalationReportHtml(metrics)}
            />
          ) : undefined
        }
      >
        <p>
          {metrics.periodLabel}
          {metrics.marketManager !== "all"
            ? ` · coordinator ${metrics.marketManager}`
            : " · all coordinators"}
          {metrics.teamFilter !== "all" ? ` · team ${metrics.teamFilter}` : " · all teams"}
          {" · "}
          Source:{" "}
          <QualitySourceLink
            href={sources.reviewEscalations.url}
            label={sources.reviewEscalations.label}
          />
        </p>
      </QualitySectionHeader>

      <div ref={reviewPrintRef} className="space-y-4">
      <div ref={overviewImageRef} className="space-y-4">
      <QualityReportFilterBar>
        <QualityReportFilterSelect
          label="Team"
          value={teamFilter}
          options={metrics.teamOptions}
          onChange={setTeamFilter}
        />
      </QualityReportFilterBar>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <QualityMetricCard
          title="Opened in period"
          subtitle="Timestamp in column A"
          info={info.throughput}
        >
          <p className="text-center text-4xl font-bold text-zendesk-navy">
            {metrics.openedInPeriod}
          </p>
          <p className="mt-2 text-center text-xs text-zendesk-muted">
            {metrics.withActionInPeriod} with action in period
          </p>
        </QualityMetricCard>

        <QualityMetricCard
          title="QA escalation rate"
          subtitle="Of escalations opened in period"
          info={info.qaEscalation}
        >
          <p className="text-center text-4xl font-bold text-zendesk-navy">
            {metrics.qaEscalationPct != null ? `${metrics.qaEscalationPct}%` : "—"}
          </p>
          <p className="mt-2 text-center text-xs text-zendesk-muted">
            {metrics.qaOverrideCount} QA overrides
            {metrics.qaOverridePct != null
              ? ` (${metrics.qaOverridePct}% of QA escalations)`
              : ""}
          </p>
        </QualityMetricCard>
      </div>
      </div>

      <div ref={chartsImageRef} className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <QualityChartCard title="Outcomes" subtitle="Action in period" info={info.outcomes}>
          {outcomeChartData.length === 0 ? (
            <QualityEmptyChart />
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={outcomeChartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
                <Tooltip />
                <Bar dataKey="value" fill="#17494d" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </QualityChartCard>

        <QualityChartCard title="By team" subtitle="Opened in period" info={info.byTeam}>
          {singleTeamView ? (
            <p className="py-12 text-center text-sm text-zendesk-muted">
              Set team filter to &ldquo;All in period&rdquo; to compare across teams.
            </p>
          ) : metrics.byTeam.length === 0 ? (
            <QualityEmptyChart />
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={metrics.byTeam} layout="vertical" margin={{ left: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis type="number" tick={{ fontSize: 10 }} allowDecimals={false} />
                <YAxis
                  type="category"
                  dataKey="name"
                  width={110}
                  tick={{ fontSize: 9 }}
                  tickFormatter={(v: string) => (v.length > 18 ? `${v.slice(0, 16)}…` : v)}
                />
                <Tooltip />
                <Bar dataKey="value" fill="#30aabc" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </QualityChartCard>

        <QualityChartCard title="Top reasons" subtitle="Opened in period" info={info.topReasons}>
          {metrics.topReasons.length === 0 ? (
            <QualityEmptyChart />
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={metrics.topReasons.slice(0, 8)} layout="vertical" margin={{ left: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis type="number" tick={{ fontSize: 10 }} allowDecimals={false} />
                <YAxis
                  type="category"
                  dataKey="name"
                  width={120}
                  tick={{ fontSize: 9 }}
                  tickFormatter={(v: string) => (v.length > 20 ? `${v.slice(0, 18)}…` : v)}
                />
                <Tooltip />
                <Bar dataKey="value" fill="#17494d" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </QualityChartCard>

        <QualityChartCard
          title="By coordinator"
          subtitle="Opened in period"
          info={info.byCoordinator}
        >
          {metrics.byCoordinator.length === 0 ? (
            <QualityEmptyChart />
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={metrics.byCoordinator} layout="vertical" margin={{ left: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis type="number" tick={{ fontSize: 10 }} allowDecimals={false} />
                <YAxis type="category" dataKey="name" width={80} tick={{ fontSize: 10 }} />
                <Tooltip />
                <Bar dataKey="value" fill="#30aabc" radius={[0, 4, 4, 0]} />
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
                  stroke={chartColor(0)}
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
