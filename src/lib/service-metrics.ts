import {
  businessClockAnchor,
  businessHoursFromSheetConfig,
  diffBusinessMinutes,
  formatBusinessHoursLabel,
  type BusinessHoursConfig,
  type TimeInterval,
} from "./business-hours";
import { withWorkspaceHolidays } from "./business-holidays";
import { loadPauseIntervalsMap } from "./business-time-pauses";
import type { DashboardPeriod } from "./dashboard-period";
import { dashboardPeriodLabel, dateMatchesDashboardPeriod } from "./dashboard-period";
import { getOverlayDb } from "./overlay-db";
import { getServiceMetricsEpoch } from "./service-metrics-epoch";
import { shortMarketManagerLabel } from "./dashboard-stats";
import { parseSheetTimestamp } from "./ticket-activity";
import { normalizeStatusId } from "./status-mapper";
import type { SheetConfig, Ticket } from "./types";

export interface ServiceMetricSummary {
  count: number;
  medianMinutes: number | null;
  p90Minutes: number | null;
  withinTargetPct: number | null;
  targetBusinessHours: number | null;
}

export interface ThroughputSummary {
  createdInPeriod: number;
  resolvedInPeriod: number;
  backlogDelta: number;
}

export interface WeeklyMetricPoint {
  weekLabel: string;
  medianMinutes: number | null;
  count: number;
}

export interface TouchDistribution {
  one: number;
  twoToThree: number;
  fourPlus: number;
}

export interface ServiceMetricsSnapshot {
  period: DashboardPeriod;
  periodLabel: string;
  marketManager: string | "all";
  metricsEpochIso: string;
  businessHoursLabel: string;
  coverageNote: string;
  throughput: ThroughputSummary;
  initialResponse: ServiceMetricSummary;
  handleTime: ServiceMetricSummary;
  touches: {
    average: number | null;
    median: number | null;
    distribution: TouchDistribution;
    count: number;
  };
  firstContactResolutionPct: number | null;
  initialResponseTrend: WeeklyMetricPoint[];
}

interface TicketThreadStats {
  firstOutboundAt: string | null;
  firstInboundAt: string | null;
  outboundCount: number;
}

interface OverlayRow {
  status: string;
  resolved_at: string | null;
}

function loadThreadStatsMap(): Map<string, TicketThreadStats> {
  const db = getOverlayDb();
  const firstOutbound = db
    .prepare(
      `SELECT ticket_row_id, MIN(sent_at) AS sent_at
       FROM thread_messages WHERE direction = 'outbound'
       GROUP BY ticket_row_id`
    )
    .all() as Array<{ ticket_row_id: string; sent_at: string }>;
  const firstInbound = db
    .prepare(
      `SELECT ticket_row_id, MIN(sent_at) AS sent_at
       FROM thread_messages WHERE direction = 'inbound'
       GROUP BY ticket_row_id`
    )
    .all() as Array<{ ticket_row_id: string; sent_at: string }>;
  const outboundMessages = db
    .prepare(
      `SELECT ticket_row_id, sent_at FROM thread_messages WHERE direction = 'outbound'`
    )
    .all() as Array<{ ticket_row_id: string; sent_at: string }>;

  const outboundByTicket = new Map<string, string[]>();
  for (const row of outboundMessages) {
    const list = outboundByTicket.get(row.ticket_row_id) ?? [];
    list.push(row.sent_at);
    outboundByTicket.set(row.ticket_row_id, list);
  }

  const map = new Map<string, TicketThreadStats>();
  for (const row of firstOutbound) {
    map.set(row.ticket_row_id, {
      firstOutboundAt: row.sent_at,
      firstInboundAt: null,
      outboundCount: outboundByTicket.get(row.ticket_row_id)?.length ?? 0,
    });
  }
  for (const row of firstInbound) {
    const existing = map.get(row.ticket_row_id) ?? {
      firstOutboundAt: null,
      firstInboundAt: null,
      outboundCount: outboundByTicket.get(row.ticket_row_id)?.length ?? 0,
    };
    existing.firstInboundAt = row.sent_at;
    map.set(row.ticket_row_id, existing);
  }
  return map;
}

export function countOutboundBeforeResolve(
  ticketRowId: string,
  resolvedAtIso: string,
  outboundSentAts: string[] | undefined
): number {
  if (!outboundSentAts?.length) return 0;
  const resolvedMs = new Date(resolvedAtIso).getTime();
  return outboundSentAts.filter((sentAt) => {
    const ms = new Date(sentAt).getTime();
    return !Number.isNaN(ms) && ms <= resolvedMs;
  }).length;
}

function loadOutboundSentAtsMap(): Map<string, string[]> {
  const rows = getOverlayDb()
    .prepare(`SELECT ticket_row_id, sent_at FROM thread_messages WHERE direction = 'outbound'`)
    .all() as Array<{ ticket_row_id: string; sent_at: string }>;
  const map = new Map<string, string[]>();
  for (const row of rows) {
    const list = map.get(row.ticket_row_id) ?? [];
    list.push(row.sent_at);
    map.set(row.ticket_row_id, list);
  }
  return map;
}

function loadOverlayStatusMap(): Map<string, OverlayRow> {
  const rows = getOverlayDb()
    .prepare(`SELECT row_id, status, resolved_at FROM ticket_overlay`)
    .all() as Array<{ row_id: string; status: string; resolved_at: string | null }>;
  return new Map(rows.map((r) => [r.row_id, { status: r.status, resolved_at: r.resolved_at }]));
}

function resolveIntakeInstant(ticket: Ticket, thread: TicketThreadStats | undefined): Date | null {
  const sheet = parseSheetTimestamp(ticket.timestamp);
  const inbound = thread?.firstInboundAt ? new Date(thread.firstInboundAt) : null;
  const candidates: Date[] = [];
  if (sheet) candidates.push(sheet);
  if (inbound && !Number.isNaN(inbound.getTime())) candidates.push(inbound);
  if (!candidates.length) return null;
  return new Date(Math.min(...candidates.map((d) => d.getTime())));
}

function resolveResolvedAt(rowId: string, overlay: OverlayRow | undefined): Date | null {
  const status = normalizeStatusId(overlay?.status ?? "");
  if (status === "do_not_action") return null;
  if (status !== "resolved" && status !== "solved") return null;
  const stored = overlay?.resolved_at;
  if (!stored) return null;
  const d = new Date(stored);
  return Number.isNaN(d.getTime()) ? null : d;
}

function ticketMatchesCreatedPeriod(ticket: Ticket, period: DashboardPeriod): boolean {
  const intake = parseSheetTimestamp(ticket.timestamp);
  if (!intake) return false;
  return dateMatchesDashboardPeriod(intake, period);
}

function matchesResolvedPeriod(resolvedAt: Date, period: DashboardPeriod): boolean {
  return dateMatchesDashboardPeriod(resolvedAt, period);
}

function filterMarketManager(ticket: Ticket, marketManager: string | "all"): boolean {
  if (marketManager === "all") return true;
  return shortMarketManagerLabel(ticket.marketManager) === marketManager;
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) return Math.round((sorted[mid - 1] + sorted[mid]) / 2);
  return sorted[mid];
}

function percentile(values: number[], pct: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.ceil((pct / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)];
}

function summarizeMinutes(
  values: number[],
  targetBusinessHours: number | null
): ServiceMetricSummary {
  const targetMinutes =
    targetBusinessHours != null ? Math.round(targetBusinessHours * 60) : null;
  const withinTargetPct =
    targetMinutes != null && values.length
      ? Math.round(
          (values.filter((v) => v <= targetMinutes).length / values.length) * 1000
        ) / 10
      : null;
  return {
    count: values.length,
    medianMinutes: median(values),
    p90Minutes: percentile(values, 90),
    withinTargetPct,
    targetBusinessHours,
  };
}

function getWeekStartSunday(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - d.getDay());
  return d;
}

function formatWeekLabel(date: Date): string {
  return `${date.getMonth() + 1}/${date.getDate()}/${date.getFullYear()}`;
}

export function buildServiceMetrics(params: {
  tickets: Ticket[];
  period: DashboardPeriod;
  marketManager?: string | "all";
  sheetConfig?: SheetConfig | null;
  initialResponseTargetHours?: number;
}): ServiceMetricsSnapshot {
  const period = params.period;
  const marketManager = params.marketManager ?? "all";
  const businessHours = withWorkspaceHolidays(
    businessHoursFromSheetConfig(params.sheetConfig)
  );
  const epoch = getServiceMetricsEpoch();
  const threadStats = loadThreadStatsMap();
  const outboundSentAts = loadOutboundSentAtsMap();
  const overlayMap = loadOverlayStatusMap();
  const pauseMap = loadPauseIntervalsMap();
  const targetHours = params.initialResponseTargetHours ?? null;

  const eligible = params.tickets.filter((ticket) => {
    const intake = resolveIntakeInstant(ticket, threadStats.get(ticket.rowId));
    if (!intake || intake < epoch) return false;
    return filterMarketManager(ticket, marketManager);
  });

  const createdInPeriod = eligible.filter((t) => ticketMatchesCreatedPeriod(t, period));
  const resolvedInPeriod: Array<{
    ticket: Ticket;
    resolvedAt: Date;
    thread: TicketThreadStats | undefined;
    pauses: TimeInterval[];
  }> = [];

  for (const ticket of eligible) {
    const overlay = overlayMap.get(ticket.rowId);
    const pauses = pauseMap.get(ticket.rowId) ?? [];
    const resolvedAt = resolveResolvedAt(ticket.rowId, overlay);
    if (!resolvedAt) continue;
    if (!matchesResolvedPeriod(resolvedAt, period)) continue;
    resolvedInPeriod.push({
      ticket,
      resolvedAt,
      thread: threadStats.get(ticket.rowId),
      pauses,
    });
  }

  const initialResponseMinutes: number[] = [];
  const initialByWeek = new Map<string, number[]>();

  for (const ticket of createdInPeriod) {
    const thread = threadStats.get(ticket.rowId);
    const intake = resolveIntakeInstant(ticket, thread);
    const firstOutbound = thread?.firstOutboundAt ? new Date(thread.firstOutboundAt) : null;
    if (!intake || !firstOutbound || Number.isNaN(firstOutbound.getTime())) continue;

    const pauses = pauseMap.get(ticket.rowId) ?? [];
    const anchor = businessClockAnchor(intake, businessHours);
    const minutes = diffBusinessMinutes(anchor, firstOutbound, businessHours, pauses);
    initialResponseMinutes.push(minutes);

    const weekKey = getWeekStartSunday(intake).toISOString();
    if (!initialByWeek.has(weekKey)) initialByWeek.set(weekKey, []);
    initialByWeek.get(weekKey)!.push(minutes);
  }

  const handleMinutes: number[] = [];
  const touchCounts: number[] = [];
  let fcrCount = 0;

  for (const item of resolvedInPeriod) {
    const thread = item.thread;
    const intake = resolveIntakeInstant(item.ticket, thread);
    const firstOutbound = thread?.firstOutboundAt ? new Date(thread.firstOutboundAt) : null;
    if (firstOutbound && !Number.isNaN(firstOutbound.getTime())) {
      const anchor = intake ? businessClockAnchor(intake, businessHours) : firstOutbound;
      const start = firstOutbound > anchor ? firstOutbound : anchor;
      handleMinutes.push(
        diffBusinessMinutes(start, item.resolvedAt, businessHours, item.pauses)
      );
    }

    const outboundBeforeResolve = countOutboundBeforeResolve(
      item.ticket.rowId,
      item.resolvedAt.toISOString(),
      outboundSentAts.get(item.ticket.rowId)
    );
    if (outboundBeforeResolve > 0) {
      touchCounts.push(outboundBeforeResolve);
      if (outboundBeforeResolve === 1) fcrCount += 1;
    }
  }

  const touchDistribution: TouchDistribution = { one: 0, twoToThree: 0, fourPlus: 0 };
  for (const count of touchCounts) {
    if (count <= 1) touchDistribution.one += 1;
    else if (count <= 3) touchDistribution.twoToThree += 1;
    else touchDistribution.fourPlus += 1;
  }

  const initialResponseTrend: WeeklyMetricPoint[] = [...initialByWeek.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([weekKey, values]) => ({
      weekLabel: formatWeekLabel(new Date(weekKey)),
      medianMinutes: median(values),
      count: values.length,
    }));

  const createdCount = createdInPeriod.length;
  const resolvedCount = resolvedInPeriod.length;
  const coverageParts: string[] = [];
  if (initialResponseMinutes.length < createdCount) {
    coverageParts.push(
      `${initialResponseMinutes.length} of ${createdCount} new intakes have a CRM reply`
    );
  }
  if (handleMinutes.length < resolvedCount) {
    coverageParts.push(
      `${handleMinutes.length} of ${resolvedCount} resolved tickets have handle-time data`
    );
  }

  return {
    period,
    periodLabel: dashboardPeriodLabel(period),
    marketManager,
    metricsEpochIso: epoch.toISOString(),
    businessHoursLabel: formatBusinessHoursLabel(businessHours),
    coverageNote: coverageParts.length
      ? coverageParts.join(" · ")
      : "All eligible tickets in this view have complete data.",
    throughput: {
      createdInPeriod: createdCount,
      resolvedInPeriod: resolvedCount,
      backlogDelta: createdCount - resolvedCount,
    },
    initialResponse: summarizeMinutes(initialResponseMinutes, targetHours),
    handleTime: summarizeMinutes(handleMinutes, null),
    touches: {
      average: touchCounts.length
        ? Math.round((touchCounts.reduce((s, v) => s + v, 0) / touchCounts.length) * 10) / 10
        : null,
      median: median(touchCounts),
      distribution: touchDistribution,
      count: touchCounts.length,
    },
    firstContactResolutionPct: touchCounts.length
      ? Math.round((fcrCount / touchCounts.length) * 1000) / 10
      : null,
    initialResponseTrend,
  };
}
