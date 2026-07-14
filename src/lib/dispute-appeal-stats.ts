import type { CountItem } from "./dashboard-stats";
import { shortMarketManagerLabel } from "./dashboard-stats";
import type { DashboardPeriod } from "./dashboard-period";
import {
  calendarMonthKeyFromPeriod,
  dashboardPeriodDays,
  dashboardPeriodLabel,
  parseCalendarMonthKey,
} from "./dashboard-period";
import type { SheetTabData } from "./sheet-tabs";
import { parseSheetTimestamp } from "./ticket-activity";
import { letterToIndex } from "./types";

export interface DisputeRecord {
  timestamp: Date | null;
  team: string;
  reservationCode: string;
  reason: string;
  email: string;
  lastUpdated: Date | null;
  marketCoordinator: string;
  escalateQa: boolean;
  decision: "removed" | "upheld" | "other";
  rationale: string;
  actionDate: Date | null;
  qaOverride: boolean;
}

export interface AppealRecord {
  timestamp: Date | null;
  agent: string;
  email: string;
  hostId: string;
  listingId: string;
  rating: number | null;
  status: "approved" | "denied" | "other";
  closingDate: Date | null;
  saName: string;
  relisted: string;
}

export interface SaOutcomeRow {
  name: string;
  approved: number;
  denied: number;
  total: number;
}

export interface MonthCountPoint {
  monthLabel: string;
  count: number;
}

export interface DisputeAppealMetricsSnapshot {
  period: DashboardPeriod;
  periodLabel: string;
  marketManager: string | "all";
  disputes: {
    openedInPeriod: number;
    withActionInPeriod: number;
    outcomeMix: { removed: number; upheld: number; other: number };
    qaEscalationPct: number | null;
    qaOverrideCount: number;
    qaOverridePct: number | null;
    medianDaysToAction: number | null;
    byTeam: CountItem[];
    byCoordinator: CountItem[];
    topReasons: CountItem[];
    monthlyTrend: MonthCountPoint[];
  };
  appeals: {
    openedInPeriod: number;
    closedInPeriod: number;
    approvalRatePct: number | null;
    denialRatePct: number | null;
    medianDaysToClose: number | null;
    bySa: SaOutcomeRow[];
    byStatus: CountItem[];
    monthlyTrend: MonthCountPoint[];
  };
}

function findColumnIndex(headers: string[], patterns: RegExp[]): number {
  for (let i = 0; i < headers.length; i += 1) {
    const h = headers[i] ?? "";
    if (patterns.some((p) => p.test(h))) return i;
  }
  return -1;
}

function resolveColumnIndex(
  headers: string[],
  patterns: RegExp[],
  fallbackLetter?: string
): number {
  const fromHeader = findColumnIndex(headers, patterns);
  if (fromHeader >= 0) return fromHeader;
  if (fallbackLetter) return letterToIndex(fallbackLetter);
  return -1;
}

function cell(row: string[], index: number): string {
  if (index < 0) return "";
  return String(row[index] ?? "").trim();
}

function parseDate(value: string): Date | null {
  if (!value.trim()) return null;
  return parseSheetTimestamp(value);
}

function normalizeDisputeDecision(value: string): "removed" | "upheld" | "other" {
  const v = value.toLowerCase();
  if (/removed|remove/.test(v)) return "removed";
  if (/upheld|uphold/.test(v)) return "upheld";
  return "other";
}

function detectQaOverride(rationale: string, decision: "removed" | "upheld" | "other"): boolean {
  if (!rationale.trim()) return false;
  const lower = rationale.toLowerCase();
  const ambassadorUpheld = /ambassador decided to uphold/.test(lower);
  const ambassadorRemoved = /ambassador decided to remove/.test(lower);
  const qaRemoved = /qa decision[\s\S]*should be removed/.test(lower);
  const qaUpheld = /qa decision[\s\S]*should be uphold/.test(lower);

  if (ambassadorUpheld && qaRemoved && decision === "removed") return true;
  if (ambassadorRemoved && qaUpheld && decision === "upheld") return true;
  return false;
}

function parseActionDate(value: string): Date | null {
  const parsed = parseDate(value);
  if (parsed) return parsed;
  if (/removed|action/i.test(value)) return new Date();
  return null;
}

export function parseDisputeTab(data: SheetTabData): DisputeRecord[] {
  return parseDisputeTabWithFallbacks(data);
}

/** Review escalation tracker — column A timestamp, column B team. */
export function parseReviewEscalationTab(data: SheetTabData): DisputeRecord[] {
  return parseDisputeTabWithFallbacks(data, {
    timestamp: "A",
    team: "B",
  });
}

function parseDisputeTabWithFallbacks(
  data: SheetTabData,
  fallbacks: Partial<Record<
    | "timestamp"
    | "team"
    | "reservationCode"
    | "reason"
    | "email"
    | "lastUpdated"
    | "marketCoordinator"
    | "escalateQa"
    | "decision"
    | "rationale"
    | "actionDate",
    string
  >> = {}
): DisputeRecord[] {
  const headers = data.headers;
  const idx = {
    timestamp: resolveColumnIndex(headers, [/^timestamp$/i, /date submitted/i, /submission time/i], fallbacks.timestamp),
    team: resolveColumnIndex(headers, [/^team$/i, /^region$/i, /regional team/i], fallbacks.team),
    reservationCode: resolveColumnIndex(headers, [/reservation code/i, /confirmation code/i], fallbacks.reservationCode),
    reason: resolveColumnIndex(headers, [/reason for escalation/i, /reason for review/i, /escalation reason/i], fallbacks.reason),
    email: resolveColumnIndex(headers, [/email address/i, /^email$/i, /submitter email/i], fallbacks.email),
    lastUpdated: resolveColumnIndex(headers, [/last updated/i, /last modified/i], fallbacks.lastUpdated),
    marketCoordinator: resolveColumnIndex(headers, [/market co/i, /market manager/i, /coordinator/i], fallbacks.marketCoordinator),
    escalateQa: resolveColumnIndex(headers, [/escalate qa/i, /qa escalation/i, /escalated to qa/i], fallbacks.escalateQa),
    decision: resolveColumnIndex(headers, [/decision overturned/i, /^decision$/i, /review decision/i, /outcome/i], fallbacks.decision),
    rationale: resolveColumnIndex(headers, [/^rationale$/i, /decision rationale/i, /notes/i], fallbacks.rationale),
    actionDate: resolveColumnIndex(headers, [/date action taken/i, /action date/i, /date review was removed/i], fallbacks.actionDate),
  };

  return data.rows.map((row) => {
    const decisionRaw = cell(row, idx.decision);
    const decision = normalizeDisputeDecision(decisionRaw);
    const rationale = cell(row, idx.rationale);
    const escalateRaw = cell(row, idx.escalateQa).toLowerCase();
    return {
      timestamp: parseDate(cell(row, idx.timestamp)),
      team: cell(row, idx.team) || "Unassigned",
      reservationCode: cell(row, idx.reservationCode),
      reason: cell(row, idx.reason),
      email: cell(row, idx.email),
      lastUpdated: parseDate(cell(row, idx.lastUpdated)),
      marketCoordinator: cell(row, idx.marketCoordinator) || "Unassigned",
      escalateQa: escalateRaw === "yes" || escalateRaw === "y" || escalateRaw === "true",
      decision,
      rationale,
      actionDate:
        parseActionDate(cell(row, idx.actionDate)) ??
        parseDate(cell(row, idx.lastUpdated)),
      qaOverride: detectQaOverride(rationale, decision),
    };
  });
}

function normalizeAppealStatus(value: string): "approved" | "denied" | "other" {
  const v = value.trim().toLowerCase();
  if (/approved/.test(v)) return "approved";
  if (/denied/.test(v)) return "denied";
  return "other";
}

export function parseAppealTab(data: SheetTabData): AppealRecord[] {
  return parseAppealTabWithFallbacks(data);
}

/** Quality appeals tracker — column A timestamp, column B agent. */
export function parseQualityAppealTab(data: SheetTabData): AppealRecord[] {
  return parseAppealTabWithFallbacks(data, {
    timestamp: "A",
    agent: "B",
  });
}

function parseAppealTabWithFallbacks(
  data: SheetTabData,
  fallbacks: Partial<Record<
    | "timestamp"
    | "agent"
    | "email"
    | "hostId"
    | "listingId"
    | "rating"
    | "status"
    | "closingDate"
    | "saName"
    | "relisted",
    string
  >> = {}
): AppealRecord[] {
  const headers = data.headers;
  const idx = {
    timestamp: resolveColumnIndex(headers, [/^timestamp$/i, /date submitted/i, /submission time/i], fallbacks.timestamp),
    agent: resolveColumnIndex(
      headers,
      [/^agent$/i, /agent name/i, /owner/i, /submitter/i, /mm$/i],
      fallbacks.agent
    ),
    email: resolveColumnIndex(headers, [/email address/i, /^email$/i, /submitter email/i], fallbacks.email),
    hostId: resolveColumnIndex(headers, [/host id/i, /user id/i], fallbacks.hostId),
    listingId: resolveColumnIndex(headers, [/listing id/i], fallbacks.listingId),
    rating: resolveColumnIndex(headers, [/lifetime average/i, /listing rating/i, /average rating/i, /rating/i], fallbacks.rating),
    status: resolveColumnIndex(headers, [/^status$/i, /appeal status/i, /final status/i, /decision/i], fallbacks.status),
    closingDate: resolveColumnIndex(headers, [/closing date/i, /date closed/i, /closed date/i], fallbacks.closingDate),
    saName: resolveColumnIndex(headers, [/sa name/i, /^sa$/i, /specialist/i], fallbacks.saName),
    relisted: resolveColumnIndex(headers, [/relisted listing/i, /relisted/i], fallbacks.relisted),
  };

  return data.rows.map((row) => {
    const ratingRaw = cell(row, idx.rating);
    const rating = ratingRaw ? Number.parseFloat(ratingRaw) : null;
    return {
      timestamp: parseDate(cell(row, idx.timestamp)),
      agent: cell(row, idx.agent) || "Unassigned",
      email: cell(row, idx.email),
      hostId: cell(row, idx.hostId),
      listingId: cell(row, idx.listingId),
      rating: rating != null && !Number.isNaN(rating) ? rating : null,
      status: normalizeAppealStatus(cell(row, idx.status)),
      closingDate: parseDate(cell(row, idx.closingDate)),
      saName: cell(row, idx.saName) || "Unassigned",
      relisted: cell(row, idx.relisted),
    };
  });
}

function dateMatchesPeriod(date: Date | null, period: DashboardPeriod): boolean {
  if (!date) return false;
  const monthKey = calendarMonthKeyFromPeriod(period);
  if (monthKey) {
    const parsed = parseCalendarMonthKey(monthKey);
    if (!parsed) return false;
    return date.getFullYear() === parsed.year && date.getMonth() === parsed.month;
  }
  const days = dashboardPeriodDays(period);
  if (days === null) return true;
  const cutoff = new Date();
  cutoff.setHours(0, 0, 0, 0);
  cutoff.setDate(cutoff.getDate() - days);
  return date >= cutoff;
}

function matchesCoordinator(coordinator: string, filter: string): boolean {
  if (filter === "all") return true;
  const normalized = shortMarketManagerLabel(coordinator);
  return (
    normalized === filter ||
    coordinator.toLowerCase().includes(filter.toLowerCase()) ||
    filter.toLowerCase().includes(normalized.toLowerCase())
  );
}

function matchesLabel(value: string, filter: string): boolean {
  if (filter === "all") return true;
  const trimmed = value.trim();
  return (
    trimmed === filter ||
    trimmed.toLowerCase() === filter.toLowerCase()
  );
}

function listDistinctLabelsInPeriod<T>(
  items: T[],
  period: DashboardPeriod,
  pickDate: (item: T) => Date | null,
  pickLabel: (item: T) => string
): string[] {
  const labels = new Set<string>();
  for (const item of items) {
    if (!dateMatchesPeriod(pickDate(item), period)) continue;
    const label = pickLabel(item).trim();
    if (label) labels.add(label);
  }
  return [...labels].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
}

export function listReviewEscalationTeamsInPeriod(
  disputes: DisputeRecord[],
  period: DashboardPeriod,
  marketManager: string | "all" = "all"
): string[] {
  const scoped = disputes.filter((d) => matchesCoordinator(d.marketCoordinator, marketManager));
  return listDistinctLabelsInPeriod(scoped, period, (d) => d.timestamp, (d) => d.team);
}

export function listQualityAppealAgentsInPeriod(
  appeals: AppealRecord[],
  period: DashboardPeriod
): string[] {
  return listDistinctLabelsInPeriod(appeals, period, (a) => a.timestamp, (a) => a.agent);
}

function countBy<T>(items: T[], pick: (item: T) => string): CountItem[] {
  const map = new Map<string, number>();
  for (const item of items) {
    const key = pick(item).trim() || "Unassigned";
    map.set(key, (map.get(key) ?? 0) + 1);
  }
  return [...map.entries()]
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value || a.name.localeCompare(b.name));
}

function topReasonBuckets(reasons: string[], limit = 8): CountItem[] {
  const buckets = new Map<string, number>();
  for (const reason of reasons) {
    const text = reason.toLowerCase();
    let key = "Other";
    if (/retaliat/.test(text)) key = "Retaliatory review";
    else if (/extortion|karen/.test(text)) key = "Extortion / threats";
    else if (/off-?platform|whatsapp/.test(text)) key = "Off-platform";
    else if (/never arrived|did not check|guest never|irrelevant/.test(text))
      key = "Guest did not stay";
    else if (/cancel/.test(text)) key = "Cancellation dispute";
    else if (reason.trim()) key = reason.trim().slice(0, 48);
    buckets.set(key, (buckets.get(key) ?? 0) + 1);
  }
  return [...buckets.entries()]
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, limit);
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) return Math.round((sorted[mid - 1] + sorted[mid]) / 2);
  return sorted[mid];
}

function monthTrend<T>(items: T[], pickDate: (item: T) => Date | null): MonthCountPoint[] {
  const map = new Map<string, number>();
  for (const item of items) {
    const d = pickDate(item);
    if (!d) continue;
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    map.set(key, (map.get(key) ?? 0) + 1);
  }
  return [...map.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, count]) => {
      const [year, month] = key.split("-").map(Number);
      const label = new Date(year, month - 1, 1).toLocaleString(undefined, {
        month: "short",
        year: "numeric",
      });
      return { monthLabel: label, count };
    });
}

function daysBetween(start: Date, end: Date): number {
  const ms = end.getTime() - start.getTime();
  if (ms < 0) return 0;
  return Math.round(ms / (1000 * 60 * 60 * 24));
}

export function buildDisputeAppealMetrics(params: {
  disputes: DisputeRecord[];
  appeals: AppealRecord[];
  period: DashboardPeriod;
  marketManager?: string | "all";
  teamFilter?: string | "all";
  agentFilter?: string | "all";
}): DisputeAppealMetricsSnapshot {
  const period = params.period;
  const marketManager = params.marketManager ?? "all";
  const teamFilter = params.teamFilter ?? "all";
  const agentFilter = params.agentFilter ?? "all";

  const disputesScoped = params.disputes
    .filter((d) => matchesCoordinator(d.marketCoordinator, marketManager))
    .filter((d) => matchesLabel(d.team, teamFilter));
  const appealsScoped = params.appeals.filter((a) => matchesLabel(a.agent, agentFilter));
  const disputesOpened = disputesScoped.filter((d) =>
    dateMatchesPeriod(d.timestamp, period)
  );
  const disputesWithAction = disputesScoped.filter(
    (d) => d.actionDate && dateMatchesPeriod(d.actionDate, period)
  );

  const outcomeMix = { removed: 0, upheld: 0, other: 0 };
  for (const d of disputesWithAction) {
    outcomeMix[d.decision] += 1;
  }

  const qaEscalated = disputesOpened.filter((d) => d.escalateQa);
  const qaOverrides = disputesOpened.filter((d) => d.qaOverride);
  const daysToAction = disputesWithAction
    .filter((d) => d.timestamp && d.actionDate)
    .map((d) => daysBetween(d.timestamp!, d.actionDate!));

  const appealsOpened = appealsScoped.filter((a) => dateMatchesPeriod(a.timestamp, period));
  const appealsClosed = appealsScoped.filter((a) =>
    dateMatchesPeriod(a.closingDate, period)
  );
  const closedWithStatus = appealsClosed.filter(
    (a) => a.status === "approved" || a.status === "denied"
  );
  const approved = closedWithStatus.filter((a) => a.status === "approved").length;
  const denied = closedWithStatus.filter((a) => a.status === "denied").length;
  const daysToClose = appealsClosed
    .filter((a) => a.timestamp && a.closingDate)
    .map((a) => daysBetween(a.timestamp!, a.closingDate!));

  const saMap = new Map<string, { approved: number; denied: number }>();
  for (const a of closedWithStatus) {
    if (!saMap.has(a.saName)) saMap.set(a.saName, { approved: 0, denied: 0 });
    const bucket = saMap.get(a.saName)!;
    if (a.status === "approved") bucket.approved += 1;
    else bucket.denied += 1;
  }

  return {
    period,
    periodLabel: dashboardPeriodLabel(period),
    marketManager,
    disputes: {
      openedInPeriod: disputesOpened.length,
      withActionInPeriod: disputesWithAction.length,
      outcomeMix,
      qaEscalationPct:
        disputesOpened.length > 0
          ? Math.round((qaEscalated.length / disputesOpened.length) * 1000) / 10
          : null,
      qaOverrideCount: qaOverrides.length,
      qaOverridePct:
        qaEscalated.length > 0
          ? Math.round((qaOverrides.length / qaEscalated.length) * 1000) / 10
          : null,
      medianDaysToAction: median(daysToAction),
      byTeam: countBy(disputesOpened, (d) => d.team).slice(0, 10),
      byCoordinator: countBy(disputesOpened, (d) => shortMarketManagerLabel(d.marketCoordinator)).slice(
        0,
        10
      ),
      topReasons: topReasonBuckets(disputesOpened.map((d) => d.reason)),
      monthlyTrend: monthTrend(disputesOpened, (d) => d.timestamp),
    },
    appeals: {
      openedInPeriod: appealsOpened.length,
      closedInPeriod: appealsClosed.length,
      approvalRatePct:
        closedWithStatus.length > 0
          ? Math.round((approved / closedWithStatus.length) * 1000) / 10
          : null,
      denialRatePct:
        closedWithStatus.length > 0
          ? Math.round((denied / closedWithStatus.length) * 1000) / 10
          : null,
      medianDaysToClose: median(daysToClose),
      bySa: [...saMap.entries()]
        .map(([name, counts]) => ({
          name,
          approved: counts.approved,
          denied: counts.denied,
          total: counts.approved + counts.denied,
        }))
        .sort((a, b) => b.total - a.total),
      byStatus: countBy(closedWithStatus, (a) =>
        a.status === "approved" ? "Approved" : a.status === "denied" ? "Denied" : "Other"
      ),
      monthlyTrend: monthTrend(appealsOpened, (a) => a.timestamp),
    },
  };
}

export type ReviewEscalationMetricsSnapshot = DisputeAppealMetricsSnapshot["disputes"] & {
  period: DashboardPeriod;
  periodLabel: string;
  marketManager: string | "all";
  teamFilter: string | "all";
  teamOptions: string[];
};

export type QualityAppealMetricsSnapshot = DisputeAppealMetricsSnapshot["appeals"] & {
  period: DashboardPeriod;
  periodLabel: string;
  agentFilter: string | "all";
  agentOptions: string[];
};

export function buildReviewEscalationMetrics(params: {
  disputes: DisputeRecord[];
  period: DashboardPeriod;
  marketManager?: string | "all";
  teamFilter?: string | "all";
}): ReviewEscalationMetricsSnapshot {
  const marketManager = params.marketManager ?? "all";
  const teamFilter = params.teamFilter ?? "all";
  const teamOptions = listReviewEscalationTeamsInPeriod(
    params.disputes,
    params.period,
    marketManager
  );
  const combined = buildDisputeAppealMetrics({
    disputes: params.disputes,
    appeals: [],
    period: params.period,
    marketManager,
    teamFilter,
  });
  return {
    period: combined.period,
    periodLabel: combined.periodLabel,
    marketManager: combined.marketManager,
    teamFilter,
    teamOptions,
    ...combined.disputes,
  };
}

export function buildQualityAppealMetrics(params: {
  appeals: AppealRecord[];
  period: DashboardPeriod;
  agentFilter?: string | "all";
}): QualityAppealMetricsSnapshot {
  const agentFilter = params.agentFilter ?? "all";
  const agentOptions = listQualityAppealAgentsInPeriod(params.appeals, params.period);
  const combined = buildDisputeAppealMetrics({
    disputes: [],
    appeals: params.appeals,
    period: params.period,
    marketManager: "all",
    agentFilter,
  });
  return {
    period: combined.period,
    periodLabel: combined.periodLabel,
    agentFilter,
    agentOptions,
    ...combined.appeals,
  };
}
