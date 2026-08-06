import { EXAMPLE_SPREADSHEET_ID } from "./default-sheet-config";
import { letterToIndex, indexToLetter, parseSheetUrl } from "./types";

/** Region label for the local Form Responses intake tab (full CRM only). */
export const LOCAL_TEAM_REGION = "North East and Canada";

export interface TeamTabColumnLetters {
  timestamp: string;
  status: string;
  owner: string;
  category: string;
  /** Optional Airbnb / host user ID column (header-detected when blank). */
  userId?: string;
}

export interface TeamTabColumnMap {
  timestamp: number;
  status: number;
  owner: number;
  category: number;
  /** -1 when unknown / not mapped. */
  userId: number;
}

export interface TeamTabSource {
  id: string;
  region: string;
  sheetName: string;
  gid: string;
  spreadsheetId?: string;
  columns: TeamTabColumnMap;
}

/** Editable, read-only reporting source for the Team Dashboard. */
export interface TeamTabSourceConfig {
  id: string;
  region: string;
  sheetName: string;
  gid: string;
  enabled?: boolean;
  /** Direct source-sheet URL; only read by the dashboard. */
  sheetUrl?: string;
  /** Derived from sheetUrl, or an explicit spreadsheet ID for legacy sources. */
  spreadsheetId?: string;
  columns: TeamTabColumnLetters;
}

/**
 * Case-insensitive raw sheet status → display bucket for Team Dashboard cards.
 * Keys are stored lowercased (e.g. "pending on mc" → "Pending").
 * Empty sheet statuses use {@link TEAM_STATUS_BLANK_MAPPING_KEY}.
 */
export type TeamStatusMappings = Record<string, string>;

/** Sentinel mapping key for empty / blank sheet status cells. */
export const TEAM_STATUS_BLANK_MAPPING_KEY = "(blank)";

export interface TeamDashboardSourcesFile {
  spreadsheetId: string;
  sources: TeamTabSourceConfig[];
  /** Optional rollup of regional status spellings into shared buckets. */
  statusMappings?: TeamStatusMappings;
}

export function teamStatusMappingKey(rawStatus: string): string {
  const trimmed = rawStatus.trim();
  if (!trimmed || trimmed.toLowerCase() === TEAM_STATUS_BLANK_MAPPING_KEY) {
    return TEAM_STATUS_BLANK_MAPPING_KEY;
  }
  return trimmed.toLowerCase();
}

export function normalizeTeamStatusMappings(value: unknown): TeamStatusMappings {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: TeamStatusMappings = {};
  for (const [raw, bucket] of Object.entries(value as Record<string, unknown>)) {
    const key = teamStatusMappingKey(raw);
    const bucketLabel = typeof bucket === "string" ? bucket.trim() : "";
    if (!bucketLabel) continue;
    out[key] = bucketLabel;
  }
  return out;
}

function cols(letters: TeamTabColumnLetters): TeamTabColumnMap {
  const userIdLetter = letters.userId?.trim().toUpperCase() || "";
  return {
    timestamp: letterToIndex(letters.timestamp),
    status: letterToIndex(letters.status),
    owner: letterToIndex(letters.owner),
    category: letterToIndex(letters.category),
    userId: userIdLetter ? letterToIndex(userIdLetter) : -1,
  };
}

export function teamSourceFromConfig(config: TeamTabSourceConfig): TeamTabSource {
  const userId = config.columns.userId?.trim().toUpperCase() || "";
  return {
    id: config.id.trim(),
    region: config.region.trim(),
    sheetName: config.sheetName.trim(),
    gid: String(config.gid).trim(),
    spreadsheetId: config.spreadsheetId?.trim() || undefined,
    columns: cols({
      timestamp: config.columns.timestamp.trim().toUpperCase() || "A",
      status: config.columns.status.trim().toUpperCase() || "B",
      owner: config.columns.owner.trim().toUpperCase() || "C",
      category: config.columns.category.trim().toUpperCase() || "D",
      userId: userId || undefined,
    }),
  };
}

export const TEAM_SPREADSHEET_ID = EXAMPLE_SPREADSHEET_ID;

/** Hardcoded regional tabs for the full CRM Team dashboard. */
export const TEAM_TAB_SOURCES: TeamTabSource[] = [
  {
    id: "west-coast",
    region: "West Coast and Beach",
    sheetName: "Sheet31",
    gid: "914818793",
    columns: cols({ timestamp: "A", status: "N", owner: "G", category: "K" }),
  },
  {
    id: "great-lakes",
    region: "Great Lakes and Smoky Mountains",
    sheetName: "Sheet32",
    gid: "2057128065",
    columns: cols({ timestamp: "A", status: "K", owner: "D", category: "J" }),
  },
  {
    id: "south-east",
    region: "South East",
    sheetName: "Sheet33",
    gid: "430297604",
    columns: cols({ timestamp: "A", status: "N", owner: "G", category: "K" }),
  },
  {
    id: "adventure-rocky",
    region: "Adventure and Rocky Mountain",
    sheetName: "Sheet34",
    gid: "1492289265",
    columns: cols({ timestamp: "A", status: "L", owner: "G", category: "J" }),
  },
  {
    id: "brssa",
    region: "BRSSA",
    sheetName: "Sheet35",
    gid: "860670685",
    columns: cols({ timestamp: "A", status: "AB", owner: "Q", category: "X" }),
  },
  {
    id: "mx",
    region: "MX",
    sheetName: "Sheet36 BOTH",
    gid: "272043903",
    columns: cols({ timestamp: "A", status: "M", owner: "K", category: "L" }),
  },
];

export const DEFAULT_TEAM_DASHBOARD_SOURCES_FILE: TeamDashboardSourcesFile = {
  spreadsheetId: TEAM_SPREADSHEET_ID,
  sources: TEAM_TAB_SOURCES.map((source) => ({
    id: source.id,
    region: source.region,
    sheetName: source.sheetName,
    gid: source.gid,
    enabled: true,
    spreadsheetId: TEAM_SPREADSHEET_ID,
    sheetUrl: `https://docs.google.com/spreadsheets/d/${TEAM_SPREADSHEET_ID}/edit?gid=${source.gid}`,
    columns: {
      timestamp: indexToLetter(source.columns.timestamp),
      status: indexToLetter(source.columns.status),
      owner: indexToLetter(source.columns.owner),
      category: indexToLetter(source.columns.category),
    },
  })),
  statusMappings: {},
};

function normalizeColumnLetters(value: unknown): TeamTabColumnLetters | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const timestamp = typeof row.timestamp === "string" ? row.timestamp.trim() : "";
  const status = typeof row.status === "string" ? row.status.trim() : "";
  const owner = typeof row.owner === "string" ? row.owner.trim() : "";
  const category = typeof row.category === "string" ? row.category.trim() : "";
  const userId = typeof row.userId === "string" ? row.userId.trim() : "";
  if (!timestamp || !status || !owner || !category) return null;
  return {
    timestamp: timestamp.toUpperCase(),
    status: status.toUpperCase(),
    owner: owner.toUpperCase(),
    category: category.toUpperCase(),
    userId: userId ? userId.toUpperCase() : undefined,
  };
}

function normalizeSourceConfig(value: unknown): TeamTabSourceConfig | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const id = typeof row.id === "string" ? row.id.trim() : "";
  const region = typeof row.region === "string" ? row.region.trim() : "";
  const sheetName = typeof row.sheetName === "string" ? row.sheetName.trim() : "";
  const gid =
    typeof row.gid === "string"
      ? row.gid.trim()
      : typeof row.gid === "number"
        ? String(row.gid)
        : "";
  const sheetUrl = typeof row.sheetUrl === "string" ? row.sheetUrl.trim() : "";
  const directSpreadsheetId =
    typeof row.spreadsheetId === "string" ? row.spreadsheetId.trim() : "";
  const spreadsheetId = parseSheetUrl(sheetUrl)?.spreadsheetId ?? directSpreadsheetId;
  const parsedGid = parseSheetUrl(sheetUrl)?.gid ?? "";
  const columns = normalizeColumnLetters(row.columns);
  if (!id || !region || !sheetName || !columns) return null;
  return {
    id,
    region,
    sheetName,
    gid: gid || parsedGid,
    enabled: row.enabled !== false,
    sheetUrl: sheetUrl || undefined,
    spreadsheetId: spreadsheetId || undefined,
    columns,
  };
}

/** Used by the shareable Team Dashboard source-sheet tools / JSON config. */
export function normalizeTeamDashboardSourcesFile(
  partial: Partial<TeamDashboardSourcesFile> | null | undefined
): TeamDashboardSourcesFile {
  const spreadsheetId =
    typeof partial?.spreadsheetId === "string" && partial.spreadsheetId.trim()
      ? partial.spreadsheetId.trim()
      : DEFAULT_TEAM_DASHBOARD_SOURCES_FILE.spreadsheetId;

  const rawSources = Array.isArray(partial?.sources) ? partial.sources : null;
  const sources: TeamTabSourceConfig[] = [];
  if (rawSources) {
    for (const entry of rawSources) {
      const normalized = normalizeSourceConfig(entry);
      if (!normalized) continue;
      if (sources.some((s) => s.id === normalized.id)) continue;
      sources.push(normalized);
    }
  }

  const statusMappings = normalizeTeamStatusMappings(partial?.statusMappings);

  return {
    spreadsheetId,
    sources: sources.length > 0 ? sources : DEFAULT_TEAM_DASHBOARD_SOURCES_FILE.sources,
    statusMappings,
  };
}
