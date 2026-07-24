"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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
import type { Ticket } from "@/lib/types";
import {
  DASHBOARD_PERIOD_OPTIONS,
  type DashboardPeriod,
  type RollingDashboardPeriod,
} from "@/lib/dashboard-period";
import {
  chartColor,
  percentLabel,
  type CountItem,
  type StackedGroup,
  type WeekSeriesPoint,
} from "@/lib/dashboard-stats";
import {
  buildTeamMetrics,
  listTeamOwnersInPeriod,
  listTeamRegions,
  ticketsToTeamRecords,
  type TeamIntakeRecord,
} from "@/lib/team-metrics";
import {
  formatTeamDashboardCsv,
  formatTeamDashboardReportHtml,
  formatTeamDashboardReportPlain,
} from "@/lib/dashboard-report-export";
import { TEAM_METRICS_CHART_INFO } from "@/lib/team-metrics-info";
import { ChartInfoTooltip } from "./ChartInfoTooltip";
import { ReviewEscalationsSection } from "./ReviewEscalationsSection";
import { QualityAppealsSection } from "./QualityAppealsSection";
import {
  DashboardReportMenu,
  type DashboardImageSection,
} from "./DashboardReportMenu";

interface TeamDashboardViewProps {
  tickets: Ticket[];
  loading?: boolean;
  period: DashboardPeriod;
  rollingPeriod: RollingDashboardPeriod;
  calendarMonth: string;
  onRollingPeriodChange: (period: RollingDashboardPeriod) => void;
  onCalendarMonthChange: (monthKey: string) => void;
  userEmail?: string | null;
  canSendEmail?: boolean;
  /** Shareable Team Dashboard shell only — opens source-sheet config. */
  onOpenSources?: () => void;
}

export function TeamDashboardView({
  tickets,
  loading,
  period,
  rollingPeriod,
  calendarMonth,
  onRollingPeriodChange,
  onCalendarMonthChange,
  userEmail,
  canSendEmail = false,
}: TeamDashboardViewProps) {
  const [colleagueRecords, setColleagueRecords] = useState<TeamIntakeRecord[]>([]);
  const [sourcesLoaded, setSourcesLoaded] = useState(0);
  const [sourcesTotal, setSourcesTotal] = useState(0);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [fetchingTabs, setFetchingTabs] = useState(true);
  const [regionFilter, setRegionFilter] = useState<string>("all");
  const [ownerFilter, setOwnerFilter] = useState<string>("all");
  const teamPrintRef = useRef<HTMLDivElement>(null);
  const regionalIntakeImageRef = useRef<HTMLElement>(null);
  const categoryOverviewImageRef = useRef<HTMLDivElement>(null);
  const ownerAndDayImageRef = useRef<HTMLDivElement>(null);
  const weeklyVolumeImageRef = useRef<HTMLDivElement>(null);
  const categoryByRegionImageRef = useRef<HTMLElement>(null);
  const monthAndStatusImageRef = useRef<HTMLDivElement>(null);

  const localRecords = useMemo(() => ticketsToTeamRecords(tickets), [tickets]);
  const allRecords = useMemo(
    () => [...localRecords, ...colleagueRecords],
    [localRecords, colleagueRecords]
  );

  useEffect(() => {
    let cancelled = false;
    setFetchingTabs(true);
    setFetchError(null);

    fetch("/api/dashboard/team-metrics", { cache: "no-store" })
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to load team sheet data");
        if (!cancelled) {
          setColleagueRecords((data.colleagueRecords ?? []) as TeamIntakeRecord[]);
          setSourcesLoaded(data.sourcesLoaded ?? 0);
          setSourcesTotal(data.sourcesTotal ?? 0);
          setFetchError(data.partialError ?? null);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setColleagueRecords([]);
          setFetchError(err instanceof Error ? err.message : "Failed to load team tabs");
        }
      })
      .finally(() => {
        if (!cancelled) setFetchingTabs(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const regionOptions = useMemo(() => listTeamRegions(allRecords), [allRecords]);
  const ownerOptions = useMemo(
    () => listTeamOwnersInPeriod(allRecords, period, regionFilter),
    [allRecords, period, regionFilter]
  );

  useEffect(() => {
    if (regionFilter !== "all" && !regionOptions.includes(regionFilter)) {
      setRegionFilter("all");
    }
  }, [regionFilter, regionOptions]);

  useEffect(() => {
    if (ownerFilter !== "all" && !ownerOptions.includes(ownerFilter)) {
      setOwnerFilter("all");
    }
  }, [ownerFilter, ownerOptions]);

  const stats = useMemo(
    () =>
      buildTeamMetrics({
        records: allRecords,
        period,
        regionFilter,
        ownerFilter,
        sourcesLoaded,
      }),
    [allRecords, period, regionFilter, ownerFilter, sourcesLoaded]
  );

  const singleRegionView = regionFilter !== "all";
  const singleOwnerView = ownerFilter !== "all";

  const reportFilters = useMemo(
    () => ({
      periodLabel: stats.periodLabel,
      region: regionFilter,
      owner: ownerFilter,
    }),
    [stats.periodLabel, regionFilter, ownerFilter]
  );

  const csvFilename = useMemo(
    () => `team-intake-${period}.csv`.replace(/[^a-z0-9._-]+/gi, "-"),
    [period]
  );
  const dashboardImageSections: DashboardImageSection[] = [
    {
      filename: `01-regional-intake-${period}.png`.replace(/[^a-z0-9._-]+/gi, "-"),
      label: "Regional intake and case status",
      getElement: () => regionalIntakeImageRef.current,
    },
    {
      filename: `02-region-and-contact-reasons-${period}.png`.replace(/[^a-z0-9._-]+/gi, "-"),
      label: "Volume by region and top contact reasons",
      getElement: () => categoryOverviewImageRef.current,
    },
    {
      filename: `03-owner-and-day-of-week-${period}.png`.replace(/[^a-z0-9._-]+/gi, "-"),
      label: "Owner and volume by day of week",
      getElement: () => ownerAndDayImageRef.current,
    },
    {
      filename: `04-category-and-cases-by-week-${period}.png`.replace(/[^a-z0-9._-]+/gi, "-"),
      label: "Category and cases by week",
      getElement: () => weeklyVolumeImageRef.current,
    },
    {
      filename: `05-category-by-region-${period}.png`.replace(/[^a-z0-9._-]+/gi, "-"),
      label: "Category by region",
      getElement: () => categoryByRegionImageRef.current,
    },
    {
      filename: `06-cases-by-month-and-status-${period}.png`.replace(/[^a-z0-9._-]+/gi, "-"),
      label: "Cases by month and status by week",
      getElement: () => monthAndStatusImageRef.current,
    },
  ];

  if (loading) {
    return (
      <main className="flex flex-1 items-center justify-center text-sm text-zendesk-muted">
        Loading team dashboard…
      </main>
    );
  }

  return (
    <main className="min-w-0 flex-1 overflow-y-auto bg-gray-50 p-4">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-zendesk-navy">Team dashboard (beta)</h1>
          <p className="text-sm text-zendesk-muted">
            Aggregate intake metrics from regional tabs plus your Form Responses data.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
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
            <span className="font-medium">Region</span>
            <select
              value={regionFilter}
              onChange={(e) => setRegionFilter(e.target.value)}
              className="max-w-[14rem] rounded border border-zendesk-border bg-white px-2 py-1.5 text-sm text-gray-900"
            >
              <option value="all">All regions</option>
              {regionOptions.map((region) => (
                <option key={region} value={region}>
                  {region}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2 text-xs text-zendesk-muted">
            <span className="font-medium">Owner / MM</span>
            <select
              value={ownerFilter}
              onChange={(e) => setOwnerFilter(e.target.value)}
              className="max-w-[12rem] rounded border border-zendesk-border bg-white px-2 py-1.5 text-sm text-gray-900"
            >
              <option value="all">All in period</option>
              {ownerOptions.map((owner) => (
                <option key={owner} value={owner}>
                  {owner}
                </option>
              ))}
            </select>
          </label>
          <p className="text-xs text-zendesk-muted">
            {stats.periodRecordCount.toLocaleString()} in period
            {regionFilter !== "all" ? ` · ${regionFilter}` : ""}
            {ownerFilter !== "all" ? ` · ${ownerFilter}` : ""} ·{" "}
            {stats.totalRecords.toLocaleString()} all time
          </p>
        </div>
      </div>

      {(fetchingTabs || fetchError) && (
        <div
          className={`mb-4 rounded-lg border px-3 py-2 text-xs ${
            fetchError
              ? "border-amber-200 bg-amber-50 text-amber-900"
              : "border-zendesk-border bg-white text-zendesk-muted"
          }`}
        >
          {fetchingTabs
            ? "Loading regional sheet tabs…"
            : `Regional tabs: ${sourcesLoaded}/${sourcesTotal} loaded. ${fetchError}`}
        </div>
      )}

      <div ref={teamPrintRef} className="mb-4 space-y-4">
      <section
        ref={regionalIntakeImageRef}
        className="rounded-lg border border-zendesk-border bg-white p-4 shadow-sm"
      >
        <div className="flex items-start justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold text-zendesk-navy">Regional intake</h2>
            <p className="text-xs text-zendesk-muted">
              {stats.periodLabel}
              {fetchingTabs ? "" : ` · ${sourcesLoaded} colleague tab${sourcesLoaded === 1 ? "" : "s"} + your intake`}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <ChartInfoTooltip title="Overview">{TEAM_METRICS_CHART_INFO.overview}</ChartInfoTooltip>
            <DashboardReportMenu
              csvFilename={csvFilename}
              printTargetRef={teamPrintRef}
              imageSections={dashboardImageSections}
              buildCsv={() => formatTeamDashboardCsv(stats, reportFilters)}
              buildPlainReport={() => formatTeamDashboardReportPlain(stats, reportFilters)}
              buildHtmlReport={() => formatTeamDashboardReportHtml(stats, reportFilters)}
              sendReportParams={{
                dashboard: "team",
                period,
                region: regionFilter,
                owner: ownerFilter,
              }}
              userEmail={userEmail}
              canSendEmail={canSendEmail}
            />
          </div>
        </div>
        <div className="mt-3 flex flex-col gap-3 lg:flex-row lg:items-stretch">
          <div className="flex min-h-[9.5rem] flex-col justify-center rounded-lg border-2 border-zendesk-navy/30 bg-zendesk-navy/5 px-4 py-4 lg:w-56 lg:shrink-0 xl:w-64">
            <p className="text-xs font-semibold uppercase tracking-wide text-zendesk-navy">
              {regionFilter === "all" ? "All regions" : "Total"}
            </p>
            <p className="mt-1 text-4xl font-bold tabular-nums text-zendesk-navy">
              {stats.periodRecordCount.toLocaleString()}
            </p>
            <p className="mt-1 text-xs text-zendesk-muted">
              {stats.totalRecords.toLocaleString()} all time
              {regionFilter === "all" && stats.regionSummaries.length > 0
                ? ` · ${stats.regionSummaries.length} regions`
                : ""}
            </p>
            <p className="mt-2 text-[11px] text-zendesk-muted">{stats.periodLabel}</p>
          </div>

          <div className="grid min-w-0 flex-1 grid-cols-2 gap-2 sm:grid-cols-4">
            {stats.regionSummaries.map((summary) => (
              <div
                key={summary.region}
                className="rounded-md border border-zendesk-border/70 bg-gray-50 px-3 py-2"
              >
                <p
                  className="truncate text-[11px] font-medium text-zendesk-muted"
                  title={summary.region}
                >
                  {summary.region}
                </p>
                <p className="text-2xl font-bold tabular-nums text-zendesk-navy">
                  {summary.periodCount}
                </p>
                <p className="text-[10px] text-zendesk-muted">{summary.allTimeCount} all time</p>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-4 border-t border-zendesk-border/70 pt-3">
          <div className="mb-2 flex items-baseline justify-between gap-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-zendesk-muted">
              Case status
            </h3>
            <p className="text-[10px] text-zendesk-muted">
              Sheet status values in {stats.periodLabel.toLowerCase()}
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-7">
            {stats.statusSummaries.map((summary) => (
              <div
                key={summary.status}
                className={`rounded-md border px-3 py-2 ${
                  summary.status === "Blank"
                    ? "border-dashed border-zendesk-border bg-white"
                    : "border-zendesk-border/70 bg-gray-50"
                }`}
              >
                <p className="truncate text-[11px] font-medium text-zendesk-muted" title={summary.status}>
                  {summary.status}
                </p>
                <p className="text-xl font-bold tabular-nums text-zendesk-navy">
                  {summary.periodCount.toLocaleString()}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <div className="space-y-4">
        <div ref={categoryOverviewImageRef} className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ChartCard
          title="Volume by region"
          subtitle={`${stats.periodLabel}`}
          info={TEAM_METRICS_CHART_INFO.regionVolume}
        >
          {singleRegionView ? (
            <SingleFilterPlaceholder label="region" />
          ) : (
            <PieChartBlock data={stats.regionBreakdown.slice(0, 10)} />
          )}
        </ChartCard>

        <ChartCard
          title="Top contact reasons"
          subtitle={`${stats.periodLabel}`}
          info={TEAM_METRICS_CHART_INFO.category}
        >
          <PieChartBlock data={stats.categoryBreakdown.slice(0, 12)} />
        </ChartCard>
        </div>

        <div ref={ownerAndDayImageRef} className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ChartCard
          title="Owner / MM"
          subtitle={`${stats.periodLabel}`}
          info={TEAM_METRICS_CHART_INFO.owner}
        >
          {singleOwnerView ? (
            <SingleFilterPlaceholder label="owner" />
          ) : (
            <PieChartBlock data={stats.ownerBreakdown.slice(0, 12)} />
          )}
        </ChartCard>

        <ChartCard
          title="Volume by day of week"
          subtitle={stats.periodLabel}
          info={TEAM_METRICS_CHART_INFO.casesByDayOfWeek}
        >
          <DayOfWeekChart data={stats.casesByDayOfWeek} />
        </ChartCard>
        </div>

        <div ref={weeklyVolumeImageRef} className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ChartCard
          title="Category by week"
          subtitle={stats.periodLabel}
          info={TEAM_METRICS_CHART_INFO.categoryByWeek}
        >
          <StackedWeekChart
            data={stats.categoryByWeek}
            keys={stats.categoryWeekKeys}
            otherKey="Other"
          />
        </ChartCard>

        <ChartCard
          title="Cases by week"
          subtitle={`${stats.periodLabel} · week starting Sunday`}
          info={TEAM_METRICS_CHART_INFO.casesByWeek}
        >
          <ResponsiveContainer width="100%" height={320}>
            <LineChart data={stats.casesByWeek} margin={{ top: 8, right: 12, left: 0, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis
                dataKey="weekLabel"
                tick={{ fontSize: 11 }}
                interval={weekTickInterval(stats.casesByWeek.length)}
                angle={stats.casesByWeek.length > 8 ? -30 : 0}
                textAnchor={stats.casesByWeek.length > 8 ? "end" : "middle"}
                height={stats.casesByWeek.length > 8 ? 56 : 32}
              />
              <YAxis
                tick={{ fontSize: 11 }}
                allowDecimals={false}
                label={{
                  value: "Submission count",
                  angle: -90,
                  position: "insideLeft",
                  style: { fontSize: 11, fill: "#68737d" },
                }}
              />
              <Tooltip />
              <Line type="monotone" dataKey="cases" name="Cases" stroke="#2563eb" strokeWidth={2} dot={{ r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
        </ChartCard>
        </div>

        <section ref={categoryByRegionImageRef}>
        <ChartCard
          title="Category by region"
          subtitle={stats.periodLabel}
          info={TEAM_METRICS_CHART_INFO.categoryByRegion}
        >
          {singleRegionView ? (
            <SingleFilterPlaceholder label="region" />
          ) : (
            <PercentStackedRegion data={stats.categoryByRegion} />
          )}
        </ChartCard>
        </section>

        <div ref={monthAndStatusImageRef} className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ChartCard
          title="Cases by month"
          subtitle={stats.periodLabel}
          info={TEAM_METRICS_CHART_INFO.casesByMonth}
        >
          <ResponsiveContainer width="100%" height={320}>
            <BarChart data={stats.casesByMonth} margin={{ top: 8, right: 12, left: 0, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis
                dataKey="monthLabel"
                tick={{ fontSize: 11 }}
                interval={weekTickInterval(stats.casesByMonth.length)}
                angle={stats.casesByMonth.length > 8 ? -30 : 0}
                textAnchor={stats.casesByMonth.length > 8 ? "end" : "middle"}
                height={stats.casesByMonth.length > 8 ? 56 : 32}
              />
              <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
              <Tooltip />
              <Bar dataKey="cases" name="Cases" fill="#30aabc" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard
          title="Status by week"
          subtitle={`${stats.periodLabel} · sheet status text`}
          info={TEAM_METRICS_CHART_INFO.statusByWeek}
        >
          <ResponsiveContainer width="100%" height={320}>
            <LineChart data={stats.statusByWeek} margin={{ top: 8, right: 12, left: 0, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis
                dataKey="weekLabel"
                tick={{ fontSize: 11 }}
                interval={weekTickInterval(stats.statusByWeek.length)}
                angle={stats.statusByWeek.length > 8 ? -30 : 0}
                textAnchor={stats.statusByWeek.length > 8 ? "end" : "middle"}
                height={stats.statusByWeek.length > 8 ? 56 : 32}
              />
              <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
              <Tooltip />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Line type="monotone" dataKey="Resolved" stroke="#038153" strokeWidth={2} dot={{ r: 2 }} />
              <Line type="monotone" dataKey="Pending" stroke="#bf5000" strokeWidth={2} dot={{ r: 2 }} />
            </LineChart>
          </ResponsiveContainer>
        </ChartCard>
        </div>
      </div>
      </div>

      <ReviewEscalationsSection period={period} />

      <QualityAppealsSection period={period} />
    </main>
  );
}

function weekTickInterval(pointCount: number): number | "preserveStartEnd" {
  if (pointCount <= 8) return 0;
  if (pointCount <= 16) return 1;
  return Math.max(1, Math.ceil(pointCount / 8) - 1);
}

function ChartCard({
  title,
  subtitle,
  children,
  className = "",
  info,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  className?: string;
  info?: string;
}) {
  return (
    <section className={`rounded-lg border border-zendesk-border bg-white p-4 shadow-sm ${className}`}>
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

function PieChartBlock({ data }: { data: CountItem[] }) {
  if (data.length === 0) {
    return <p className="py-8 text-center text-sm text-zendesk-muted">No data in this period</p>;
  }

  const total = data.reduce((sum, d) => sum + d.value, 0);
  const chartData = data.map((d) => ({
    ...d,
    pct: percentLabel(d.value, total),
  }));

  return (
    <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-start">
      <div className="min-h-[280px] min-w-0 flex-1">
        <ResponsiveContainer width="100%" height={280}>
          <PieChart>
            <Pie
              data={chartData}
              dataKey="value"
              nameKey="name"
              cx="50%"
              cy="50%"
              outerRadius={96}
              innerRadius={36}
              paddingAngle={1}
              labelLine={{ stroke: "#9ca3af", strokeWidth: 1 }}
              label={({ pct }) => pct}
            >
              {chartData.map((_, i) => (
                <Cell key={i} fill={chartColor(i)} />
              ))}
            </Pie>
            <Tooltip
              formatter={(value: number, _name, item) => {
                const pct = String(item?.payload?.pct ?? "");
                return [`${value.toLocaleString()}${pct ? ` (${pct})` : ""}`, "Count"];
              }}
            />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <ul className="grid w-full shrink-0 grid-flow-col grid-rows-8 content-start gap-x-5 gap-y-1.5 sm:w-auto">
        {chartData.map((item, index) => (
          <li key={item.name} className="flex min-w-36 items-start gap-2 text-xs">
            <span
              className="mt-1 h-2.5 w-2.5 shrink-0 rounded-sm"
              style={{ backgroundColor: chartColor(index) }}
              aria-hidden
            />
            <span className="min-w-0">
              <span className="block font-medium text-zendesk-navy" title={item.name}>
                {item.name}
              </span>
              <span className="text-zendesk-muted">
                {item.pct} · {item.value.toLocaleString()}
              </span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function DayOfWeekChart({ data }: { data: CountItem[] }) {
  if (data.every((d) => d.value === 0)) {
    return <p className="py-8 text-center text-sm text-zendesk-muted">No intakes in period</p>;
  }

  return (
    <ResponsiveContainer width="100%" height={320}>
      <BarChart
        data={data}
        layout="vertical"
        margin={{ top: 8, right: 16, left: 8, bottom: 8 }}
      >
        <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" horizontal={false} />
        <XAxis type="number" tick={{ fontSize: 11 }} allowDecimals={false} />
        <YAxis
          type="category"
          dataKey="name"
          width={78}
          tick={{ fontSize: 11 }}
          interval={0}
        />
        <Tooltip formatter={(value: number) => [value.toLocaleString(), "Cases"]} />
        <Bar dataKey="value" name="Cases" fill="#f07167" radius={[0, 4, 4, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

function StackedWeekChart({
  data,
  keys,
  otherKey,
}: {
  data: WeekSeriesPoint[];
  keys: string[];
  otherKey: string;
}) {
  const allKeys = [...keys, otherKey];
  if (data.length === 0) {
    return <p className="py-8 text-center text-sm text-zendesk-muted">No intakes in period</p>;
  }

  return (
    <ResponsiveContainer width="100%" height={320}>
      <BarChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 8 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
        <XAxis
          dataKey="weekLabel"
          tick={{ fontSize: 11 }}
          interval={weekTickInterval(data.length)}
          angle={data.length > 8 ? -30 : 0}
          textAnchor={data.length > 8 ? "end" : "middle"}
          height={data.length > 8 ? 56 : 32}
        />
        <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
        <Tooltip />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        {allKeys.map((key, i) => (
          <Bar key={key} dataKey={key} stackId="w" fill={chartColor(i)} />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}

function PercentStackedRegion({ data }: { data: StackedGroup[] }) {
  if (data.every((g) => g.total === 0)) {
    return <p className="py-8 text-center text-sm text-zendesk-muted">No data in period</p>;
  }

  const categoryKeys = [...new Set(data.flatMap((g) => g.segments.map((s) => s.name)))].slice(0, 12);
  const chartData = data.map((group) => {
    const row: Record<string, string | number> = { region: group.key };
    for (const category of categoryKeys) {
      const seg = group.segments.find((s) => s.name === category);
      row[category] = group.total > 0 ? ((seg?.value ?? 0) / group.total) * 100 : 0;
    }
    return row;
  });

  return (
    <ResponsiveContainer width="100%" height={340}>
      <BarChart data={chartData} stackOffset="expand" margin={{ top: 8, right: 12, left: 0, bottom: 8 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
        <XAxis
          dataKey="region"
          tick={{ fontSize: 11 }}
          interval={0}
          angle={-18}
          textAnchor="end"
          height={64}
        />
        <YAxis tickFormatter={(v) => `${Math.round(Number(v) * 100)}%`} tick={{ fontSize: 11 }} />
        <Tooltip formatter={(v: number) => `${(Number(v) * 100).toFixed(1)}%`} />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        {categoryKeys.map((key, i) => (
          <Bar key={key} dataKey={key} stackId="region" fill={chartColor(i)} />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}

function SingleFilterPlaceholder({ label }: { label: "region" | "owner" }) {
  return (
    <p className="py-8 text-center text-sm text-zendesk-muted">
      Set {label} filter to &ldquo;All&rdquo; to compare across teams.
    </p>
  );
}
