import { google, sheets_v4 } from "googleapis";
import { getGoogleAuthClient } from "./google-auth";
import { withOpsMetric } from "./ops-metrics";

export const DISPUTES_SHEET_GID = "944501213";
export const DISPUTES_SHEET_NAME = "2026 Review Disputes";
export const APPEALS_SHEET_GID = "501815567";
export const APPEALS_SHEET_NAME = "Appeals NEW";

/** Reuse tab payloads briefly — dashboard period filters are client-side. */
const TAB_CACHE_TTL_MS = 3 * 60 * 1000;
const META_CACHE_TTL_MS = 5 * 60 * 1000;

export interface SheetTabData {
  sheetName: string;
  headers: string[];
  rows: string[][];
  headerRowIndex?: number;
}

export interface SheetTabRequest {
  key: string;
  sheetName?: string;
  gid?: string;
}

interface TabCacheEntry {
  expiresAt: number;
  data: SheetTabData;
}

interface MetaCacheEntry {
  expiresAt: number;
  meta: sheets_v4.Schema$Spreadsheet;
}

const tabCache = new Map<string, TabCacheEntry>();
const metaCache = new Map<string, MetaCacheEntry>();

function tabCacheKey(spreadsheetId: string, key: string): string {
  return `${spreadsheetId}:${key}`;
}

function a1SheetRange(title: string): string {
  const escaped = title.replace(/'/g, "''");
  return `'${escaped}'!A:ZZ`;
}

function looksLikeHeaderRow(row: string[]): boolean {
  const trimmed = row.map((cell) => String(cell ?? "").trim());
  const nonEmpty = trimmed.filter(Boolean);
  if (nonEmpty.length < 2) return false;

  const first = (trimmed[0] ?? "").toLowerCase();
  if (/^timestamp$/.test(first) || /^date submitted$/.test(first)) return true;

  const joined = nonEmpty.join(" ").toLowerCase();
  if (/timestamp|date submitted|submission time/.test(joined)) return true;
  return (
    /email/.test(joined) &&
    /(status|team|reason|reservation|host|listing|appeal|coordinator|decision)/.test(joined)
  );
}

function detectHeaderRowIndex(values: string[][]): number {
  const limit = Math.min(values.length, 30);
  for (let i = 0; i < limit; i += 1) {
    if (looksLikeHeaderRow(values[i] ?? [])) return i;
  }
  return 0;
}

function normalizeSheetRows(values: string[][], headerRowIndex: number): SheetTabData["rows"] {
  const headers = values[headerRowIndex] ?? [];
  const headerCount = headers.length;
  return values
    .slice(headerRowIndex + 1)
    .map((row) => {
      const normalized = [...row];
      while (normalized.length < headerCount) normalized.push("");
      return normalized.map((cell) => String(cell ?? "").trim());
    })
    .filter((row) => row.some((cell) => cell.length > 0));
}

function parseSheetTabValues(title: string, values: string[][]): SheetTabData {
  if (values.length === 0) {
    return { sheetName: title, headers: [], rows: [], headerRowIndex: 0 };
  }

  const headerRowIndex = detectHeaderRowIndex(values);
  const headers = (values[headerRowIndex] ?? []).map((h) => String(h ?? "").trim());
  const rows = normalizeSheetRows(values, headerRowIndex);

  return { sheetName: title, headers, rows, headerRowIndex };
}

function resolveSheetTitle(
  meta: sheets_v4.Schema$Spreadsheet,
  options: { sheetName?: string; gid?: string }
): string | null {
  const targetSheet =
    meta.sheets?.find(
      (sheet) =>
        (options.gid && String(sheet.properties?.sheetId) === options.gid) ||
        (options.sheetName && sheet.properties?.title === options.sheetName)
    ) ?? null;

  return targetSheet?.properties?.title ?? null;
}

async function getSpreadsheetMeta(
  spreadsheetId: string,
  sheets: sheets_v4.Sheets
): Promise<sheets_v4.Schema$Spreadsheet> {
  const cached = metaCache.get(spreadsheetId);
  if (cached && cached.expiresAt > Date.now()) return cached.meta;

  const res = await withOpsMetric("sheets", "spreadsheets.get", () =>
    sheets.spreadsheets.get({ spreadsheetId })
  );
  const meta = res.data;
  metaCache.set(spreadsheetId, { expiresAt: Date.now() + META_CACHE_TTL_MS, meta });
  return meta;
}

/** List tab titles (and gids) for companion-sheet discovery. */
export async function listSpreadsheetSheetTitles(
  spreadsheetId: string
): Promise<Array<{ title: string; gid: string }>> {
  const auth = await getGoogleAuthClient();
  if (!auth) throw new Error("Sign in with Google or configure a service account");
  const sheets = google.sheets({ version: "v4", auth });
  const meta = await getSpreadsheetMeta(spreadsheetId, sheets);
  const out: Array<{ title: string; gid: string }> = [];
  for (const sheet of meta.sheets ?? []) {
    const title = sheet.properties?.title?.trim();
    const gid = sheet.properties?.sheetId;
    if (!title || gid == null) continue;
    out.push({ title, gid: String(gid) });
  }
  return out;
}

function readCachedTab(spreadsheetId: string, key: string): SheetTabData | null {
  const cached = tabCache.get(tabCacheKey(spreadsheetId, key));
  if (!cached || cached.expiresAt <= Date.now()) return null;
  return cached.data;
}

function writeCachedTab(spreadsheetId: string, key: string, data: SheetTabData): void {
  tabCache.set(tabCacheKey(spreadsheetId, key), {
    expiresAt: Date.now() + TAB_CACHE_TTL_MS,
    data,
  });
}

/** Fetch multiple tabs in one metadata read + one batch values read. */
export async function fetchSheetTabsBatch(
  spreadsheetId: string,
  requests: SheetTabRequest[]
): Promise<Map<string, SheetTabData>> {
  const result = new Map<string, SheetTabData>();
  const uncached: SheetTabRequest[] = [];

  for (const request of requests) {
    const hit = readCachedTab(spreadsheetId, request.key);
    if (hit) {
      result.set(request.key, hit);
    } else {
      uncached.push(request);
    }
  }

  if (uncached.length === 0) return result;

  const auth = await getGoogleAuthClient();
  if (!auth) throw new Error("Sign in with Google or configure a service account");

  const sheets = google.sheets({ version: "v4", auth });
  const meta = await getSpreadsheetMeta(spreadsheetId, sheets);

  const resolved = uncached.map((request) => {
    const title = resolveSheetTitle(meta, request);
    if (!title) {
      throw new Error(`Sheet tab not found: ${request.sheetName ?? request.gid ?? request.key}`);
    }
    return { request, title, range: a1SheetRange(title) };
  });

  const batch = await withOpsMetric("sheets", "values.batchGet", () =>
    sheets.spreadsheets.values.batchGet({
      spreadsheetId,
      ranges: resolved.map((entry) => entry.range),
    })
  );

  const valueRanges = batch.data.valueRanges ?? [];
  for (let i = 0; i < resolved.length; i += 1) {
    const { request, title } = resolved[i]!;
    const values = (valueRanges[i]?.values ?? []) as string[][];
    const tab = parseSheetTabValues(title, values);
    writeCachedTab(spreadsheetId, request.key, tab);
    result.set(request.key, tab);
  }

  return result;
}

export async function fetchSheetTabData(
  spreadsheetId: string,
  options: { sheetName?: string; gid?: string }
): Promise<SheetTabData> {
  const key = options.gid ?? options.sheetName ?? "default";
  const cached = readCachedTab(spreadsheetId, key);
  if (cached) return cached;

  const tabs = await fetchSheetTabsBatch(spreadsheetId, [{ key, ...options }]);
  const tab = tabs.get(key);
  if (!tab) {
    throw new Error(`Sheet tab not found: ${options.sheetName ?? options.gid ?? "unknown"}`);
  }
  return tab;
}
