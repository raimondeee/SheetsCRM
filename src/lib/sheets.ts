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
import {
  shouldBackfillAirbnbUserIdFromColumnD,
} from "./airbnb-user-id";
import { isNumericUserId } from "./become-user-url";
import {
  getTicketOverlay,
  markAirbnbUserIdFromColumnD,
  mergeOverlayOntoTicket,
} from "./overlay-db";

function getCellWithColumnFallback(
  row: string[],
  config: SheetConfig,
  role: import("./types").ColumnRole,
  fallback: { letter: string; index: number }
): string {
  const mapped = getCellValue(row, getColumnByRole(config, role));
  if (mapped) return mapped;
  return getCellValue(row, {
    index: fallback.index,
    letter: fallback.letter,
    header: fallback.letter,
    role,
  });
}

function getFixedColumnValue(
  row: string[],
  fallback: { letter: string; index: number }
): string {
  return getCellValue(row, {
    index: fallback.index,
    letter: fallback.letter,
    header: fallback.letter,
    role: "unknown",
  });
}

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
      timestamp: getCellWithColumnFallback(
        row,
        config,
        "timestamp",
        EXAMPLE_COLUMN_POSITIONS.rowKey
      ),
      requesterEmail: getCellValue(row, getColumnByRole(config, "email")),
      columnD: getFixedColumnValue(row, EXAMPLE_COLUMN_POSITIONS.email),
      requesterName: getCellValue(row, getColumnByRole(config, "name")),
      subject: getCellValue(row, getColumnByRole(config, "subject")),
      description: getCellValue(row, getColumnByRole(config, "description")),
      contactReason: getCellValue(row, getColumnByRole(config, "contactReason")),
      marketManager: getCellValueByRole(row, config, "marketManager"),
      sheetStatus: getCellValue(row, getColumnByRole(config, "status")),
      sheetCaseSummary: getCellValue(row, getColumnByRole(config, "caseSummary")),
      adminNotes: "",
      airbnbUserId: getCellValue(row, getColumnByRole(config, "airbnbUserId")),
      reservationCode: getCellWithColumnFallback(
        row,
        config,
        "reservationCode",
        EXAMPLE_COLUMN_POSITIONS.reservationCode
      ),
      listingId: getCellWithColumnFallback(
        row,
        config,
        "listingId",
        EXAMPLE_COLUMN_POSITIONS.listingId
      ),
      status: "new",
      internalTools: {
        k: getCellValue(row, getColumnByRole(config, "internalToolK")),
        m: getCellValue(row, getColumnByRole(config, "internalToolM")),
        r: getCellValue(row, getColumnByRole(config, "internalToolR")),
      },
      slaHours: 48,
      slaDueAt: null,
      slaBreached: false,
      lastResponseAt: null,
      needsInitialResponse: false,
      raw,
    };

    const sheetAirbnbUserId = ticket.airbnbUserId;
    tickets.push(mergeOverlayOntoTicket(ticket, sheetAirbnbUserId));
  }

  const merged = tickets.reverse();
  await backfillAirbnbUserIdsFromColumnD(config, merged);
  return merged;
}

async function backfillAirbnbUserIdsFromColumnD(
  config: SheetConfig,
  tickets: Ticket[]
): Promise<void> {
  for (const ticket of tickets) {
    const overlay = getTicketOverlay(ticket.rowId);
    if (
      !shouldBackfillAirbnbUserIdFromColumnD(
        ticket.raw[getAirbnbUserIdRawKey(ticket, config)] ?? "",
        ticket.columnD,
        overlay
      )
    ) {
      continue;
    }

    const userId = ticket.columnD.trim();
    if (!isNumericUserId(userId)) continue;

    try {
      await updateAirbnbUserIdOnSheet(config, ticket.rowNumber, userId);
      markAirbnbUserIdFromColumnD(ticket.rowId, userId);
      ticket.airbnbUserId = userId;
    } catch {
      ticket.airbnbUserId = userId;
    }
  }
}

function getAirbnbUserIdRawKey(ticket: Ticket, config: SheetConfig): string {
  const col = getColumnByRole(config, "airbnbUserId");
  return col?.header || col?.letter || "Column AD";
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

/** Writes CRM status to Column N (or mapped status column). */
export async function updateSheetStatusOnSheet(
  config: SheetConfig,
  rowNumber: number,
  statusValue: string
): Promise<void> {
  const auth = await getGoogleAuthClient();
  if (!auth) throw new Error("Sign in with Google to update the sheet");

  const col = getColumnByRole(config, "status");
  const letter = col?.letter ?? EXAMPLE_COLUMN_POSITIONS.status.letter;
  const range = `'${config.sheetName}'!${letter}${rowNumber}`;

  const sheets = google.sheets({ version: "v4", auth });
  await sheets.spreadsheets.values.update({
    spreadsheetId: config.spreadsheetId,
    range,
    valueInputOption: "RAW",
    requestBody: { values: [[statusValue]] },
  });
}

/** Writes contact reason to Column I (or mapped contact reason column). */
export async function updateContactReasonOnSheet(
  config: SheetConfig,
  rowNumber: number,
  value: string
): Promise<void> {
  const auth = await getGoogleAuthClient();
  if (!auth) throw new Error("Sign in with Google to update the sheet");

  const col = getColumnByRole(config, "contactReason");
  const letter = col?.letter ?? EXAMPLE_COLUMN_POSITIONS.contactReason.letter;
  const range = `'${config.sheetName}'!${letter}${rowNumber}`;

  const sheets = google.sheets({ version: "v4", auth });
  await sheets.spreadsheets.values.update({
    spreadsheetId: config.spreadsheetId,
    range,
    valueInputOption: "RAW",
    requestBody: { values: [[value]] },
  });
}

async function updateSheetCellByRole(
  config: SheetConfig,
  rowNumber: number,
  role: "reservationCode" | "listingId" | "airbnbUserId" | "userEmailed",
  value: string
): Promise<void> {
  const auth = await getGoogleAuthClient();
  if (!auth) throw new Error("Sign in with Google to update the sheet");

  const fallback =
    role === "reservationCode"
      ? EXAMPLE_COLUMN_POSITIONS.reservationCode
      : role === "listingId"
        ? EXAMPLE_COLUMN_POSITIONS.listingId
        : role === "userEmailed"
          ? EXAMPLE_COLUMN_POSITIONS.userEmailed
          : EXAMPLE_COLUMN_POSITIONS.airbnbUserId;
  const col = getColumnByRole(config, role);
  const letter = col?.letter ?? fallback.letter;
  const range = `'${config.sheetName}'!${letter}${rowNumber}`;

  const sheets = google.sheets({ version: "v4", auth });
  await sheets.spreadsheets.values.update({
    spreadsheetId: config.spreadsheetId,
    range,
    valueInputOption: "RAW",
    requestBody: { values: [[value]] },
  });
}

/** Writes reservation code to Column E. */
export async function updateReservationCodeOnSheet(
  config: SheetConfig,
  rowNumber: number,
  value: string
): Promise<void> {
  await updateSheetCellByRole(config, rowNumber, "reservationCode", value);
}

/** Writes listing ID to Column F. */
export async function updateListingIdOnSheet(
  config: SheetConfig,
  rowNumber: number,
  value: string
): Promise<void> {
  await updateSheetCellByRole(config, rowNumber, "listingId", value);
}

/** Writes Airbnb User ID to Column AD. */
export async function updateAirbnbUserIdOnSheet(
  config: SheetConfig,
  rowNumber: number,
  value: string
): Promise<void> {
  await updateSheetCellByRole(config, rowNumber, "airbnbUserId", value);
}

/** Marks the user-emailed column (default Column L) as Yes after a CRM outbound send. */
export async function markUserEmailedOnSheet(
  config: SheetConfig,
  rowNumber: number
): Promise<void> {
  await updateSheetCellByRole(config, rowNumber, "userEmailed", "Yes");
}
