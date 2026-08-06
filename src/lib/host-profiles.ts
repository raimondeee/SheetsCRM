/**
 * Client-safe host/parent-account helpers.
 * Sheet loading lives in host-profiles-loader.ts (server-only).
 */
import { isNumericUserId } from "./become-user-url";
import { LOCAL_TEAM_REGION } from "./team-dashboard-sources";

export const TOP_PARENT_ACCOUNTS_LIMIT = 10;
export const LOCAL_HOST_PROFILES_SHEET = "Dashboard Sheet Profiles";

export type HostProfileNameMap = Record<string, string>;

export interface ParentAccountVolumeItem {
  userId: string;
  /** Display label (profile name when known, otherwise the user ID). */
  name: string;
  value: number;
  /** True when a profile-tab name was found for this ID. */
  named: boolean;
}

/** Minimal tab shape for profile parsing (avoids importing sheet-tabs on the client). */
export interface HostProfileTabData {
  headers: string[];
  rows: string[][];
}

/** Normalize sheet user IDs so "12345" and "12345.0" join cleanly. */
export function normalizeHostUserId(raw: string): string {
  const trimmed = String(raw ?? "").trim();
  if (!trimmed) return "";
  if (/^\d+\.0+$/.test(trimmed)) return trimmed.replace(/\.0+$/, "");
  if (/^\d+$/.test(trimmed)) return trimmed;
  return trimmed;
}

export function formatParentAccountLabel(userId: string, profileName?: string): string {
  const id = normalizeHostUserId(userId);
  const name = profileName?.trim();
  if (name && id) return `${name} (${id})`;
  if (name) return name;
  return id || "Unknown";
}

function findColumnIndex(headers: string[], patterns: RegExp[]): number {
  for (let i = 0; i < headers.length; i += 1) {
    const header = (headers[i] ?? "").trim();
    if (!header) continue;
    if (patterns.some((pattern) => pattern.test(header))) return i;
  }
  return -1;
}

const USER_ID_HEADER_PATTERNS = [
  /airbnb\s*user\s*id/i,
  /user\s*id/i,
  /host\s*id/i,
  /^id$/i,
  /parent\s*id/i,
];

const PROFILE_NAME_HEADER_PATTERNS = [
  /profile\s*name/i,
  /parent\s*account/i,
  /parent\s*name/i,
  /account\s*name/i,
  /host\s*name/i,
  /^profile$/i,
  /^name$/i,
  /^parent$/i,
];

/** Parse a profiles tab into userId → display name. */
export function parseHostProfileTab(tab: HostProfileTabData): HostProfileNameMap {
  const map: HostProfileNameMap = {};
  const headers = tab.headers ?? [];
  let idIndex = findColumnIndex(headers, USER_ID_HEADER_PATTERNS);
  let nameIndex = findColumnIndex(headers, PROFILE_NAME_HEADER_PATTERNS);

  const headerLooksLikeId = normalizeHostUserId(headers[0] ?? "");
  const headerIsData =
    idIndex < 0 &&
    Boolean(headerLooksLikeId) &&
    (isNumericUserId(headerLooksLikeId) || headerLooksLikeId.length > 0);

  if (headerIsData) {
    idIndex = 0;
    nameIndex = headers.length > 1 ? 1 : -1;
    const id = normalizeHostUserId(headers[0] ?? "");
    const name = String(headers[1] ?? "").trim();
    if (id && name) map[id] = name;
  }

  if (idIndex < 0) idIndex = 0;
  if (nameIndex < 0) nameIndex = idIndex === 0 ? 1 : 0;

  for (const row of tab.rows) {
    const id = normalizeHostUserId(row[idIndex] ?? "");
    const name = String(row[nameIndex] ?? "").trim();
    if (!id || !name) continue;
    if (!map[id]) map[id] = name;
  }

  return map;
}

export function mergeHostProfileMaps(
  maps: Iterable<HostProfileNameMap>
): HostProfileNameMap {
  const merged: HostProfileNameMap = {};
  for (const map of maps) {
    for (const [id, name] of Object.entries(map)) {
      if (!merged[id] && name.trim()) merged[id] = name.trim();
    }
  }
  return merged;
}

/** Candidate companion profile tab titles for an intake sheet / region. */
export function profileCompanionTitleCandidates(
  intakeSheetName: string,
  region?: string
): string[] {
  const base = intakeSheetName.trim();
  const candidates: string[] = [];
  if (!base) return candidates;

  const regionHint = region?.trim() ?? "";
  if (
    /form\s*responses/i.test(base) ||
    /north\s*east/i.test(regionHint) ||
    regionHint === LOCAL_TEAM_REGION
  ) {
    candidates.push(LOCAL_HOST_PROFILES_SHEET);
  }

  candidates.push(
    `${base} profiles`,
    `${base} profile`,
    `${base} Profiles`,
    `${base} Profile`
  );
  return candidates;
}

function titlesEqual(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/** Resolve the first matching profile companion tab title from spreadsheet meta. */
export function resolveProfileCompanionTitle(
  availableTitles: string[],
  intakeSheetName: string,
  region?: string
): string | null {
  const candidates = profileCompanionTitleCandidates(intakeSheetName, region);
  for (const candidate of candidates) {
    const hit = availableTitles.find((title) => titlesEqual(title, candidate));
    if (hit) return hit;
  }
  return null;
}

export function buildTopParentAccounts(params: {
  userIds: Iterable<string>;
  profiles?: HostProfileNameMap;
  limit?: number;
}): ParentAccountVolumeItem[] {
  const profiles = params.profiles ?? {};
  const counts = new Map<string, number>();
  for (const raw of params.userIds) {
    const id = normalizeHostUserId(raw);
    if (!id) continue;
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, params.limit ?? TOP_PARENT_ACCOUNTS_LIMIT)
    .map(([userId, value]) => {
      const profileName = profiles[userId]?.trim() ?? "";
      return {
        userId,
        name: formatParentAccountLabel(userId, profileName),
        value,
        named: Boolean(profileName),
      };
    });
}

export function parentAccountsToCountItems(
  items: ParentAccountVolumeItem[]
): Array<{ name: string; value: number }> {
  return items.map((item) => ({ name: item.name, value: item.value }));
}
