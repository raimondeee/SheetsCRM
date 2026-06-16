import type { DashboardPeriod } from "./dashboard-period";
import { dashboardPeriodLabel, ticketMatchesDashboardPeriod } from "./dashboard-period";
import { escapeHtml } from "./html-utils";
import type { Ticket } from "./types";
import { parseSheetTimestamp } from "./ticket-activity";

export const DASHBOARD_WEEK_COUNT = 8;
export const HOSTS_PER_MARKET_MANAGER = 5;

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

export interface MonthSeriesPoint {
  monthLabel: string;
  monthStart: string;
  total: number;
  cases: number;
}

export interface HostContactItem {
  name: string;
  value: number;
  contactReasons: CountItem[];
}

export interface HostsByMarketManagerGroup {
  marketManager: string;
  hosts: HostContactItem[];
  total: number;
}

export interface DashboardStats {
  period: DashboardPeriod;
  periodLabel: string;
  totalTickets: number;
  periodTicketCount: number;
  contactReasonBreakdown: CountItem[];
  marketManagerBreakdown: CountItem[];
  contactReasonByWeek: WeekSeriesPoint[];
  contactReasonWeekKeys: string[];
  contactReasonByMM: StackedGroup[];
  casesByWeek: WeekSeriesPoint[];
  casesByMonth: MonthSeriesPoint[];
  statusByWeek: WeekSeriesPoint[];
  topRegionalHosts: CountItem[];
  topHostsByMarketManager: HostsByMarketManagerGroup[];
  appealsBySA: StackedGroup[];
  overturnByAgent: StackedGroup[];
  appealCsVsPolicy: StackedGroup[];
  appealFieldsDetected: boolean;
}

export function filterTicketsByPeriod(
  tickets: Ticket[],
  period: DashboardPeriod
): Ticket[] {
  return tickets.filter((ticket) => ticketMatchesDashboardPeriod(ticket, period));
}

export function filterTicketsByMarketManager(
  tickets: Ticket[],
  marketManager: string | "all"
): Ticket[] {
  if (marketManager === "all") return tickets;
  return tickets.filter(
    (ticket) => shortMarketManagerLabel(ticket.marketManager) === marketManager
  );
}

export function buildDashboardStats(
  tickets: Ticket[],
  period: DashboardPeriod = "3m",
  marketManager: string | "all" = "all"
): DashboardStats {
  const inPeriod = filterTicketsByMarketManager(
    filterTicketsByPeriod(tickets, period),
    marketManager
  );
  const allTimeScoped = filterTicketsByMarketManager(tickets, marketManager);
  const contactReasonBreakdown = countBy(inPeriod, (t) =>
    normalizeLabel(t.contactReason, "Other")
  );
  const marketManagerBreakdown = countBy(inPeriod, (t) =>
    shortMarketManagerLabel(t.marketManager)
  );
  const contactReasonWeekKeys = topKeys(contactReasonBreakdown, 9);
  const contactReasonByWeek = buildWeeklyStack(
    inPeriod,
    (t) => normalizeLabel(t.contactReason, "Other"),
    contactReasonWeekKeys,
    "Other"
  );
  const topMMs =
    marketManager === "all"
      ? topKeys(marketManagerBreakdown, 6)
      : [marketManager];
  const contactReasonByMM = buildGroupedStack(
    inPeriod.filter((t) => topMMs.includes(shortMarketManagerLabel(t.marketManager))),
    (t) => shortMarketManagerLabel(t.marketManager),
    (t) => normalizeLabel(t.contactReason, "Other"),
    topMMs
  );
  const casesByWeek = buildWeeklyTotals(inPeriod);
  const casesByMonth = buildMonthlyTotals(inPeriod);
  const statusByWeek = buildStatusByWeek(inPeriod);
  const topRegionalHosts = countBy(inPeriod, (t) =>
    hostContactLabel(t)
  ).slice(0, 10);
  const hostsMarketManagers =
    marketManager === "all"
      ? listMarketManagersInPeriod(tickets, period)
      : [marketManager];
  const topHostsByMarketManager = buildTopHostsByMarketManager(
    inPeriod,
    hostsMarketManagers,
    HOSTS_PER_MARKET_MANAGER
  );
  const appealsBySA = buildAppealStacks(inPeriod, "sa");
  const overturnByAgent = buildAppealStacks(inPeriod, "overturn");
  const appealCsVsPolicy = buildAppealStacks(inPeriod, "csPolicy");

  return {
    period,
    periodLabel: dashboardPeriodLabel(period),
    totalTickets: allTimeScoped.length,
    periodTicketCount: inPeriod.length,
    contactReasonBreakdown,
    marketManagerBreakdown,
    contactReasonByWeek,
    contactReasonWeekKeys,
    contactReasonByMM,
    casesByWeek,
    casesByMonth,
    statusByWeek,
    topRegionalHosts,
    topHostsByMarketManager,
    appealsBySA: appealsBySA.groups,
    overturnByAgent: overturnByAgent.groups,
    appealCsVsPolicy: appealCsVsPolicy.groups,
    appealFieldsDetected:
      appealsBySA.detected || overturnByAgent.detected || appealCsVsPolicy.detected,
  };
}

function hostContactLabel(ticket: Ticket): string {
  const name = ticket.requesterName.trim();
  const email = ticket.requesterEmail.trim();
  if (name && email) return `${name} (${email})`;
  return name || email || "Unknown";
}

export function formatHostContactReasonBreakdown(reasons: CountItem[]): string {
  return [...reasons]
    .sort((a, b) => b.value - a.value || a.name.localeCompare(b.name))
    .map((reason) => `${reason.name} (${reason.value})`)
    .join(", ");
}

/** Market managers present on tickets in the selected period (dataset only). */
export function listMarketManagersInPeriod(
  tickets: Ticket[],
  period: DashboardPeriod
): string[] {
  const inPeriod = filterTicketsByPeriod(tickets, period);
  const names = new Set<string>();
  for (const ticket of inPeriod) {
    names.add(shortMarketManagerLabel(ticket.marketManager));
  }
  return [...names].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
}

export function buildTopHostsByMarketManagerReport(
  tickets: Ticket[],
  period: DashboardPeriod,
  marketManagerFilter: string | "all",
  hostsPerMm = HOSTS_PER_MARKET_MANAGER
): HostsByMarketManagerGroup[] {
  const inPeriod = filterTicketsByPeriod(tickets, period);
  const marketManagers =
    marketManagerFilter === "all"
      ? listMarketManagersInPeriod(tickets, period)
      : [marketManagerFilter];
  return buildTopHostsByMarketManager(inPeriod, marketManagers, hostsPerMm);
}

export function formatHostsByMarketManagerReport(params: {
  periodLabel: string;
  marketManagerFilter: string | "all";
  groups: HostsByMarketManagerGroup[];
}): string {
  const lines: string[] = [
    `Top host contacts — ${params.periodLabel}`,
    params.marketManagerFilter === "all"
      ? "Market managers: all in period"
      : `Market manager: ${params.marketManagerFilter}`,
    "",
  ];

  const withData = params.groups.filter((group) => group.total > 0);
  if (withData.length === 0) {
    lines.push("No host contacts in this period.");
    return lines.join("\n");
  }

  for (const group of withData) {
    lines.push(`${group.marketManager} — ${group.total} contact${group.total === 1 ? "" : "s"}`);
    group.hosts.forEach((host, index) => {
      const reasons = formatHostContactReasonBreakdown(host.contactReasons);
      lines.push(
        `${index + 1}. ${host.name} — ${host.value}${reasons ? `: ${reasons}` : ""}`
      );
    });
    lines.push("");
  }

  lines.push("Generated from SheetsCRM");
  return lines.join("\n").trimEnd();
}

export function formatHostsByMarketManagerReportHtml(params: {
  periodLabel: string;
  marketManagerFilter: string | "all";
  groups: HostsByMarketManagerGroup[];
}): string {
  const filterLine =
    params.marketManagerFilter === "all"
      ? "Market managers: all in period"
      : `Market manager: ${escapeHtml(params.marketManagerFilter)}`;

  const withData = params.groups.filter((group) => group.total > 0);
  const parts: string[] = [
    '<div style="font-family: Arial, Helvetica, sans-serif; font-size: 14px; color: #17494d;">',
    `<p style="margin: 0 0 8px;"><strong>Top host contacts — ${escapeHtml(params.periodLabel)}</strong></p>`,
    `<p style="margin: 0 0 16px; color: #68737d;">${filterLine}</p>`,
  ];

  if (withData.length === 0) {
    parts.push('<p style="color: #68737d;">No host contacts in this period.</p></div>');
    return parts.join("");
  }

  const cellStyle = "border: 1px solid #d8dcde; padding: 8px;";
  for (const group of withData) {
    parts.push(
      `<p style="margin: 16px 0 8px; font-weight: bold;">${escapeHtml(group.marketManager)} — ${group.total} contact${group.total === 1 ? "" : "s"}</p>`,
      '<table style="border-collapse: collapse; width: 100%; max-width: 720px; margin-bottom: 16px; font-size: 13px;">',
      "<thead>",
      '<tr style="background: #f4f6f8;">',
      `<th style="${cellStyle} text-align: left; width: 32px;">#</th>`,
      `<th style="${cellStyle} text-align: left;">Host</th>`,
      `<th style="${cellStyle} text-align: right; width: 72px;">Contacts</th>`,
      `<th style="${cellStyle} text-align: left;">Contact reasons</th>`,
      "</tr>",
      "</thead>",
      "<tbody>"
    );
    group.hosts.forEach((host, index) => {
      const reasons = formatHostContactReasonBreakdown(host.contactReasons);
      parts.push(
        "<tr>",
        `<td style="${cellStyle}">${index + 1}</td>`,
        `<td style="${cellStyle}">${escapeHtml(host.name)}</td>`,
        `<td style="${cellStyle} text-align: right; font-weight: bold;">${host.value}</td>`,
        `<td style="${cellStyle} color: #68737d;">${escapeHtml(reasons)}</td>`,
        "</tr>"
      );
    });
    parts.push("</tbody></table>");
  }

  parts.push(
    '<p style="margin-top: 8px; font-size: 11px; color: #87929d;">Generated from SheetsCRM</p>',
    "</div>"
  );
  return parts.join("");
}

function buildTopHostsByMarketManager(
  tickets: Ticket[],
  marketManagers: string[],
  hostsPerMm = HOSTS_PER_MARKET_MANAGER
): HostsByMarketManagerGroup[] {
  const map = new Map<string, Map<string, Map<string, number>>>();

  for (const ticket of tickets) {
    const mm = shortMarketManagerLabel(ticket.marketManager);
    if (!marketManagers.includes(mm)) continue;
    const host = hostContactLabel(ticket);
    const reason = normalizeLabel(ticket.contactReason, "Other");
    if (!map.has(mm)) map.set(mm, new Map());
    const hosts = map.get(mm)!;
    if (!hosts.has(host)) hosts.set(host, new Map());
    const reasons = hosts.get(host)!;
    reasons.set(reason, (reasons.get(reason) ?? 0) + 1);
  }

  return marketManagers.map((marketManager) => {
    const hostsMap = map.get(marketManager) ?? new Map();
    const hosts = [...hostsMap.entries()]
      .map(([name, reasonsMap]) => {
        const contactReasons = [...reasonsMap.entries()]
          .map(([reasonName, value]) => ({ name: reasonName, value }))
          .sort((a, b) => b.value - a.value || a.name.localeCompare(b.name));
        const value = contactReasons.reduce((sum, item) => sum + item.value, 0);
        return { name, value, contactReasons };
      })
      .sort((a, b) => b.value - a.value || a.name.localeCompare(b.name))
      .slice(0, hostsPerMm);
    const total = hosts.reduce((sum, h) => sum + h.value, 0);
    return { marketManager, hosts, total };
  });
}

function buildMonthlyTotals(tickets: Ticket[]): MonthSeriesPoint[] {
  const map = new Map<string, number>();

  for (const ticket of tickets) {
    const d = parseSheetTimestamp(ticket.timestamp);
    if (!d) continue;
    const monthStart = new Date(d.getFullYear(), d.getMonth(), 1);
    const monthKey = monthStart.toISOString();
    map.set(monthKey, (map.get(monthKey) ?? 0) + 1);
  }

  return [...map.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([monthKey, total]) => {
      const monthStart = new Date(monthKey);
      return {
        monthLabel: monthStart.toLocaleString(undefined, { month: "short", year: "numeric" }),
        monthStart: monthKey,
        total,
        cases: total,
      };
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
