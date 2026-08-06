import type { CountItem, MonthSeriesPoint, StackedGroup, WeekSeriesPoint } from "./dashboard-stats";
import { shortMarketManagerLabel } from "./dashboard-stats";
import {
  dashboardPeriodLabel,
  dateMatchesDashboardPeriod,
} from "./dashboard-period";
import {
  buildTopParentAccounts,
  normalizeHostUserId,
  parentAccountsToCountItems,
  type HostProfileNameMap,
  type ParentAccountVolumeItem,
} from "./host-profiles";
import {
  LOCAL_TEAM_REGION,
  TEAM_STATUS_BLANK_MAPPING_KEY,
  teamStatusMappingKey,
  type TeamStatusMappings,
  type TeamTabColumnMap,
  type TeamTabSource,
} from "./team-dashboard-sources";
import type { SheetTabData } from "./sheet-tabs";
import { parseSheetTimestamp } from "./ticket-activity";
import type { DashboardPeriod } from "./dashboard-period";
import type { Ticket } from "./types";

export interface TeamIntakeRecord {
  timestamp: string | null;
  status: string;
  owner: string;
  category: string;
  region: string;
  sourceId: string;
  /** Normalized Airbnb / host user ID when the intake tab has one. */
  userId: string;
}

export interface TeamRegionSummary {
  region: string;
  periodCount: number;
  allTimeCount: number;
}

export interface TeamStatusSummary {
  status: string;
  periodCount: number;
}

export interface TeamMetricsSnapshot {
  period: DashboardPeriod;
  periodLabel: string;
  regionFilter: string | "all";
  ownerFilter: string | "all";
  totalRecords: number;
  periodRecordCount: number;
  regionBreakdown: CountItem[];
  categoryBreakdown: CountItem[];
  ownerBreakdown: CountItem[];
  categoryWeekKeys: string[];
  categoryByWeek: WeekSeriesPoint[];
  categoryByRegion: StackedGroup[];
  casesByWeek: WeekSeriesPoint[];
  casesByMonth: MonthSeriesPoint[];
  casesByDayOfWeek: CountItem[];
  statusByWeek: WeekSeriesPoint[];
  regionSummaries: TeamRegionSummary[];
  statusSummaries: TeamStatusSummary[];
  topParentAccounts: ParentAccountVolumeItem[];
  topParentAccountBars: CountItem[];
  sourcesLoaded: number;
  hostProfilesLoaded: number;
}

function cell(row: string[], index: number): string {
  if (index < 0) return "";
  return String(row[index] ?? "").trim();
}

function normalizeLabel(value: string, fallback: string): string {
  const trimmed = value.trim();
  return trimmed || fallback;
}

function recordTimestamp(record: TeamIntakeRecord): Date | null {
  if (!record.timestamp) return null;
  return parseSheetTimestamp(record.timestamp);
}

export function recordMatchesDashboardPeriod(
  record: TeamIntakeRecord,
  period: DashboardPeriod
): boolean {
  const submittedAt = recordTimestamp(record);
  if (!submittedAt) return false;
  return dateMatchesDashboardPeriod(submittedAt, period);
}

export function parseTeamTab(
  source: TeamTabSource,
  tab: SheetTabData,
  columnOverride?: TeamTabColumnMap
): TeamIntakeRecord[] {
  const columns = columnOverride ?? source.columns;
  const records: TeamIntakeRecord[] = [];

  for (const row of tab.rows) {
    const timestampRaw = cell(row, columns.timestamp);
    if (!timestampRaw && !cell(row, columns.category) && !cell(row, columns.owner)) continue;

    records.push({
      timestamp: timestampRaw || null,
      status: cell(row, columns.status),
      owner: cell(row, columns.owner),
      category: cell(row, columns.category),
      region: source.region,
      sourceId: source.id,
      userId: normalizeHostUserId(cell(row, columns.userId)),
    });
  }

  return records;
}

export function ticketsToTeamRecords(tickets: Ticket[]): TeamIntakeRecord[] {
  return tickets.map((ticket) => ({
    timestamp: ticket.timestamp || null,
    status: ticket.sheetStatus,
    owner: ticket.marketManager,
    category: ticket.contactReason,
    region: LOCAL_TEAM_REGION,
    sourceId: "local-intake",
    userId: normalizeHostUserId(ticket.airbnbUserId || ticket.headerField || ""),
  }));
}

/**
 * Merge CRM inbox tickets with regional team-tab records.
 * When a configured source already covers {@link LOCAL_TEAM_REGION}, skip the
 * local Form Responses injection so that region is not counted twice in full CRM.
 */
export function mergeLocalAndColleagueTeamRecords(
  tickets: Ticket[],
  colleagueRecords: TeamIntakeRecord[]
): TeamIntakeRecord[] {
  const colleagueCoversLocalRegion = colleagueRecords.some(
    (record) => record.region === LOCAL_TEAM_REGION
  );
  if (colleagueCoversLocalRegion) return colleagueRecords;
  return [...ticketsToTeamRecords(tickets), ...colleagueRecords];
}

function filterRecords(
  records: TeamIntakeRecord[],
  period: DashboardPeriod,
  regionFilter: string | "all",
  ownerFilter: string | "all"
): TeamIntakeRecord[] {
  return records.filter((record) => {
    if (regionFilter !== "all" && record.region !== regionFilter) return false;
    if (
      ownerFilter !== "all" &&
      shortMarketManagerLabel(record.owner) !== ownerFilter
    ) {
      return false;
    }
    return recordMatchesDashboardPeriod(record, period);
  });
}

function filterRecordsAllTime(
  records: TeamIntakeRecord[],
  regionFilter: string | "all",
  ownerFilter: string | "all"
): TeamIntakeRecord[] {
  return records.filter((record) => {
    if (regionFilter !== "all" && record.region !== regionFilter) return false;
    if (
      ownerFilter !== "all" &&
      shortMarketManagerLabel(record.owner) !== ownerFilter
    ) {
      return false;
    }
    return true;
  });
}

export function listTeamOwnersInPeriod(
  records: TeamIntakeRecord[],
  period: DashboardPeriod,
  regionFilter: string | "all" = "all"
): string[] {
  const names = new Set<string>();
  for (const record of filterRecords(records, period, regionFilter, "all")) {
    names.add(shortMarketManagerLabel(record.owner));
  }
  return [...names].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
}

export function listTeamRegions(records: TeamIntakeRecord[]): string[] {
  const names = new Set<string>();
  for (const record of records) {
    names.add(record.region);
  }
  return [...names].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
}

function countBy(records: TeamIntakeRecord[], pick: (r: TeamIntakeRecord) => string): CountItem[] {
  const map = new Map<string, number>();
  for (const record of records) {
    const key = pick(record);
    map.set(key, (map.get(key) ?? 0) + 1);
  }
  return [...map.entries()]
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value);
}

function topKeys(items: CountItem[], limit: number): string[] {
  return items.slice(0, limit).map((i) => i.name);
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

function buildWeeklyStack(
  records: TeamIntakeRecord[],
  pickSegment: (r: TeamIntakeRecord) => string,
  segmentKeys: string[],
  otherLabel: string
): WeekSeriesPoint[] {
  const weekMap = new Map<string, Map<string, number>>();

  for (const record of records) {
    const d = recordTimestamp(record);
    if (!d) continue;
    const weekStart = getWeekStartSunday(d);
    const weekKey = weekStart.toISOString();
    if (!weekMap.has(weekKey)) weekMap.set(weekKey, new Map());
    const segment = segmentKeys.includes(pickSegment(record))
      ? pickSegment(record)
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

function buildWeeklyTotals(records: TeamIntakeRecord[]): WeekSeriesPoint[] {
  const map = new Map<string, number>();
  for (const record of records) {
    const d = recordTimestamp(record);
    if (!d) continue;
    const weekKey = getWeekStartSunday(d).toISOString();
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

const DAY_OF_WEEK_LABELS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

function buildDayOfWeekTotals(records: TeamIntakeRecord[]): CountItem[] {
  const counts = [0, 0, 0, 0, 0, 0, 0];
  for (const record of records) {
    const d = recordTimestamp(record);
    if (!d) continue;
    counts[d.getDay()] += 1;
  }
  return DAY_OF_WEEK_LABELS.map((name, index) => ({
    name,
    value: counts[index] ?? 0,
  }));
}

function buildMonthlyTotals(records: TeamIntakeRecord[]): MonthSeriesPoint[] {
  const map = new Map<string, number>();
  for (const record of records) {
    const d = recordTimestamp(record);
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

function isResolvedSheetStatus(status: string): boolean {
  return /resolved|solved|closed|complete|done/i.test(status.trim());
}

function isPendingSheetStatus(status: string): boolean {
  return /pending|awaiting|waiting|open|in progress|new/i.test(status.trim());
}

/** Preferred order for status overview cards (sheet + CRM labels). */
export const TEAM_STATUS_BUCKET_OPTIONS = [
  "Blank",
  "New",
  "Open",
  "Pending",
  "Resolved",
  "Do Not Action",
  "Longterm Hold/Bugs",
] as const;

export function normalizeTeamStatusLabel(
  status: string,
  mappings: TeamStatusMappings = {}
): string {
  const mapped = mappings[teamStatusMappingKey(status)]?.trim();
  if (mapped) return mapped;
  const trimmed = status.trim();
  if (!trimmed) return "Blank";
  const lower = trimmed.toLowerCase();
  for (const known of TEAM_STATUS_BUCKET_OPTIONS) {
    if (known.toLowerCase() === lower) return known;
  }
  return trimmed;
}

/** Distinct raw sheet statuses (before bucket mapping) for the mapping editor. */
export function listRawTeamStatusesInPeriod(
  records: TeamIntakeRecord[],
  period: DashboardPeriod,
  regionFilter: string | "all" = "all",
  ownerFilter: string | "all" = "all"
): CountItem[] {
  const counts = new Map<string, number>();
  for (const record of filterRecords(records, period, regionFilter, ownerFilter)) {
    const raw = record.status.trim() || TEAM_STATUS_BLANK_MAPPING_KEY;
    counts.set(raw, (counts.get(raw) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value || a.name.localeCompare(b.name));
}

function buildStatusSummaries(
  records: TeamIntakeRecord[],
  mappings: TeamStatusMappings
): TeamStatusSummary[] {
  const counts = new Map<string, number>();
  for (const record of records) {
    const label = normalizeTeamStatusLabel(record.status, mappings);
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }

  // Only show buckets that have volume after mapping (empty preferred tiles hide).
  const summaries: TeamStatusSummary[] = [];
  const seen = new Set<string>();
  for (const status of TEAM_STATUS_BUCKET_OPTIONS) {
    const periodCount = counts.get(status) ?? 0;
    if (periodCount <= 0) {
      seen.add(status);
      continue;
    }
    summaries.push({ status, periodCount });
    seen.add(status);
  }
  const extras = [...counts.entries()]
    .filter(([status, periodCount]) => !seen.has(status) && periodCount > 0)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  for (const [status, periodCount] of extras) {
    summaries.push({ status, periodCount });
  }
  return summaries;
}

function buildStatusByWeek(
  records: TeamIntakeRecord[],
  mappings: TeamStatusMappings
): WeekSeriesPoint[] {
  const weekMap = new Map<string, { resolved: number; pending: number }>();

  for (const record of records) {
    const d = recordTimestamp(record);
    if (!d) continue;
    const weekKey = getWeekStartSunday(d).toISOString();
    if (!weekMap.has(weekKey)) weekMap.set(weekKey, { resolved: 0, pending: 0 });
    const bucket = weekMap.get(weekKey)!;
    const label = normalizeTeamStatusLabel(record.status, mappings);
    if (isResolvedSheetStatus(label)) bucket.resolved += 1;
    else if (isPendingSheetStatus(label)) bucket.pending += 1;
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

function buildGroupedStack(
  records: TeamIntakeRecord[],
  pickGroup: (r: TeamIntakeRecord) => string,
  pickSegment: (r: TeamIntakeRecord) => string,
  groupOrder: string[]
): StackedGroup[] {
  const map = new Map<string, Map<string, number>>();

  for (const record of records) {
    const group = pickGroup(record);
    if (!groupOrder.includes(group)) continue;
    const segment = pickSegment(record);
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

export function buildTeamMetrics(params: {
  records: TeamIntakeRecord[];
  period: DashboardPeriod;
  regionFilter?: string | "all";
  ownerFilter?: string | "all";
  sourcesLoaded?: number;
  statusMappings?: TeamStatusMappings;
  hostProfiles?: HostProfileNameMap;
  hostProfilesLoaded?: number;
}): TeamMetricsSnapshot {
  const regionFilter = params.regionFilter ?? "all";
  const ownerFilter = params.ownerFilter ?? "all";
  const statusMappings = params.statusMappings ?? {};
  const hostProfiles = params.hostProfiles ?? {};
  const inPeriod = filterRecords(params.records, params.period, regionFilter, ownerFilter);
  const allTimeScoped = filterRecordsAllTime(params.records, regionFilter, ownerFilter);

  const regionBreakdown = countBy(inPeriod, (r) => r.region);
  const categoryBreakdown = countBy(inPeriod, (r) =>
    normalizeLabel(r.category, "Other")
  );
  const ownerBreakdown = countBy(inPeriod, (r) => shortMarketManagerLabel(r.owner));
  const categoryWeekKeys = topKeys(categoryBreakdown, 9);
  const categoryByWeek = buildWeeklyStack(
    inPeriod,
    (r) => normalizeLabel(r.category, "Other"),
    categoryWeekKeys,
    "Other"
  );

  const regionOrder =
    regionFilter === "all"
      ? listTeamRegions(params.records)
      : [regionFilter];
  const categoryByRegion = buildGroupedStack(
    inPeriod.filter((r) => regionOrder.includes(r.region)),
    (r) => r.region,
    (r) => normalizeLabel(r.category, "Other"),
    regionOrder
  );

  const allTimeByRegion = new Map<string, number>();
  for (const record of allTimeScoped) {
    allTimeByRegion.set(record.region, (allTimeByRegion.get(record.region) ?? 0) + 1);
  }
  const periodByRegion = new Map<string, number>();
  for (const record of inPeriod) {
    periodByRegion.set(record.region, (periodByRegion.get(record.region) ?? 0) + 1);
  }

  const regionSummaries: TeamRegionSummary[] = regionOrder.map((region) => ({
    region,
    periodCount: periodByRegion.get(region) ?? 0,
    allTimeCount: allTimeByRegion.get(region) ?? 0,
  }));

  const statusSummaries = buildStatusSummaries(inPeriod, statusMappings);
  const topParentAccounts = buildTopParentAccounts({
    userIds: inPeriod.map((record) => record.userId),
    profiles: hostProfiles,
  });

  return {
    period: params.period,
    periodLabel: dashboardPeriodLabel(params.period),
    regionFilter,
    ownerFilter,
    totalRecords: allTimeScoped.length,
    periodRecordCount: inPeriod.length,
    regionBreakdown,
    categoryBreakdown,
    ownerBreakdown,
    categoryWeekKeys,
    categoryByWeek,
    categoryByRegion,
    casesByWeek: buildWeeklyTotals(inPeriod),
    casesByMonth: buildMonthlyTotals(inPeriod),
    casesByDayOfWeek: buildDayOfWeekTotals(inPeriod),
    statusByWeek: buildStatusByWeek(inPeriod, statusMappings),
    regionSummaries,
    statusSummaries,
    topParentAccounts,
    topParentAccountBars: parentAccountsToCountItems(topParentAccounts),
    sourcesLoaded: params.sourcesLoaded ?? 0,
    hostProfilesLoaded: params.hostProfilesLoaded ?? 0,
  };
}
