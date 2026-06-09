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
  buildDashboardStats,
  chartColor,
  DASHBOARD_WEEK_COUNT,
  percentLabel,
  type CountItem,
  type StackedGroup,
  type WeekSeriesPoint,
} from "@/lib/dashboard-stats";
import type { DashboardFilter } from "@/lib/dashboard-filter";

interface DashboardViewProps {
  tickets: Ticket[];
  loading?: boolean;
  onFilter?: (filter: DashboardFilter) => void;
}

export function DashboardView({ tickets, loading, onFilter }: DashboardViewProps) {
  const stats = useMemo(() => buildDashboardStats(tickets), [tickets]);

  if (loading) {
    return (
      <main className="flex flex-1 items-center justify-center text-sm text-zendesk-muted">
        Loading dashboard…
      </main>
    );
  }

  return (
    <main className="min-w-0 flex-1 overflow-y-auto bg-gray-50 p-4">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold text-zendesk-navy">Dashboard</h1>
          <p className="text-sm text-zendesk-muted">
            Weekly charts use a rolling {DASHBOARD_WEEK_COUNT}-week window. Click any chart segment
            to filter the ticket list.
          </p>
        </div>
        <p className="text-xs text-zendesk-muted">
          {stats.totalTickets.toLocaleString()} tickets · synced from intake sheet
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-4">
        <ChartCard title="Contact Reason" subtitle="All time · click to filter">
          <PieChartBlock
            data={stats.contactReasonAllTime.slice(0, 10)}
            onSliceClick={(name) => onFilter?.({ contactReason: name })}
          />
        </ChartCard>

        <ChartCard title="Contacts by MM" subtitle="All time · click to filter">
          <PieChartBlock
            data={stats.marketManagerAllTime.slice(0, 10)}
            onSliceClick={(name) => onFilter?.({ marketManager: name })}
          />
        </ChartCard>

        <ChartCard
          title="Contact Reason by Week"
          subtitle={`${stats.windowWeeks} weeks · click a week`}
          className="xl:col-span-1"
        >
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

        <ChartCard title="Contact Reason by MM" subtitle="Top MMs · click an MM">
          <PercentStackedMM
            data={stats.contactReasonByMM}
            onMMClick={(mm) => onFilter?.({ marketManager: mm })}
          />
        </ChartCard>

        <ChartCard title="Cases by Week" subtitle={`${stats.windowWeeks} weeks · click a point`}>
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

        <ChartCard title="Status by Week" subtitle={`${stats.windowWeeks} weeks · click a bar`}>
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

        <ChartCard title="Top Five Regional Hosts by Support Volume" subtitle="Click a host">
          <HorizontalBarChart
            data={stats.topRegionalHosts}
            onBarClick={(name) => onFilter?.({ requesterName: name })}
          />
        </ChartCard>

        <ChartCard
          title="Total Tickets"
          subtitle="All time"
          className="flex cursor-pointer flex-col justify-center"
          onClick={() => onFilter?.({})}
        >
          <p className="text-center text-5xl font-bold tracking-tight text-zendesk-navy">
            {stats.totalTickets.toLocaleString()}
          </p>
        </ChartCard>

        <ChartCard title="Overturn Rate" subtitle="by agent · all time">
          {stats.overturnByAgent.length > 0 ? (
            <GroupedYesNoChart data={stats.overturnByAgent} />
          ) : (
            <EmptyAppealHint detected={stats.appealFieldsDetected} label="overturn" />
          )}
        </ChartCard>

        <ChartCard title="Appeal Approval Rate CS vs Policy" subtitle="All time" className="xl:col-span-2">
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
    return <p className="py-8 text-center text-sm text-zendesk-muted">No data</p>;
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
    return <p className="py-8 text-center text-sm text-zendesk-muted">No tickets in window</p>;
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
    return <p className="py-8 text-center text-sm text-zendesk-muted">No data</p>;
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
    return <p className="py-8 text-center text-sm text-zendesk-muted">No data</p>;
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
        ? `No ${label} breakdown yet — check column headers match SA / overturn / CS fields.`
        : `No ${label} columns detected. Map appeal-related columns in Setup or add headers like SA, Overturn, Appeal Decision.`}
    </p>
  );
}
