export type SortOrder = "asc" | "desc";

export interface UserPreferences {
  defaultStatusFilter: string;
  sortOrder: SortOrder;
}

export const DEFAULT_USER_PREFERENCES: UserPreferences = {
  defaultStatusFilter: "all",
  sortOrder: "desc",
};

const STORAGE_KEY = "sheetscrm_user_preferences";

export function loadUserPreferences(): UserPreferences {
  if (typeof window === "undefined") return DEFAULT_USER_PREFERENCES;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_USER_PREFERENCES;
    const parsed = JSON.parse(raw) as Partial<UserPreferences>;
    return {
      defaultStatusFilter:
        typeof parsed.defaultStatusFilter === "string"
          ? parsed.defaultStatusFilter
          : DEFAULT_USER_PREFERENCES.defaultStatusFilter,
      sortOrder:
        parsed.sortOrder === "asc" || parsed.sortOrder === "desc"
          ? parsed.sortOrder
          : DEFAULT_USER_PREFERENCES.sortOrder,
    };
  } catch {
    return DEFAULT_USER_PREFERENCES;
  }
}

export function saveUserPreferences(prefs: UserPreferences): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
}
