/**
 * Personal ops dashboard (charts from the local ticket list + dashboard APIs).
 * Team / quality sections live in sibling views; report export uses dashboard-report-* libs.
 */
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Copy, RefreshCw } from "lucide-react";
import type { Ticket } from "@/lib/types";
import {
  DASHBOARD_PERIOD_OPTIONS,
  type DashboardPeriod,
  type RollingDashboardPeriod,
} from "@/lib/dashboard-period";
import {
  buildDashboardStats,
  chartColor,
  DASHBOARD_CHART_INFO,
  formatHostContactReasonBreakdown,
  formatHostsByMarketManagerReport,
  formatHostsByMarketManagerReportHtml,
  listMarketManagersInPeriod,
  percentLabel,
  type CountItem,
  type HostContactItem,
  type StackedGroup,
  type WeekSeriesPoint,
} from "@/lib/dashboard-stats";
import type { DashboardFilter } from "@/lib/dashboard-filter";
import type {
  QualityAppealMetricsSnapshot,
  ReviewEscalationMetricsSnapshot,
} from "@/lib/dispute-appeal-stats";
import {
  formatAgentDashboardCsv,
  formatAgentDashboardReportHtml,
  formatAgentDashboardReportPlain,
} from "@/lib/dashboard-report-export";
import type { ServiceMetricsSnapshot } from "@/lib/service-metrics";
import { IntegrationsHealthPanel } from "./IntegrationsHealthPanel";
import { ServiceMetricsSection } from "./ServiceMetricsSection";
import { ReviewEscalationsSection } from "./ReviewEscalationsSection";
import { QualityAppealsSection } from "./QualityAppealsSection";
import { ChartInfoTooltip } from "./ChartInfoTooltip";
import { DashboardReportMenu } from "./DashboardReportMenu";

interface DashboardViewProps {
  tickets: Ticket[];
  loading?: boolean;
  period: DashboardPeriod;
  rollingPeriod: RollingDashboardPeriod;
  calendarMonth: string;
  onRollingPeriodChange: (period: RollingDashboardPeriod) => void;
  onCalendarMonthChange: (monthKey: string) => void;
  onFilter?: (filter: DashboardFilter) => void;
  userEmail?: string | null;
  canSendEmail?: boolean;
  /** Refresh intake tickets (parent list) before reloading dashboard APIs. */
  onRefreshTickets?: () => void | Promise<void>;
}

export function DashboardView({
  tickets,
  loading,
  period,
  rollingPeriod,
  calendarMonth,
  onRollingPeriodChange,
  onCalendarMonthChange,
  onFilter,
  userEmail,
  canSendEmail = false,
  onRefreshTickets,
}: DashboardViewProps) {
  const [marketManagerFilter, setMarketManagerFilter] = useState<string>("all");
  const [reviewTeamFilter, setReviewTeamFilter] = useState<string>("all");
  const [qualityAgentFilter, setQualityAgentFilter] = useState<string>("all");
  const [serviceMetrics, setServiceMetrics] = useState<ServiceMetricsSnapshot | null>(null);
  const [reviewMetrics, setReviewMetrics] = useState<ReviewEscalationMetricsSnapshot | null>(null);
  const [qualityMetrics, setQualityMetrics] = useState<QualityAppealMetricsSnapshot | null>(null);
  const [metricsRefreshKey, setMetricsRefreshKey] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const dashboardPrintRef = useRef<HTMLDivElement>(null);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "error">("idle");

  const stats = useMemo(
    () => buildDashboardStats(tickets, period, marketManagerFilter),
    [tickets, period, marketManagerFilter]
  );
  const periodNote = stats.periodLabel;
  const singleMarketManagerView = marketManagerFilter !== "all";
  const marketManagerOptions = useMemo(
    () => listMarketManagersInPeriod(tickets, period),
    [tickets, period]
  );

  useEffect(() => {
    if (
      marketManagerFilter !== "all" &&
      !marketManagerOptions.includes(marketManagerFilter)
    ) {
      setMarketManagerFilter("all");
    }
  }, [marketManagerFilter, marketManagerOptions]);

  useEffect(() => {
    setReviewTeamFilter("all");
    setQualityAgentFilter("all");
  }, [period, marketManagerFilter]);

  useEffect(() => {
    let cancelled = false;

    const serviceParams = new URLSearchParams({ period });
    if (marketManagerFilter !== "all") serviceParams.set("marketManager", marketManagerFilter);

    const reviewParams = new URLSearchParams({ period });
    if (marketManagerFilter !== "all") reviewParams.set("marketManager", marketManagerFilter);
    if (reviewTeamFilter !== "all") reviewParams.set("team", reviewTeamFilter);

    const qualityParams = new URLSearchParams({ period });
    if (qualityAgentFilter !== "all") qualityParams.set("agent", qualityAgentFilter);

    Promise.all([
      fetch(`/api/dashboard/service-metrics?${serviceParams}`, { cache: "no-store" }).then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to load service metrics");
        return data as ServiceMetricsSnapshot;
      }),
      fetch(`/api/dashboard/review-escalation-metrics?${reviewParams}`, { cache: "no-store" }).then(
        async (res) => {
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || "Failed to load review escalations");
          return data as ReviewEscalationMetricsSnapshot;
        }
      ),
      fetch(`/api/dashboard/quality-appeal-metrics?${qualityParams}`, { cache: "no-store" }).then(
        async (res) => {
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || "Failed to load quality appeals");
          return data as QualityAppealMetricsSnapshot;
        }
      ),
    ])
      .then(([service, review, quality]) => {
        if (!cancelled) {
          setServiceMetrics(service);
          setReviewMetrics(review);
          setQualityMetrics(quality);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setServiceMetrics(null);
          setReviewMetrics(null);
          setQualityMetrics(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [period, marketManagerFilter, reviewTeamFilter, qualityAgentFilter, metricsRefreshKey]);

  async function handleRefresh() {
    if (refreshing) return;
    setRefreshing(true);
    try {
      await onRefreshTickets?.();
      setMetricsRefreshKey((n) => n + 1);
    } finally {
      setRefreshing(false);
    }
  }

  const dashFilter = useCallback(
    (fields: Omit<DashboardFilter, "period"> = {}) => {
      const mm =
        fields.marketManager ??
        (marketManagerFilter !== "all" ? marketManagerFilter : undefined);
      return {
        ...fields,
        period,
        ...(mm ? { marketManager: mm } : {}),
      };
    },
    [period, marketManagerFilter]
  );

  const reportFilters = useMemo(
    () => ({
      periodLabel: periodNote,
      marketManager: marketManagerFilter,
    }),
    [periodNote, marketManagerFilter]
  );

  const exportSections = useMemo(
    () => ({
      service: serviceMetrics,
      review: reviewMetrics,
      quality: qualityMetrics,
    }),
    [serviceMetrics, reviewMetrics, qualityMetrics]
  );

  const csvFilename = useMemo(
    () => `agent-dashboard-${period}.csv`.replace(/[^a-z0-9._-]+/gi, "-"),
    [period]
  );

  async function copyHostsReport() {
    const reportParams = {
      periodLabel: periodNote,
      marketManagerFilter,
      groups: stats.topHostsByMarketManager,
    };
    const text = formatHostsByMarketManagerReport(reportParams);
    const html = formatHostsByMarketManagerReportHtml(reportParams);
    try {
      if (typeof ClipboardItem !== "undefined") {
        await navigator.clipboard.write([
          new ClipboardItem({
            "text/html": new Blob([html], { type: "text/html" }),
            "text/plain": new Blob([text], { type: "text/plain" }),
          }),
        ]);
      } else {
        await navigator.clipboard.writeText(text);
      }
      setCopyState("copied");
      window.setTimeout(() => setCopyState("idle"), 2000);
    } catch {
      setCopyState("error");
      window.setTimeout(() => setCopyState("idle"), 2500);
    }
  }

  if (loading) {
    return (
      <main className="flex flex-1 items-center justify-center text-sm text-zendesk-muted">
        Loading dashboard…
      </main>
    );
  }

  return (
    <main className="min-w-0 flex-1 overflow-y-auto bg-gray-50 p-4">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-zendesk-navy">Dashboard</h1>
          <p className="text-sm text-zendesk-muted">
            Charts use the selected time period. Click any segment to filter the ticket list.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void handleRefresh()}
            disabled={refreshing}
            className="inline-flex items-center gap-1.5 rounded border border-zendesk-border bg-white px-2.5 py-1.5 text-xs font-medium text-zendesk-navy hover:bg-gray-50 disabled:opacity-60"
            title="Reload tickets and dashboard metrics"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />
            {refreshing ? "Refreshing…" : "Refresh"}
          </button>
          <label className="flex items-center gap-2 text-xs text-zendesk-muted">
            <span className="font-medium">Period</span>
            <select
              value={rollingPeriod}
              onChange={(e) => onRollingPeriodChange(e.target.value as RollingDashboardPeriod)}
              className="rounded border border-zendesk-border bg-white px-2 py-1.5 text-sm text-gray-900"
            >
              {DASHBOARD_PERIOD_OPTIONS.map((opt) => (
                <option key={opt.id} value={opt.id}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2 text-xs text-zendesk-muted">
            <span className="font-medium">Month</span>
            <input
              type="month"
              value={calendarMonth}
              onChange={(e) => onCalendarMonthChange(e.target.value)}
              className="rounded border border-zendesk-border bg-white px-2 py-1.5 text-sm text-gray-900"
              title="Filter to a specific calendar month (overrides rolling period)"
            />
            {calendarMonth ? (
              <button
                type="button"
                onClick={() => onCalendarMonthChange("")}
                className="rounded border border-zendesk-border bg-white px-2 py-1 text-xs text-zendesk-muted hover:bg-gray-50"
              >
                Clear
              </button>
            ) : null}
          </label>
          <label className="flex items-center gap-2 text-xs text-zendesk-muted">
            <span className="font-medium">Market manager</span>
            <select
              value={marketManagerFilter}
              onChange={(e) => setMarketManagerFilter(e.target.value)}
              className="max-w-[12rem] rounded border border-zendesk-border bg-white px-2 py-1.5 text-sm text-gray-900"
            >
              <option value="all">All in period</option>
              {marketManagerOptions.map((mm) => (
                <option key={mm} value={mm}>
                  {mm}
                </option>
              ))}
            </select>
          </label>
          <DashboardReportMenu
            csvFilename={csvFilename}
            printTargetRef={dashboardPrintRef}
            buildCsv={() => formatAgentDashboardCsv(stats, reportFilters, exportSections)}
            buildPlainReport={() =>
              formatAgentDashboardReportPlain(stats, reportFilters, exportSections)
            }
            buildHtmlReport={() =>
              formatAgentDashboardReportHtml(stats, reportFilters, exportSections)
            }
            sendReportParams={{ dashboard: "main", period, marketManager: marketManagerFilter }}
            userEmail={userEmail}
            canSendEmail={canSendEmail}
          />
          <p className="text-xs text-zendesk-muted">
            {stats.periodTicketCount.toLocaleString()} in period
            {marketManagerFilter !== "all" ? ` · ${marketManagerFilter}` : ""} ·{" "}
            {stats.totalTickets.toLocaleString()} all time
          </p>
        </div>
      </div>

      <div ref={dashboardPrintRef} className="w-full min-w-0 space-y-4">
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-4">
        <ChartCard
          title="Contact Reason"
          subtitle={`${periodNote} · click to filter`}
          info={DASHBOARD_CHART_INFO.contactReason}
        >
          <PieChartBlock
            data={stats.contactReasonBreakdown.slice(0, 10)}
            onSliceClick={(name) => onFilter?.(dashFilter({ contactReason: name }))}
          />
        </ChartCard>

        <ChartCard
          title="Contacts by MM"
          subtitle={`${periodNote} · click to filter`}
          info={DASHBOARD_CHART_INFO.marketManager}
        >
          {singleMarketManagerView ? (
            <ChangeMmFilterPlaceholder />
          ) : (
            <PieChartBlock
              data={stats.marketManagerBreakdown.slice(0, 10)}
              onSliceClick={(name) => onFilter?.(dashFilter({ marketManager: name }))}
            />
          )}
        </ChartCard>

        <ChartCard
          title="Contact Reason by Week"
          subtitle={`${periodNote} · click a week`}
          info={DASHBOARD_CHART_INFO.contactReasonByWeek}
        >
          <StackedWeekChart
            data={stats.contactReasonByWeek}
            keys={stats.contactReasonWeekKeys}
            otherKey="Other"
            onWeekClick={(weekLabel, reason) =>
              onFilter?.(
                dashFilter(
                  reason && reason !== "Other"
                    ? { weekLabel, contactReason: reason }
                    : { weekLabel }
                )
              )
            }
          />
        </ChartCard>

        <ChartCard
          title="Contact Reason by MM"
          subtitle={`${periodNote} · click an MM`}
          info={DASHBOARD_CHART_INFO.contactReasonByMm}
        >
          {singleMarketManagerView ? (
            <ChangeMmFilterPlaceholder />
          ) : (
            <PercentStackedMM
              data={stats.contactReasonByMM}
              onMMClick={(mm) => onFilter?.(dashFilter({ marketManager: mm }))}
            />
          )}
        </ChartCard>

        <ChartCard
          title="Cases by Week"
          subtitle={`${periodNote} · click a point`}
          info={DASHBOARD_CHART_INFO.casesByWeek}
        >
          <ResponsiveContainer width="100%" height={220}>
            <LineChart
              data={stats.casesByWeek}
              onClick={(state) => {
                const label = state?.activeLabel;
                if (label) onFilter?.(dashFilter({ weekLabel: String(label) }));
              }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis dataKey="weekLabel" tick={{ fontSize: 10 }} interval={0} angle={-25} textAnchor="end" height={50} />
              <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
              <Tooltip />
              <Line type="monotone" dataKey="cases" stroke="#17494d" strokeWidth={2} dot={{ r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard
          title="Cases by Month"
          subtitle={`${periodNote} · click a month`}
          info={DASHBOARD_CHART_INFO.casesByMonth}
        >
          <ResponsiveContainer width="100%" height={220}>
            <BarChart
              data={stats.casesByMonth}
              onClick={(state) => {
                const payload = state?.activePayload?.[0]?.payload as
                  | { monthStart?: string }
                  | undefined;
                if (payload?.monthStart) {
                  onFilter?.(dashFilter({ monthStart: payload.monthStart }));
                }
              }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis dataKey="monthLabel" tick={{ fontSize: 10 }} interval={0} angle={-20} textAnchor="end" height={50} />
              <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
              <Tooltip />
              <Bar dataKey="cases" fill="#30aabc" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard
          title="Status by Week"
          subtitle={`${periodNote} · click a bar`}
          info={DASHBOARD_CHART_INFO.statusByWeek}
        >
          <ResponsiveContainer width="100%" height={220}>
            <BarChart
              data={stats.statusByWeek}
              onClick={(state) => {
                const payload = state?.activePayload?.[0]?.payload as WeekSeriesPoint | undefined;
                if (!payload?.weekLabel) return;
                const key = state.activePayload?.[0]?.dataKey;
                if (key === "Resolved" || key === "Pending") {
                  onFilter?.(dashFilter({ weekLabel: payload.weekLabel, statusBucket: key }));
                } else {
                  onFilter?.(dashFilter({ weekLabel: payload.weekLabel }));
                }
              }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis dataKey="weekLabel" tick={{ fontSize: 10 }} interval={0} angle={-25} textAnchor="end" height={50} />
              <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
              <Tooltip />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="Resolved" stackId="s" fill="#30aabc" />
              <Bar dataKey="Pending" stackId="s" fill="#17494d" />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard
          title="Top Host Contacts"
          subtitle={`${periodNote} · click a host`}
          info={DASHBOARD_CHART_INFO.topHosts}
        >
          <HorizontalBarChart
            data={stats.topRegionalHosts}
            onBarClick={(name) => {
              const emailMatch = name.match(/\(([^)]+)\)$/);
              if (emailMatch) onFilter?.(dashFilter({ requesterEmail: emailMatch[1] }));
              else onFilter?.(dashFilter({ requesterName: name }));
            }}
          />
        </ChartCard>

        <ChartCard
          title="Tickets in period"
          subtitle={periodNote}
          className="flex cursor-pointer flex-col justify-center"
          onClick={() => onFilter?.(dashFilter())}
          info={DASHBOARD_CHART_INFO.ticketsInPeriod}
        >
          <p className="text-center text-5xl font-bold tracking-tight text-zendesk-navy">
            {stats.periodTicketCount.toLocaleString()}
          </p>
          <p className="mt-2 text-center text-xs text-zendesk-muted">
            of {stats.totalTickets.toLocaleString()} all-time tickets
          </p>
        </ChartCard>

        <section className="rounded-lg border border-zendesk-border bg-white p-4 shadow-sm xl:col-span-2">
            <header className="mb-3 flex items-start justify-between gap-3 border-b border-zendesk-border/60 pb-2">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h2 className="text-sm font-semibold text-zendesk-navy">
                    Top hosts by Market Manager
                  </h2>
                  <ChartInfoTooltip title="Top hosts by Market Manager">
                    {DASHBOARD_CHART_INFO.topHostsByMm}
                  </ChartInfoTooltip>
                </div>
                <p className="text-xs text-zendesk-muted">
                  {periodNote}
                  {singleMarketManagerView
                    ? ` · ${marketManagerFilter}`
                    : " · all market managers in period"}
                </p>
              </div>
              <button
                type="button"
                onClick={() => void copyHostsReport()}
                className="inline-flex shrink-0 items-center gap-1.5 rounded border border-zendesk-border bg-white px-2.5 py-1.5 text-xs font-medium text-zendesk-navy hover:bg-gray-50"
                title="Copy report for email or Slack"
              >
                <Copy className="h-3.5 w-3.5" />
                {copyState === "copied"
                  ? "Copied"
                  : copyState === "error"
                    ? "Copy failed"
                    : "Copy"}
              </button>
            </header>
            <HostsByMMReport
              data={stats.topHostsByMarketManager}
              onHostClick={(mm, host) => {
                const emailMatch = host.match(/\(([^)]+)\)$/);
                onFilter?.(
                  dashFilter({
                    marketManager: mm,
                    ...(emailMatch ? { requesterEmail: emailMatch[1] } : { requesterName: host }),
                  })
                );
              }}
            />
          </section>
      </div>

      <div className="space-y-4">
        <ServiceMetricsSection period={period} marketManager={marketManagerFilter} />

        <ReviewEscalationsSection
          period={period}
          marketManager={marketManagerFilter}
          teamFilter={reviewTeamFilter}
          onTeamFilterChange={setReviewTeamFilter}
          showSectionExport={false}
        />

        <QualityAppealsSection
          period={period}
          agentFilter={qualityAgentFilter}
          onAgentFilterChange={setQualityAgentFilter}
          showSectionExport={false}
        />
      </div>
      </div>

      <div className="mt-4">
        <IntegrationsHealthPanel />
      </div>
    </main>
  );
}

function ChangeMmFilterPlaceholder() {
  return (
    <p className="py-8 text-center text-sm text-zendesk-muted">
      Change filter view to all in period
    </p>
  );
}

function HostsByMMReport({
  data,
  onHostClick,
}: {
  data: { marketManager: string; hosts: HostContactItem[]; total: number }[];
  onHostClick?: (mm: string, host: string) => void;
}) {
  const withData = data.filter((g) => g.total > 0);
  if (withData.length === 0) {
    return <p className="py-8 text-center text-sm text-zendesk-muted">No host contacts in this period</p>;
  }

  return (
    <div className="max-h-72 space-y-4 overflow-y-auto pr-1">
      {withData.map((group) => (
        <div key={group.marketManager}>
          <div className="flex items-baseline justify-between gap-2">
            <h3 className="text-sm font-semibold text-zendesk-navy">{group.marketManager}</h3>
            <span className="text-xs text-zendesk-muted">{group.total} contacts</span>
          </div>
          <ul className="mt-1.5 space-y-1">
            {group.hosts.map((host) => {
              const reasonSummary = formatHostContactReasonBreakdown(host.contactReasons);
              return (
                <li key={host.name}>
                  <button
                    type="button"
                    onClick={() => onHostClick?.(group.marketManager, host.name)}
                    className="flex w-full flex-col rounded px-2 py-1 text-left hover:bg-gray-100"
                  >
                    <span className="flex w-full items-center justify-between gap-2 text-xs">
                      <span className="line-clamp-1 pr-2 font-medium text-zendesk-navy">
                        {host.name}
                      </span>
                      <span className="shrink-0 font-semibold text-zendesk-navy">{host.value}</span>
                    </span>
                    {reasonSummary && (
                      <span className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-zendesk-muted">
                        {reasonSummary}
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}

function ChartCard({
  title,
  subtitle,
  children,
  className = "",
  onClick,
  info,
  exportExclude = false,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  className?: string;
  onClick?: () => void;
  info?: string;
  exportExclude?: boolean;
}) {
  return (
    <section
      onClick={onClick}
      data-export-exclude={exportExclude ? "true" : undefined}
      className={`rounded-lg border border-zendesk-border bg-white p-4 shadow-sm ${className}`}
    >
      <header className="mb-3 flex items-start justify-between gap-2 border-b border-zendesk-border/60 pb-2">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-zendesk-navy">{title}</h2>
          {subtitle && <p className="text-xs text-zendesk-muted">{subtitle}</p>}
        </div>
        {info ? <ChartInfoTooltip title={title}>{info}</ChartInfoTooltip> : null}
      </header>
      {children}
    </section>
  );
}

function PieChartBlock({
  data,
  onSliceClick,
}: {
  data: CountItem[];
  onSliceClick?: (name: string) => void;
}) {
  if (data.length === 0) {
    return <p className="py-8 text-center text-sm text-zendesk-muted">No data in this period</p>;
  }

  const total = data.reduce((sum, d) => sum + d.value, 0);
  const chartData = data.map((d) => ({
    ...d,
    pct: percentLabel(d.value, total),
  }));

  return (
    <ResponsiveContainer width="100%" height={240}>
      <PieChart>
        <Pie
          data={chartData}
          dataKey="value"
          nameKey="name"
          cx="50%"
          cy="50%"
          outerRadius={78}
          label={({ name, pct }) => `${name} (${pct})`}
          labelLine={false}
          className={onSliceClick ? "cursor-pointer" : undefined}
          onClick={(entry) => {
            if (entry?.name && onSliceClick) onSliceClick(String(entry.name));
          }}
        >
          {chartData.map((_, i) => (
            <Cell key={i} fill={chartColor(i)} />
          ))}
        </Pie>
        <Tooltip formatter={(value: number) => [value, "Count"]} />
      </PieChart>
    </ResponsiveContainer>
  );
}

function StackedWeekChart({
  data,
  keys,
  otherKey,
  onWeekClick,
}: {
  data: WeekSeriesPoint[];
  keys: string[];
  otherKey: string;
  onWeekClick?: (weekLabel: string, reason?: string) => void;
}) {
  const allKeys = [...keys, otherKey];
  if (data.length === 0) {
    return <p className="py-8 text-center text-sm text-zendesk-muted">No tickets in period</p>;
  }

  return (
    <ResponsiveContainer width="100%" height={240}>
      <BarChart
        data={data}
        onClick={(state) => {
          const payload = state?.activePayload?.[0]?.payload as WeekSeriesPoint | undefined;
          const reason = state?.activePayload?.[0]?.dataKey;
          if (payload?.weekLabel && onWeekClick) {
            onWeekClick(payload.weekLabel, reason ? String(reason) : undefined);
          }
        }}
      >
        <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
        <XAxis dataKey="weekLabel" tick={{ fontSize: 10 }} interval={0} angle={-25} textAnchor="end" height={50} />
        <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
        <Tooltip />
        <Legend wrapperStyle={{ fontSize: 10 }} />
        {allKeys.map((key, i) => (
          <Bar key={key} dataKey={key} stackId="w" fill={chartColor(i)} />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}

function PercentStackedMM({
  data,
  onMMClick,
}: {
  data: StackedGroup[];
  onMMClick?: (mm: string) => void;
}) {
  if (data.every((g) => g.total === 0)) {
    return <p className="py-8 text-center text-sm text-zendesk-muted">No data in period</p>;
  }

  const reasonKeys = [...new Set(data.flatMap((g) => g.segments.map((s) => s.name)))].slice(0, 12);
  const chartData = data.map((group) => {
    const row: Record<string, string | number> = { mm: group.key };
    for (const reason of reasonKeys) {
      const seg = group.segments.find((s) => s.name === reason);
      row[reason] = group.total > 0 ? ((seg?.value ?? 0) / group.total) * 100 : 0;
    }
    return row;
  });

  return (
    <ResponsiveContainer width="100%" height={260}>
      <BarChart
        data={chartData}
        stackOffset="expand"
        onClick={(state) => {
          const mm = state?.activeLabel;
          if (mm && onMMClick) onMMClick(String(mm));
        }}
      >
        <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
        <XAxis dataKey="mm" tick={{ fontSize: 9 }} interval={0} angle={-20} textAnchor="end" height={56} />
        <YAxis tickFormatter={(v) => `${Math.round(Number(v) * 100)}%`} tick={{ fontSize: 10 }} />
        <Tooltip formatter={(v: number) => `${(Number(v) * 100).toFixed(1)}%`} />
        <Legend wrapperStyle={{ fontSize: 9 }} />
        {reasonKeys.map((key, i) => (
          <Bar key={key} dataKey={key} stackId="mm" fill={chartColor(i)} />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}

function HorizontalBarChart({
  data,
  onBarClick,
}: {
  data: CountItem[];
  onBarClick?: (name: string) => void;
}) {
  if (data.length === 0) {
    return <p className="py-8 text-center text-sm text-zendesk-muted">No data in period</p>;
  }

  return (
    <ResponsiveContainer width="100%" height={240}>
      <BarChart
        data={data}
        layout="vertical"
        margin={{ left: 8, right: 16 }}
        onClick={(state) => {
          const name = state?.activeLabel;
          if (name && onBarClick) onBarClick(String(name));
        }}
      >
        <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
        <XAxis type="number" tick={{ fontSize: 10 }} allowDecimals={false} />
        <YAxis
          type="category"
          dataKey="name"
          width={120}
          tick={{ fontSize: 9 }}
          tickFormatter={(v: string) => (v.length > 22 ? `${v.slice(0, 20)}…` : v)}
        />
        <Tooltip />
        <Bar dataKey="value" fill="#17494d" radius={[0, 4, 4, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
