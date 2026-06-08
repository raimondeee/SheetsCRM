import { google } from "googleapis";
import type { SheetConfig, Ticket } from "./types";
import {
  analyzeHeaders,
  getCellValue,
  getCellValueByRole,
  getColumnByRole,
  normalizeSheetConfig,
} from "./column-mapper";
import {
  buildDefaultSheetConfig,
  EXAMPLE_COLUMN_POSITIONS,
  EXAMPLE_SHEET_GID,
} from "./default-sheet-config";
import { appendAdminNoteToText } from "./admin-notes";
import { getGoogleAuthClient, hasActiveGoogleAuth } from "./google-auth";
import { mergeOverlayOntoTicket } from "./overlay-db";

export async function fetchSheetHeaders(
  spreadsheetId: string,
  sheetName?: string,
  gid?: string
): Promise<{ headers: string[]; sheetName: string }> {
  const auth = await getGoogleAuthClient();
  if (!auth) throw new Error("Sign in with Google or configure a service account");

  const sheets = google.sheets({ version: "v4", auth });
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const targetSheet =
    meta.data.sheets?.find(
      (s) =>
        (gid && String(s.properties?.sheetId) === gid) ||
        (sheetName && s.properties?.title === sheetName)
    ) ?? meta.data.sheets?.[0];

  const title = targetSheet?.properties?.title ?? "Sheet1";
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${title}'!1:1`,
  });

  return { headers: (res.data.values?.[0] ?? []) as string[], sheetName: title };
}

export async function fetchTicketsFromSheet(config: SheetConfig): Promise<Ticket[]> {
  const auth = await getGoogleAuthClient();
  if (!auth) throw new Error("Sign in with Google or configure a service account");

  const sheets = google.sheets({ version: "v4", auth });
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: config.spreadsheetId,
    range: `'${config.sheetName}'!A:ZZ`,
  });

  const rows = res.data.values ?? [];
  if (rows.length <= config.headerRow) return [];

  const dataRows = rows.slice(config.headerRow);
  const tickets: Ticket[] = [];

  const rowKeyCol = getColumnByRole(config, "rowKey") ?? { index: 0, letter: "A", header: "A", role: "rowKey" as const };

  for (let i = 0; i < dataRows.length; i++) {
    const row = dataRows[i] as string[];
    if (!getCellValue(row, rowKeyCol).trim()) continue;

    const rowNumber = config.headerRow + i + 1;
    const rowId = `${config.spreadsheetId}:${config.sheetName}:${rowNumber}`;

    const raw: Record<string, string> = {};
    config.columns.forEach((col) => {
      raw[col.header || col.letter] = getCellValue(row, col);
    });

    const ticket: Ticket = {
      rowId,
      rowNumber,
      spreadsheetId: config.spreadsheetId,
      sheetName: config.sheetName,
      timestamp: getCellValue(row, getColumnByRole(config, "timestamp")),
      requesterEmail: getCellValue(row, getColumnByRole(config, "email")),
      requesterName: getCellValue(row, getColumnByRole(config, "name")),
      subject: getCellValue(row, getColumnByRole(config, "subject")),
      description: getCellValue(row, getColumnByRole(config, "description")),
      contactReason: getCellValue(row, getColumnByRole(config, "contactReason")),
      marketManager: getCellValueByRole(row, config, "marketManager"),
      sheetStatus: getCellValue(row, getColumnByRole(config, "status")),
      sheetCaseSummary: getCellValue(row, getColumnByRole(config, "caseSummary")),
      adminNotes: "",
      airbnbUserId: getCellValue(row, getColumnByRole(config, "airbnbUserId")),
      status: "new",
      internalTools: {
        k: getCellValue(row, getColumnByRole(config, "internalToolK")),
        m: getCellValue(row, getColumnByRole(config, "internalToolM")),
        r: getCellValue(row, getColumnByRole(config, "internalToolR")),
      },
      slaHours: 24,
      slaDueAt: null,
      slaBreached: false,
      lastResponseAt: null,
      raw,
    };

    tickets.push(mergeOverlayOntoTicket(ticket));
  }

  return tickets.reverse();
}

export async function analyzeAndBuildConfig(
  sheetUrl: string,
  spreadsheetId: string,
  gid?: string
): Promise<SheetConfig> {
  let headers: string[] = [];
  let sheetName = "Form Responses";

  try {
    const result = await fetchSheetHeaders(spreadsheetId, sheetName, gid ?? EXAMPLE_SHEET_GID);
    headers = result.headers;
    sheetName = result.sheetName;
  } catch {
    // Fall back to position-based config
  }

  const columns = headers.length > 0 ? analyzeHeaders(headers) : buildDefaultSheetConfig().columns;
  const now = new Date().toISOString();

  return {
    id: "default",
    sheetUrl,
    spreadsheetId,
    sheetName,
    headerRow: 1,
    columns,
    createdAt: now,
    updatedAt: now,
  };
}

export async function hasGoogleCredentials(): Promise<boolean> {
  return hasActiveGoogleAuth();
}

/** Appends a bullet note to Column U (Case Summary). Returns the updated cell text. */
export async function appendAdminNoteOnSheet(
  config: SheetConfig,
  rowNumber: number,
  noteText: string
): Promise<string> {
  const auth = await getGoogleAuthClient();
  if (!auth) throw new Error("Sign in with Google to update the sheet");

  const col = getColumnByRole(config, "caseSummary");
  const letter = col?.letter ?? EXAMPLE_COLUMN_POSITIONS.caseSummary.letter;
  const range = `'${config.sheetName}'!${letter}${rowNumber}`;

  const sheets = google.sheets({ version: "v4", auth });
  const current = await sheets.spreadsheets.values.get({
    spreadsheetId: config.spreadsheetId,
    range,
  });
  const existing = (current.data.values?.[0]?.[0] ?? "").toString();
  const updated = appendAdminNoteToText(existing, noteText);

  await sheets.spreadsheets.values.update({
    spreadsheetId: config.spreadsheetId,
    range,
    valueInputOption: "RAW",
    requestBody: { values: [[updated]] },
  });

  return updated;
}

/** Writes Airbnb User ID to Column AD. */
export async function updateAirbnbUserIdOnSheet(
  config: SheetConfig,
  rowNumber: number,
  value: string
): Promise<void> {
  const auth = await getGoogleAuthClient();
  if (!auth) throw new Error("Sign in with Google to update the sheet");

  const col = getColumnByRole(config, "airbnbUserId");
  const letter = col?.letter ?? EXAMPLE_COLUMN_POSITIONS.airbnbUserId.letter;
  const range = `'${config.sheetName}'!${letter}${rowNumber}`;

  const sheets = google.sheets({ version: "v4", auth });
  await sheets.spreadsheets.values.update({
    spreadsheetId: config.spreadsheetId,
    range,
    valueInputOption: "RAW",
    requestBody: { values: [[value]] },
  });
}
