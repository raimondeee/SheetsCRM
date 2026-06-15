"use client";

import { useMemo } from "react";
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
} from "@/lib/dashboard-period";
import {
  buildDashboardStats,
  chartColor,
  percentLabel,
  type CountItem,
  type StackedGroup,
  type WeekSeriesPoint,
} from "@/lib/dashboard-stats";
import type { DashboardFilter } from "@/lib/dashboard-filter";

interface DashboardViewProps {
  tickets: Ticket[];
  loading?: boolean;
  period: DashboardPeriod;
  onPeriodChange: (period: DashboardPeriod) => void;
  onFilter?: (filter: DashboardFilter) => void;
}

export function DashboardView({
  tickets,
  loading,
  period,
  onPeriodChange,
  onFilter,
}: DashboardViewProps) {
  const stats = useMemo(() => buildDashboardStats(tickets, period), [tickets, period]);
  const periodNote = stats.periodLabel;

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
          <label className="flex items-center gap-2 text-xs text-zendesk-muted">
            <span className="font-medium">Period</span>
            <select
              value={period}
              onChange={(e) => onPeriodChange(e.target.value as DashboardPeriod)}
              className="rounded border border-zendesk-border bg-white px-2 py-1.5 text-sm text-gray-900"
            >
              {DASHBOARD_PERIOD_OPTIONS.map((opt) => (
                <option key={opt.id} value={opt.id}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>
          <p className="text-xs text-zendesk-muted">
            {stats.periodTicketCount.toLocaleString()} in period ·{" "}
            {stats.totalTickets.toLocaleString()} all time
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-4">
        <ChartCard title="Contact Reason" subtitle={`${periodNote} · click to filter`}>
          <PieChartBlock
            data={stats.contactReasonBreakdown.slice(0, 10)}
            onSliceClick={(name) => onFilter?.({ contactReason: name })}
          />
        </ChartCard>

        <ChartCard title="Contacts by MM" subtitle={`${periodNote} · click to filter`}>
          <PieChartBlock
            data={stats.marketManagerBreakdown.slice(0, 10)}
            onSliceClick={(name) => onFilter?.({ marketManager: name })}
          />
        </ChartCard>

        <ChartCard title="Contact Reason by Week" subtitle={`${periodNote} · click a week`}>
          <StackedWeekChart
            data={stats.contactReasonByWeek}
            keys={stats.contactReasonWeekKeys}
            otherKey="Other"
            onWeekClick={(weekLabel, reason) =>
              onFilter?.(
                reason && reason !== "Other"
                  ? { weekLabel, contactReason: reason }
                  : { weekLabel }
              )
            }
          />
        </ChartCard>

        <ChartCard title="Contact Reason by MM" subtitle={`${periodNote} · click an MM`}>
          <PercentStackedMM
            data={stats.contactReasonByMM}
            onMMClick={(mm) => onFilter?.({ marketManager: mm })}
          />
        </ChartCard>

        <ChartCard title="Cases by Week" subtitle={`${periodNote} · click a point`}>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart
              data={stats.casesByWeek}
              onClick={(state) => {
                const label = state?.activeLabel;
                if (label) onFilter?.({ weekLabel: String(label) });
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

        <ChartCard title="Cases by Month" subtitle={`${periodNote} · monthly volume`}>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={stats.casesByMonth}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis dataKey="monthLabel" tick={{ fontSize: 10 }} interval={0} angle={-20} textAnchor="end" height={50} />
              <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
              <Tooltip />
              <Bar dataKey="cases" fill="#30aabc" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Status by Week" subtitle={`${periodNote} · click a bar`}>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart
              data={stats.statusByWeek}
              onClick={(state) => {
                const payload = state?.activePayload?.[0]?.payload as WeekSeriesPoint | undefined;
                if (!payload?.weekLabel) return;
                const key = state.activePayload?.[0]?.dataKey;
                if (key === "Resolved" || key === "Pending") {
                  onFilter?.({ weekLabel: payload.weekLabel, statusBucket: key });
                } else {
                  onFilter?.({ weekLabel: payload.weekLabel });
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

        <ChartCard title="Top Host Contacts" subtitle={`${periodNote} · click a host`}>
          <HorizontalBarChart
            data={stats.topRegionalHosts}
            onBarClick={(name) => {
              const emailMatch = name.match(/\(([^)]+)\)$/);
              if (emailMatch) onFilter?.({ requesterEmail: emailMatch[1] });
              else onFilter?.({ requesterName: name });
            }}
          />
        </ChartCard>

        <ChartCard
          title="Tickets in period"
          subtitle={periodNote}
          className="flex cursor-pointer flex-col justify-center"
          onClick={() => onFilter?.({})}
        >
          <p className="text-center text-5xl font-bold tracking-tight text-zendesk-navy">
            {stats.periodTicketCount.toLocaleString()}
          </p>
          <p className="mt-2 text-center text-xs text-zendesk-muted">
            of {stats.totalTickets.toLocaleString()} all-time tickets
          </p>
        </ChartCard>

        <ChartCard
          title="Top hosts by Market Manager"
          subtitle={`${periodNote} · activity report`}
          className="xl:col-span-2"
        >
          <HostsByMMReport
            data={stats.topHostsByMarketManager}
            onHostClick={(mm, host) => {
              const emailMatch = host.match(/\(([^)]+)\)$/);
              onFilter?.({
                marketManager: mm,
                ...(emailMatch ? { requesterEmail: emailMatch[1] } : { requesterName: host }),
              });
            }}
          />
        </ChartCard>

        <ChartCard title="Overturn Rate" subtitle={`by agent · ${periodNote}`}>
          {stats.overturnByAgent.length > 0 ? (
            <GroupedYesNoChart data={stats.overturnByAgent} />
          ) : (
            <EmptyAppealHint detected={stats.appealFieldsDetected} label="overturn" />
          )}
        </ChartCard>

        <ChartCard title="Appeal Approval Rate CS vs Policy" subtitle={periodNote} className="xl:col-span-2">
          {stats.appealCsVsPolicy.length > 0 ? (
            <GroupedYesNoChart data={stats.appealCsVsPolicy} layout="pair" />
          ) : (
            <EmptyAppealHint detected={stats.appealFieldsDetected} label="CS / Policy" />
          )}
        </ChartCard>
      </div>
    </main>
  );
}

function HostsByMMReport({
  data,
  onHostClick,
}: {
  data: { marketManager: string; hosts: CountItem[]; total: number }[];
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
            {group.hosts.map((host) => (
              <li key={host.name}>
                <button
                  type="button"
                  onClick={() => onHostClick?.(group.marketManager, host.name)}
                  className="flex w-full items-center justify-between rounded px-2 py-1 text-left text-xs hover:bg-gray-100"
                >
                  <span className="line-clamp-1 pr-2">{host.name}</span>
                  <span className="shrink-0 font-semibold text-zendesk-navy">{host.value}</span>
                </button>
              </li>
            ))}
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
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  className?: string;
  onClick?: () => void;
}) {
  return (
    <section
      onClick={onClick}
      className={`rounded-lg border border-zendesk-border bg-white p-4 shadow-sm ${className}`}
    >
      <header className="mb-3 border-b border-zendesk-border/60 pb-2">
        <h2 className="text-sm font-semibold text-zendesk-navy">{title}</h2>
        {subtitle && <p className="text-xs text-zendesk-muted">{subtitle}</p>}
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

function GroupedYesNoChart({
  data,
  layout = "wide",
}: {
  data: StackedGroup[];
  layout?: "wide" | "pair";
}) {
  const chartData = data.map((g) => ({
    name: g.key,
    Yes: g.segments.find((s) => s.name === "Yes")?.value ?? 0,
    No: g.segments.find((s) => s.name === "No")?.value ?? 0,
  }));

  const height = layout === "pair" ? 220 : 260;

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={chartData} margin={{ bottom: layout === "wide" ? 60 : 20 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
        <XAxis
          dataKey="name"
          tick={{ fontSize: 9 }}
          interval={0}
          angle={layout === "wide" ? -35 : 0}
          textAnchor={layout === "wide" ? "end" : "middle"}
          height={layout === "wide" ? 70 : 30}
        />
        <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
        <Tooltip />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        <Bar dataKey="No" fill="#c7243a" />
        <Bar dataKey="Yes" fill="#1f73b7" />
      </BarChart>
    </ResponsiveContainer>
  );
}

function EmptyAppealHint({
  detected,
  label = "appeal",
}: {
  detected: boolean;
  label?: string;
}) {
  return (
    <p className="py-10 text-center text-sm text-zendesk-muted">
      {detected
        ? `No ${label} breakdown in this period — check column headers match SA / overturn / CS fields.`
        : `No ${label} columns detected. Map appeal-related columns in Setup or add headers like SA, Overturn, Appeal Decision.`}
    </p>
  );
}
