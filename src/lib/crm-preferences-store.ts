import type { DashboardPeriod } from "./dashboard-period";
import type { ExternalToolLink } from "./external-tools";
import { defaultExternalTools, normalizeExternalTools } from "./external-tools";
import { getOverlayDb } from "./overlay-db";
import {
  normalizeTimerSettings,
  timerSettingsFromPreferences,
  type TimerSettings,
} from "./timer-settings";
import type { SortBy, SortOrder } from "./user-preferences";
import { DEFAULT_USER_PREFERENCES } from "./user-preferences";

export interface StoredUserPreferences extends TimerSettings {
  defaultStatusFilter: string;
  sortBy: SortBy;
  sortOrder: SortOrder;
  dashboardPeriod: DashboardPeriod;
  errorLoggingEnabled: boolean;
  externalTools: ExternalToolLink[];
}

export const DEFAULT_STORED_PREFERENCES: StoredUserPreferences = {
  ...DEFAULT_USER_PREFERENCES,
  dashboardPeriod: "3m",
};

export interface TicketComposePrefs {
  ccMarketManager: boolean;
}

function getDb() {
  return getOverlayDb();
}

function normalizeUserKey(userKey: string | null | undefined): string {
  const trimmed = userKey?.trim().toLowerCase();
  return trimmed || "local";
}

function parseStoredPreferences(raw: string | null): StoredUserPreferences {
  if (!raw) return { ...DEFAULT_STORED_PREFERENCES };
  try {
    const parsed = JSON.parse(raw) as Partial<StoredUserPreferences>;
    return {
      defaultStatusFilter:
        typeof parsed.defaultStatusFilter === "string"
          ? parsed.defaultStatusFilter
          : DEFAULT_STORED_PREFERENCES.defaultStatusFilter,
      sortBy:
        parsed.sortBy === "submitted" || parsed.sortBy === "updated"
          ? parsed.sortBy
          : DEFAULT_STORED_PREFERENCES.sortBy,
      sortOrder:
        parsed.sortOrder === "asc" || parsed.sortOrder === "desc"
          ? parsed.sortOrder
          : DEFAULT_STORED_PREFERENCES.sortOrder,
      dashboardPeriod:
        parsed.dashboardPeriod === "all" ||
        parsed.dashboardPeriod === "6m" ||
        parsed.dashboardPeriod === "3m" ||
        parsed.dashboardPeriod === "1m" ||
        parsed.dashboardPeriod === "2w"
          ? parsed.dashboardPeriod
          : DEFAULT_STORED_PREFERENCES.dashboardPeriod,
      errorLoggingEnabled:
        typeof parsed.errorLoggingEnabled === "boolean"
          ? parsed.errorLoggingEnabled
          : DEFAULT_STORED_PREFERENCES.errorLoggingEnabled,
      externalTools: normalizeExternalTools(parsed.externalTools),
      ...normalizeTimerSettings(parsed),
    };
  } catch {
    return { ...DEFAULT_STORED_PREFERENCES };
  }
}

export function loadTimerSettings(userKey?: string | null): TimerSettings {
  return timerSettingsFromPreferences(loadStoredUserPreferences(userKey));
}

export function loadStoredUserPreferences(userKey?: string | null): StoredUserPreferences {
  const key = normalizeUserKey(userKey);
  const row = getDb()
    .prepare("SELECT preferences_json FROM user_preferences WHERE user_key = ?")
    .get(key) as { preferences_json: string } | undefined;
  return parseStoredPreferences(row?.preferences_json ?? null);
}

export function saveStoredUserPreferences(
  prefs: StoredUserPreferences,
  userKey?: string | null
): StoredUserPreferences {
  const key = normalizeUserKey(userKey);
  const normalized = parseStoredPreferences(JSON.stringify(prefs));
  getDb()
    .prepare(
      `INSERT INTO user_preferences (user_key, preferences_json, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(user_key) DO UPDATE SET
         preferences_json = excluded.preferences_json,
         updated_at = excluded.updated_at`
    )
    .run(key, JSON.stringify(normalized), new Date().toISOString());
  return normalized;
}

export function loadTicketComposePrefs(
  ticketRowId: string,
  userKey?: string | null
): TicketComposePrefs {
  const key = normalizeUserKey(userKey);
  const row = getDb()
    .prepare(
      `SELECT cc_market_manager FROM ticket_compose_prefs
       WHERE user_key = ? AND ticket_row_id = ?`
    )
    .get(key, ticketRowId) as { cc_market_manager: number } | undefined;
  return { ccMarketManager: row?.cc_market_manager === 1 };
}

export function saveTicketComposePrefs(
  ticketRowId: string,
  prefs: TicketComposePrefs,
  userKey?: string | null
): void {
  const key = normalizeUserKey(userKey);
  getDb()
    .prepare(
      `INSERT INTO ticket_compose_prefs (user_key, ticket_row_id, cc_market_manager, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(user_key, ticket_row_id) DO UPDATE SET
         cc_market_manager = excluded.cc_market_manager,
         updated_at = excluded.updated_at`
    )
    .run(key, ticketRowId, prefs.ccMarketManager ? 1 : 0, new Date().toISOString());
}

export function bulkImportTicketComposePrefs(
  entries: Record<string, TicketComposePrefs>,
  userKey?: string | null
): number {
  const key = normalizeUserKey(userKey);
  const stmt = getDb().prepare(
    `INSERT INTO ticket_compose_prefs (user_key, ticket_row_id, cc_market_manager, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(user_key, ticket_row_id) DO UPDATE SET
       cc_market_manager = excluded.cc_market_manager,
       updated_at = excluded.updated_at`
  );
  const now = new Date().toISOString();
  const rows = Object.entries(entries);
  const tx = getDb().transaction((batch: [string, TicketComposePrefs][]) => {
    for (const [ticketRowId, prefs] of batch) {
      stmt.run(key, ticketRowId, prefs.ccMarketManager ? 1 : 0, now);
    }
  });
  tx(rows);
  return rows.length;
}
