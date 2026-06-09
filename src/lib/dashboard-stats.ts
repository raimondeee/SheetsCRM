import type { Ticket } from "./types";
import { parseSheetTimestamp } from "./ticket-activity";

export const DASHBOARD_WEEK_COUNT = 8;

const CHART_COLORS = [
  "#17494d",
  "#30aabc",
  "#038153",
  "#68737d",
  "#bf5000",
  "#7a3e9d",
  "#c7243a",
  "#f79a3e",
  "#2b5797",
  "#87929d",
  "#1f73b7",
  "#b35e00",
  "#528700",
  "#933981",
  "#996600",
];

export interface CountItem {
  name: string;
  value: number;
}

export interface WeekSeriesPoint {
  weekLabel: string;
  weekStart: string;
  total: number;
  [key: string]: string | number;
}

export interface StackedGroup {
  key: string;
  segments: CountItem[];
  total: number;
}

export interface DashboardStats {
  totalTickets: number;
  windowWeeks: number;
  contactReasonAllTime: CountItem[];
  marketManagerAllTime: CountItem[];
  contactReasonByWeek: WeekSeriesPoint[];
  contactReasonWeekKeys: string[];
  contactReasonByMM: StackedGroup[];
  casesByWeek: WeekSeriesPoint[];
  statusByWeek: WeekSeriesPoint[];
  topRegionalHosts: CountItem[];
  appealsBySA: StackedGroup[];
  overturnByAgent: StackedGroup[];
  appealCsVsPolicy: StackedGroup[];
  appealFieldsDetected: boolean;
}

export function buildDashboardStats(tickets: Ticket[]): DashboardStats {
  const windowed = filterTicketsInWeekWindow(tickets, DASHBOARD_WEEK_COUNT);
  const contactReasonAllTime = countBy(tickets, (t) => normalizeLabel(t.contactReason, "Other"));
  const marketManagerAllTime = countBy(tickets, (t) => shortMarketManagerLabel(t.marketManager));
  const contactReasonWeekKeys = topKeys(
    countBy(windowed, (t) => normalizeLabel(t.contactReason, "Other")),
    9
  );
  const contactReasonByWeek = buildWeeklyStack(
    windowed,
    (t) => normalizeLabel(t.contactReason, "Other"),
    contactReasonWeekKeys,
    "Other"
  );
  const topMMs = topKeys(marketManagerAllTime, 6);
  const contactReasonByMM = buildGroupedStack(
    tickets.filter((t) => topMMs.includes(shortMarketManagerLabel(t.marketManager))),
    (t) => shortMarketManagerLabel(t.marketManager),
    (t) => normalizeLabel(t.contactReason, "Other"),
    topMMs
  );
  const casesByWeek = buildWeeklyTotals(windowed);
  const statusByWeek = buildStatusByWeek(windowed);
  const topRegionalHosts = countBy(tickets, (t) => normalizeLabel(t.requesterName, "Unknown")).slice(
    0,
    5
  );
  const appealsBySA = buildAppealStacks(tickets, "sa");
  const overturnByAgent = buildAppealStacks(tickets, "overturn");
  const appealCsVsPolicy = buildAppealStacks(tickets, "csPolicy");

  return {
    totalTickets: tickets.length,
    windowWeeks: DASHBOARD_WEEK_COUNT,
    contactReasonAllTime,
    marketManagerAllTime,
    contactReasonByWeek,
    contactReasonWeekKeys,
    contactReasonByMM,
    casesByWeek,
    statusByWeek,
    topRegionalHosts,
    appealsBySA: appealsBySA.groups,
    overturnByAgent: overturnByAgent.groups,
    appealCsVsPolicy: appealCsVsPolicy.groups,
    appealFieldsDetected:
      appealsBySA.detected || overturnByAgent.detected || appealCsVsPolicy.detected,
  };
}

function filterTicketsInWeekWindow(tickets: Ticket[], weeks: number): Ticket[] {
  const cutoff = new Date();
  cutoff.setHours(0, 0, 0, 0);
  cutoff.setDate(cutoff.getDate() - weeks * 7);
  return tickets.filter((t) => {
    const d = parseSheetTimestamp(t.timestamp);
    return d && d >= cutoff;
  });
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

function normalizeLabel(value: string, fallback: string): string {
  const trimmed = value.trim();
  return trimmed || fallback;
}

/** First name / short label for MM pies (matches Sheets-style labels). */
export function shortMarketManagerLabel(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "Unassigned";
  const nameOnly = trimmed.replace(/<[^>]+>/, "").replace(/@[^\s]+/, "").trim();
  const first = nameOnly.split(/\s+/)[0] ?? nameOnly;
  if (first.length > 18) return `${first.slice(0, 16)}…`;
  return first;
}

function countBy(tickets: Ticket[], pick: (t: Ticket) => string): CountItem[] {
  const map = new Map<string, number>();
  for (const ticket of tickets) {
    const key = pick(ticket);
    map.set(key, (map.get(key) ?? 0) + 1);
  }
  return [...map.entries()]
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value);
}

function topKeys(items: CountItem[], limit: number): string[] {
  return items.slice(0, limit).map((i) => i.name);
}

function buildWeeklyStack(
  tickets: Ticket[],
  pickSegment: (t: Ticket) => string,
  segmentKeys: string[],
  otherLabel: string
): WeekSeriesPoint[] {
  const weekMap = new Map<string, Map<string, number>>();

  for (const ticket of tickets) {
    const d = parseSheetTimestamp(ticket.timestamp);
    if (!d) continue;
    const weekStart = getWeekStartSunday(d);
    const weekKey = weekStart.toISOString();
    if (!weekMap.has(weekKey)) weekMap.set(weekKey, new Map());
    const segment = segmentKeys.includes(pickSegment(ticket))
      ? pickSegment(ticket)
      : otherLabel;
    const bucket = weekMap.get(weekKey)!;
    bucket.set(segment, (bucket.get(segment) ?? 0) + 1);
  }

  return [...weekMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([weekKey, segments]) => {
      const weekStart = new Date(weekKey);
      const point: WeekSeriesPoint = {
        weekLabel: formatWeekLabel(weekStart),
        weekStart: weekKey,
        total: 0,
      };
      for (const key of [...segmentKeys, otherLabel]) {
        const value = segments.get(key) ?? 0;
        if (value > 0) point[key] = value;
        point.total += value;
      }
      return point;
    });
}

function buildWeeklyTotals(tickets: Ticket[]): WeekSeriesPoint[] {
  const map = new Map<string, number>();
  for (const ticket of tickets) {
    const d = parseSheetTimestamp(ticket.timestamp);
    if (!d) continue;
    const weekStart = getWeekStartSunday(d);
    const weekKey = weekStart.toISOString();
    map.set(weekKey, (map.get(weekKey) ?? 0) + 1);
  }
  return [...map.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([weekKey, total]) => ({
      weekLabel: formatWeekLabel(new Date(weekKey)),
      weekStart: weekKey,
      total,
      cases: total,
    }));
}

function buildStatusByWeek(tickets: Ticket[]): WeekSeriesPoint[] {
  const weekMap = new Map<string, { resolved: number; pending: number }>();

  for (const ticket of tickets) {
    const d = parseSheetTimestamp(ticket.timestamp);
    if (!d) continue;
    const weekKey = getWeekStartSunday(d).toISOString();
    if (!weekMap.has(weekKey)) weekMap.set(weekKey, { resolved: 0, pending: 0 });
    const bucket = weekMap.get(weekKey)!;
    if (isResolvedSheetStatus(ticket.sheetStatus)) bucket.resolved += 1;
    else if (isPendingSheetStatus(ticket.sheetStatus)) bucket.pending += 1;
  }

  return [...weekMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([weekKey, counts]) => ({
      weekLabel: formatWeekLabel(new Date(weekKey)),
      weekStart: weekKey,
      total: counts.resolved + counts.pending,
      Resolved: counts.resolved,
      Pending: counts.pending,
    }));
}

function isResolvedSheetStatus(status: string): boolean {
  return /resolved|solved|closed|complete|done/i.test(status.trim());
}

function isPendingSheetStatus(status: string): boolean {
  return /pending|awaiting|waiting|open|in progress|new/i.test(status.trim());
}

function buildGroupedStack(
  tickets: Ticket[],
  pickGroup: (t: Ticket) => string,
  pickSegment: (t: Ticket) => string,
  groupOrder: string[]
): StackedGroup[] {
  const map = new Map<string, Map<string, number>>();

  for (const ticket of tickets) {
    const group = pickGroup(ticket);
    if (!groupOrder.includes(group)) continue;
    const segment = pickSegment(ticket);
    if (!map.has(group)) map.set(group, new Map());
    const bucket = map.get(group)!;
    bucket.set(segment, (bucket.get(segment) ?? 0) + 1);
  }

  return groupOrder.map((key) => {
    const segmentsMap = map.get(key) ?? new Map();
    const segments = [...segmentsMap.entries()]
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);
    const total = segments.reduce((sum, s) => sum + s.value, 0);
    return { key, segments, total };
  });
}

function getRawField(ticket: Ticket, headerPatterns: RegExp[]): string {
  for (const [header, value] of Object.entries(ticket.raw)) {
    if (!value?.trim()) continue;
    if (headerPatterns.some((p) => p.test(header))) return value.trim();
  }
  return "";
}

function parseYesNo(value: string): "yes" | "no" | null {
  const v = value.trim().toLowerCase();
  if (!v) return null;
  if (/^(yes|y|approved|approve|true|1)$/i.test(v) || /approved/i.test(v)) return "yes";
  if (/^(no|n|denied|deny|false|0)$/i.test(v) || /denied/i.test(v)) return "no";
  return null;
}

function buildAppealStacks(
  tickets: Ticket[],
  kind: "sa" | "overturn" | "csPolicy"
): { groups: StackedGroup[]; detected: boolean } {
  const map = new Map<string, { yes: number; no: number }>();
  let detected = false;

  for (const ticket of tickets) {
    let groupKey = "";
    let outcomeRaw = "";

    if (kind === "sa") {
      groupKey = getRawField(ticket, [/^sa$/i, /specialist/i, /appeals?\s*sa/i]);
      outcomeRaw = getRawField(ticket, [
        /appeal.*(decision|status|outcome)/i,
        /^approved$/i,
        /approval/i,
      ]);
      if (!outcomeRaw) {
        outcomeRaw = getRawField(ticket, [/approved/i, /denied/i]);
      }
    } else if (kind === "overturn") {
      groupKey = getRawField(ticket, [/agent/i, /handled by/i, /assigned to/i, /owner/i]);
      if (!groupKey) groupKey = normalizeLabel(ticket.requesterName, "");
      outcomeRaw = getRawField(ticket, [/overturn/i]);
    } else {
      groupKey = getRawField(ticket, [/cs.*policy/i, /appeal.*type/i, /team type/i, /category/i]);
      outcomeRaw = getRawField(ticket, [
        /appeal.*(decision|status|outcome)/i,
        /approval/i,
        /approved/i,
      ]);
    }

    if (!groupKey) continue;
    detected = true;

    let outcome = parseYesNo(outcomeRaw);
    if (!outcome && kind === "sa") {
      if (/approved/i.test(outcomeRaw)) outcome = "yes";
      else if (/denied/i.test(outcomeRaw)) outcome = "no";
    }
    if (!outcome) continue;

    if (!map.has(groupKey)) map.set(groupKey, { yes: 0, no: 0 });
    const bucket = map.get(groupKey)!;
    if (outcome === "yes") bucket.yes += 1;
    else bucket.no += 1;
  }

  const groups = [...map.entries()]
    .map(([key, counts]) => ({
      key,
      segments: [
        { name: kind === "sa" ? "Approved" : "Yes", value: counts.yes },
        { name: kind === "sa" ? "Denied" : "No", value: counts.no },
      ],
      total: counts.yes + counts.no,
    }))
    .filter((g) => g.total > 0)
    .sort((a, b) => b.total - a.total);

  if (kind === "overturn") {
    return { groups: groups.slice(0, 15), detected };
  }
  if (kind === "csPolicy") {
    const normalized = new Map<string, { yes: number; no: number }>();
    for (const g of groups) {
      const cat = /policy/i.test(g.key) ? "Policy" : /cs/i.test(g.key) ? "CS" : g.key;
      if (!normalized.has(cat)) normalized.set(cat, { yes: 0, no: 0 });
      const bucket = normalized.get(cat)!;
      bucket.yes += g.segments.find((s) => s.name === "Yes")?.value ?? 0;
      bucket.no += g.segments.find((s) => s.name === "No")?.value ?? 0;
    }
    return {
      groups: [...normalized.entries()].map(([key, counts]) => ({
        key,
        segments: [
          { name: "Yes", value: counts.yes },
          { name: "No", value: counts.no },
        ],
        total: counts.yes + counts.no,
      })),
      detected,
    };
  }

  return { groups, detected };
}

export function chartColor(index: number): string {
  return CHART_COLORS[index % CHART_COLORS.length];
}

export function percentLabel(value: number, total: number): string {
  if (total <= 0) return "0%";
  return `${((value / total) * 100).toFixed(1)}%`;
}
