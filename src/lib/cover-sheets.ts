import type { CoverSheetEntry, SheetConfig } from "./types";
import { parseTicketRowId } from "./types";
import { prepareSheetConfig } from "./ui-field-slots";

export const MAX_COVER_SHEETS = 10;
export const COVER_SHEETS_STORE_ID = "cover_sheets";

export function coverSheetSlotId(index: number): string {
  return `cover-${index + 1}`;
}

export function createDefaultCoverSheetEntries(): CoverSheetEntry[] {
  return Array.from({ length: MAX_COVER_SHEETS }, (_, index) => ({
    id: coverSheetSlotId(index),
    label: "",
    enabled: false,
    config: null,
  }));
}

export function normalizeCoverSheetEntry(entry: CoverSheetEntry): CoverSheetEntry {
  return {
    id: entry.id,
    label: entry.label?.trim() ?? "",
    enabled: Boolean(entry.enabled),
    config: entry.config ? prepareSheetConfig({ ...entry.config, id: entry.id }) : null,
  };
}

export function normalizeCoverSheetEntries(
  entries: CoverSheetEntry[] | null | undefined
): CoverSheetEntry[] {
  const defaults = createDefaultCoverSheetEntries();
  if (!entries?.length) return defaults;

  const byId = new Map(entries.map((entry) => [entry.id, normalizeCoverSheetEntry(entry)]));
  return defaults.map((slot) => byId.get(slot.id) ?? slot);
}

export function listEnabledCoverSheetEntries(entries: CoverSheetEntry[]): CoverSheetEntry[] {
  return entries.filter((entry) => entry.enabled && entry.config?.spreadsheetId);
}

export function resolveSheetConfigForTicket(
  rowId: string,
  defaultConfig: SheetConfig | null,
  coverSheets: CoverSheetEntry[]
): SheetConfig | null {
  const parsed = parseTicketRowId(rowId);
  if (!parsed) return defaultConfig;

  if (
    defaultConfig &&
    defaultConfig.spreadsheetId === parsed.spreadsheetId &&
    defaultConfig.sheetName === parsed.sheetName
  ) {
    return defaultConfig;
  }

  for (const entry of listEnabledCoverSheetEntries(coverSheets)) {
    const config = entry.config;
    if (!config) continue;
    if (
      config.spreadsheetId === parsed.spreadsheetId &&
      config.sheetName === parsed.sheetName
    ) {
      return config;
    }
  }

  return defaultConfig;
}

export function coverSourceLabelForEntry(entry: CoverSheetEntry): string {
  const label = entry.label.trim();
  if (label) return label;
  return entry.config?.sheetName?.trim() || "Teammate sheet";
}

export function isCoverSheetTicketRow(
  rowId: string,
  defaultConfig: SheetConfig | null,
  coverSheets: CoverSheetEntry[]
): boolean {
  const resolved = resolveSheetConfigForTicket(rowId, defaultConfig, coverSheets);
  return Boolean(resolved && resolved.id !== "default");
}

export function coverSourceLabelForTicketRow(
  rowId: string,
  coverSheets: CoverSheetEntry[]
): string | null {
  const parsed = parseTicketRowId(rowId);
  if (!parsed) return null;
  for (const entry of listEnabledCoverSheetEntries(coverSheets)) {
    const config = entry.config;
    if (!config) continue;
    if (
      config.spreadsheetId === parsed.spreadsheetId &&
      config.sheetName === parsed.sheetName
    ) {
      return coverSourceLabelForEntry(entry);
    }
  }
  return null;
}
