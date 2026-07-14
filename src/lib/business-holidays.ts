import {
  loadWorkspaceHolidayDatesFromCache,
  saveWorkspaceHolidayDatesToCache,
  workspaceHolidayCacheIsFresh,
} from "./overlay-db";

/** US holidays — shared workspace calendar (Google public holidays). */
export const US_HOLIDAY_CALENDAR_ID = "en.usa#holiday@group.v.calendar.google.com";

const US_HOLIDAY_ICS_URL =
  "https://calendar.google.com/calendar/ical/en.usa%23holiday%40group.v.calendar.google.com/public/basic.ics";

let memoryDates: ReadonlySet<string> | null = null;
let refreshPromise: Promise<ReadonlySet<string>> | null = null;

/** Parse all-day VEVENT dates from the public Google Holidays ICS feed. */
export function parseUsHolidayIcs(ics: string): string[] {
  const dates = new Set<string>();
  const blocks = ics.split(/BEGIN:VEVENT/gi).slice(1);
  for (const block of blocks) {
    const dateMatch = block.match(
      /DTSTART(?:;[^:\r\n]*)?:(\d{4})(\d{2})(\d{2})/
    );
    if (!dateMatch) continue;
    dates.add(`${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}`);
  }
  return [...dates].sort();
}

async function fetchUsHolidayDatesFromIcs(): Promise<string[]> {
  const response = await fetch(US_HOLIDAY_ICS_URL, {
    cache: "no-store",
    headers: { Accept: "text/calendar" },
  });
  if (!response.ok) {
    throw new Error(`Holiday calendar fetch failed (${response.status})`);
  }
  const ics = await response.text();
  return parseUsHolidayIcs(ics);
}

/** Sync read — uses in-memory cache, then SQLite. May be empty until refresh runs. */
export function getWorkspaceHolidayDatesSync(): ReadonlySet<string> {
  if (memoryDates) return memoryDates;
  memoryDates = loadWorkspaceHolidayDatesFromCache(US_HOLIDAY_CALENDAR_ID);
  return memoryDates;
}

/** Refresh US holiday dates when stale; safe to call from API routes. */
export async function refreshWorkspaceHolidayCache(
  options: { force?: boolean } = {}
): Promise<ReadonlySet<string>> {
  if (
    !options.force &&
    workspaceHolidayCacheIsFresh(US_HOLIDAY_CALENDAR_ID) &&
    getWorkspaceHolidayDatesSync().size > 0
  ) {
    return getWorkspaceHolidayDatesSync();
  }

  if (refreshPromise) return refreshPromise;

  refreshPromise = (async () => {
    try {
      const dates = await fetchUsHolidayDatesFromIcs();
      if (dates.length > 0) {
        saveWorkspaceHolidayDatesToCache(dates, US_HOLIDAY_CALENDAR_ID);
        memoryDates = new Set(dates);
        return memoryDates;
      }
    } catch {
      // Keep serving the last cached dates when refresh fails.
    }
    return getWorkspaceHolidayDatesSync();
  })().finally(() => {
    refreshPromise = null;
  });

  return refreshPromise;
}

export function withWorkspaceHolidays<T extends { holidayDates?: ReadonlySet<string> }>(
  config: T
): T {
  const holidays = getWorkspaceHolidayDatesSync();
  if (!holidays.size) return config;
  return { ...config, holidayDates: holidays };
}
