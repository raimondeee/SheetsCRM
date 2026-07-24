import type { DashboardPeriod } from "./dashboard-period";
import { normalizeDashboardPeriod } from "./dashboard-period";
import type { ExternalToolLink } from "./external-tools";
import { defaultExternalTools, normalizeExternalTools } from "./external-tools";
import {
  DEFAULT_NOTIFICATION_SOUND_PREFERENCES,
  normalizeNotificationSoundPreferences,
  type NotificationSoundPreferences,
} from "./notification-sounds";
import {
  DEFAULT_TIMER_SETTINGS,
  normalizeTimerSettings,
  type TimerSettings,
} from "./timer-settings";
import {
  DEFAULT_WELLNESS_PREFERENCES,
  normalizeWellnessPreferences,
  type WellnessPreferences,
} from "./wellness-preferences";

export type SortOrder = "asc" | "desc";
export type SortBy = "submitted" | "updated";

export interface UserPreferences
  extends TimerSettings, NotificationSoundPreferences, WellnessPreferences {
  defaultStatusFilter: string;
  sortBy: SortBy;
  sortOrder: SortOrder;
  dashboardPeriod: DashboardPeriod;
  errorLoggingEnabled: boolean;
  /** When true, upcoming events show a full-screen reminder instead of a corner toast. */
  calendarReminderFullscreen: boolean;
  /** Show "Bind to selected" in the Gmail unread inbox modal. */
  unreadInboxBindToSelectedEnabled: boolean;
  /** Show "Append to selected" in the Gmail unread inbox modal. */
  unreadInboxAppendToSelectedEnabled: boolean;
  externalTools: ExternalToolLink[];
}

export const DEFAULT_USER_PREFERENCES: UserPreferences = {
  defaultStatusFilter: "all",
  sortBy: "submitted",
  sortOrder: "desc",
  dashboardPeriod: "3m",
  errorLoggingEnabled: false,
  calendarReminderFullscreen: false,
  unreadInboxBindToSelectedEnabled: false,
  unreadInboxAppendToSelectedEnabled: true,
  externalTools: defaultExternalTools(),
  ...DEFAULT_TIMER_SETTINGS,
  ...DEFAULT_NOTIFICATION_SOUND_PREFERENCES,
  ...DEFAULT_WELLNESS_PREFERENCES,
};

const LEGACY_STORAGE_KEY = "sheetscrm_user_preferences";
const LEGACY_COMPOSE_KEY = "sheetscrm_compose_prefs";
const MIGRATION_FLAG_KEY = "sheetscrm_prefs_migrated_v1";

/** @deprecated Browser-only legacy store — used once to migrate into overlay.db */
export function readLegacyUserPreferences(): UserPreferences | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(LEGACY_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<UserPreferences>;
    return {
      defaultStatusFilter:
        typeof parsed.defaultStatusFilter === "string"
          ? parsed.defaultStatusFilter
          : DEFAULT_USER_PREFERENCES.defaultStatusFilter,
      sortBy:
        parsed.sortBy === "submitted" || parsed.sortBy === "updated"
          ? parsed.sortBy
          : DEFAULT_USER_PREFERENCES.sortBy,
      sortOrder:
        parsed.sortOrder === "asc" || parsed.sortOrder === "desc"
          ? parsed.sortOrder
          : DEFAULT_USER_PREFERENCES.sortOrder,
      dashboardPeriod: normalizeDashboardPeriod(parsed.dashboardPeriod),
      errorLoggingEnabled:
        typeof parsed.errorLoggingEnabled === "boolean"
          ? parsed.errorLoggingEnabled
          : DEFAULT_USER_PREFERENCES.errorLoggingEnabled,
      calendarReminderFullscreen:
        typeof parsed.calendarReminderFullscreen === "boolean"
          ? parsed.calendarReminderFullscreen
          : DEFAULT_USER_PREFERENCES.calendarReminderFullscreen,
      unreadInboxBindToSelectedEnabled:
        typeof parsed.unreadInboxBindToSelectedEnabled === "boolean"
          ? parsed.unreadInboxBindToSelectedEnabled
          : DEFAULT_USER_PREFERENCES.unreadInboxBindToSelectedEnabled,
      unreadInboxAppendToSelectedEnabled:
        typeof parsed.unreadInboxAppendToSelectedEnabled === "boolean"
          ? parsed.unreadInboxAppendToSelectedEnabled
          : DEFAULT_USER_PREFERENCES.unreadInboxAppendToSelectedEnabled,
      externalTools: normalizeExternalTools(parsed.externalTools),
      ...normalizeTimerSettings(parsed),
      ...normalizeNotificationSoundPreferences(parsed),
      ...normalizeWellnessPreferences(parsed),
    };
  } catch {
    return null;
  }
}

export function readLegacyComposePrefs(): Record<string, { ccMarketManager: boolean }> | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(LEGACY_COMPOSE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Record<string, { ccMarketManager?: boolean }>;
    if (!parsed || typeof parsed !== "object") return null;
    const result: Record<string, { ccMarketManager: boolean }> = {};
    for (const [rowId, prefs] of Object.entries(parsed)) {
      result[rowId] = { ccMarketManager: Boolean(prefs?.ccMarketManager) };
    }
    return result;
  } catch {
    return null;
  }
}

export function clearLegacyBrowserPreferences(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(LEGACY_STORAGE_KEY);
  localStorage.removeItem(LEGACY_COMPOSE_KEY);
  localStorage.setItem(MIGRATION_FLAG_KEY, "1");
}

export function hasLegacyBrowserPreferences(): boolean {
  if (typeof window === "undefined") return false;
  if (localStorage.getItem(MIGRATION_FLAG_KEY)) return false;
  return Boolean(localStorage.getItem(LEGACY_STORAGE_KEY) || localStorage.getItem(LEGACY_COMPOSE_KEY));
}

export async function fetchUserPreferences(): Promise<UserPreferences> {
  const res = await fetch("/api/preferences", { cache: "no-store", credentials: "same-origin" });
  const data = await res.json();
  if (!res.ok) return DEFAULT_USER_PREFERENCES;
  return {
    ...DEFAULT_USER_PREFERENCES,
    ...data.preferences,
    externalTools: normalizeExternalTools(data.preferences?.externalTools),
    ...normalizeNotificationSoundPreferences(data.preferences),
    ...normalizeWellnessPreferences(data.preferences),
  };
}

export async function saveUserPreferences(prefs: UserPreferences): Promise<UserPreferences> {
  const res = await fetch("/api/preferences", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ preferences: prefs }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Failed to save preferences");
  return {
    ...DEFAULT_USER_PREFERENCES,
    ...data.preferences,
    externalTools: normalizeExternalTools(data.preferences?.externalTools),
    ...normalizeNotificationSoundPreferences(data.preferences),
    ...normalizeWellnessPreferences(data.preferences),
  };
}

export async function migrateLegacyPreferencesIfNeeded(): Promise<void> {
  if (!hasLegacyBrowserPreferences()) return;

  const legacyPrefs = readLegacyUserPreferences();
  const legacyCompose = readLegacyComposePrefs();

  await fetch("/api/preferences", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      preferences: legacyPrefs ?? undefined,
      migrateCompose: legacyCompose ?? undefined,
    }),
  });

  clearLegacyBrowserPreferences();
}
