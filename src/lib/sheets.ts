import { google } from "googleapis";
import type { SheetConfig, Ticket } from "./types";
import {
  analyzeHeaders,
  getAirbnbUserIdColumn,
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
import { buildUiFieldValues } from "./ui-field-slots";
import { DEFAULT_TIMER_SETTINGS, type TimerSettings } from "./timer-settings";
import type { ColumnMapping } from "./types";
import { withOpsMetric } from "./ops-metrics";

function rowQualifiesAsTicket(
  row: string[],
  config: SheetConfig,
  rowKeyCol: ColumnMapping
): boolean {
  if (getCellValue(row, rowKeyCol).trim()) return true;

  const timestampCol =
    getColumnByRole(config, "timestamp") ??
    config.columns.find((c) => c.index === 0);
  if (timestampCol && getCellValue(row, timestampCol).trim()) return true;

  const emailCol = getColumnByRole(config, "email");
  if (emailCol && getCellValue(row, emailCol).trim()) return true;

  const descriptionCol = getColumnByRole(config, "description");
  if (descriptionCol && getCellValue(row, descriptionCol).trim()) return true;

  const subjectCol = getColumnByRole(config, "subject");
  if (subjectCol && getCellValue(row, subjectCol).trim()) return true;

  return false;
}

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
  const meta = await withOpsMetric("sheets", "spreadsheets.get", () =>
    sheets.spreadsheets.get({ spreadsheetId })
  );
  const targetSheet =
    meta.data.sheets?.find(
      (s) =>
        (gid && String(s.properties?.sheetId) === gid) ||
        (sheetName && s.properties?.title === sheetName)
    ) ?? meta.data.sheets?.[0];

  const title = targetSheet?.properties?.title ?? "Sheet1";
  const res = await withOpsMetric("sheets", "values.get", () =>
    sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `'${title}'!1:1`,
    })
  );

  return { headers: (res.data.values?.[0] ?? []) as string[], sheetName: title };
}

export async function fetchTicketsFromSheet(
  config: SheetConfig,
  timerSettings: TimerSettings = DEFAULT_TIMER_SETTINGS
): Promise<Ticket[]> {
  const auth = await getGoogleAuthClient();
  if (!auth) throw new Error("Sign in with Google or configure a service account");

  const sheets = google.sheets({ version: "v4", auth });
  const res = await withOpsMetric("sheets", "values.get", () =>
    sheets.spreadsheets.values.get({
      spreadsheetId: config.spreadsheetId,
      range: `'${config.sheetName}'!A:ZZ`,
    })
  );

  const rows = res.data.values ?? [];
  if (rows.length <= config.headerRow) return [];

  const dataRows = rows.slice(config.headerRow);
  const tickets: Ticket[] = [];

  const rowKeyCol = getColumnByRole(config, "rowKey") ?? {
    index: 0,
    letter: "A",
    header: "A",
    role: "rowKey" as const,
  };

  for (let i = 0; i < dataRows.length; i++) {
    const row = dataRows[i] as string[];
    if (!rowQualifiesAsTicket(row, config, rowKeyCol)) continue;

    const rowNumber = config.headerRow + i + 1;
    const rowId = `${config.spreadsheetId}:${config.sheetName}:${rowNumber}`;

    const raw: Record<string, string> = {};
    config.columns.forEach((col) => {
      raw[col.header || col.letter] = getCellValue(row, col);
    });

    const uiFields = buildUiFieldValues(config, row);
    const legacyHeader = getCellValue(row, getColumnByRole(config, "ticketHeaderField"));
    const headerField = uiFields["ui-1"] ?? legacyHeader ?? uiFields["legacy-header"] ?? "";

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
      headerField,
      uiFields,
      subject: getCellValue(row, getColumnByRole(config, "subject")),
      crmSubjectLabel: "",
      description: getCellValue(row, getColumnByRole(config, "description")),
      contactReason: getCellValue(row, getColumnByRole(config, "contactReason")),
      marketManager: getCellValueByRole(row, config, "marketManager"),
      sheetStatus: getCellValue(row, getColumnByRole(config, "status")),
      sheetCaseSummary: getCellValue(row, getColumnByRole(config, "caseSummary")),
      adminNotes: "",
      airbnbUserId: getCellValue(row, getAirbnbUserIdColumn(config)),
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
      statusChangedAt: null,
      pendingReopenHours: null,
      gmailOpenUrl: null,
      gmailLinkArchivedAt: null,
      linkedCases: ["", "", ""],
      internalTools: {
        k: getCellValue(row, getColumnByRole(config, "internalToolK")),
        m: getCellValue(row, getColumnByRole(config, "internalToolM")),
        r: getCellValue(row, getColumnByRole(config, "internalToolR")),
      },
      slaHours: timerSettings.defaultSlaHours,
      slaDueAt: null,
      slaBreached: false,
      lastResponseAt: null,
      needsInitialResponse: false,
      raw,
    };

    const sheetAirbnbUserId = ticket.airbnbUserId;
    tickets.push(mergeOverlayOntoTicket(ticket, sheetAirbnbUserId, timerSettings));
  }

  const merged = tickets.reverse();
  void backfillAirbnbUserIdsFromColumnD(config, merged).catch(() => {
    /* background backfill — must not block ticket list load */
  });
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
  const col = getAirbnbUserIdColumn(config);
  return col.header || col.letter || "Column AD";
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

/** Writes full case summary text to Column U (no read). */
export async function writeCaseSummaryOnSheet(
  config: SheetConfig,
  rowNumber: number,
  fullText: string
): Promise<void> {
  const auth = await getGoogleAuthClient();
  if (!auth) throw new Error("Sign in with Google to update the sheet");

  const col = getColumnByRole(config, "caseSummary");
  const letter = col?.letter ?? EXAMPLE_COLUMN_POSITIONS.caseSummary.letter;
  const range = `'${config.sheetName}'!${letter}${rowNumber}`;

  const sheets = google.sheets({ version: "v4", auth });
  await withOpsMetric("sheets", "values.update", () =>
    sheets.spreadsheets.values.update({
      spreadsheetId: config.spreadsheetId,
      range,
      valueInputOption: "RAW",
      requestBody: { values: [[fullText]] },
    })
  );
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
  const current = await withOpsMetric("sheets", "values.get", () =>
    sheets.spreadsheets.values.get({
      spreadsheetId: config.spreadsheetId,
      range,
    })
  );
  const existing = (current.data.values?.[0]?.[0] ?? "").toString();
  const updated = appendAdminNoteToText(existing, noteText);

  await writeCaseSummaryOnSheet(config, rowNumber, updated);
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
  await withOpsMetric("sheets", "values.update", () =>
    sheets.spreadsheets.values.update({
      spreadsheetId: config.spreadsheetId,
      range,
      valueInputOption: "RAW",
      requestBody: { values: [[statusValue]] },
    })
  );
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
  await withOpsMetric("sheets", "values.update", () =>
    sheets.spreadsheets.values.update({
      spreadsheetId: config.spreadsheetId,
      range,
      valueInputOption: "RAW",
      requestBody: { values: [[value]] },
    })
  );
}

async function updateSheetCellByRole(
  config: SheetConfig,
  rowNumber: number,
  role: "reservationCode" | "listingId" | "airbnbUserId" | "userEmailed" | "ticketHeaderField",
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
          : role === "ticketHeaderField"
            ? null
            : EXAMPLE_COLUMN_POSITIONS.airbnbUserId;
  const col =
    role === "airbnbUserId" ? getAirbnbUserIdColumn(config) : getColumnByRole(config, role);
  const letter = col?.letter ?? fallback?.letter;
  if (!letter) {
    throw new Error(`No sheet column mapped for ${role}`);
  }
  const range = `'${config.sheetName}'!${letter}${rowNumber}`;

  const sheets = google.sheets({ version: "v4", auth });
  await withOpsMetric("sheets", "values.update", () =>
    sheets.spreadsheets.values.update({
      spreadsheetId: config.spreadsheetId,
      range,
      valueInputOption: "RAW",
      requestBody: { values: [[value]] },
    })
  );
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

/** Writes any sheet column by 0-based index. */
export async function updateSheetCellByIndex(
  config: SheetConfig,
  rowNumber: number,
  columnIndex: number,
  value: string
): Promise<void> {
  const auth = await getGoogleAuthClient();
  if (!auth) throw new Error("Sign in with Google to update the sheet");

  const col = config.columns.find((c) => c.index === columnIndex);
  if (!col?.letter) {
    throw new Error(`No sheet column at index ${columnIndex}`);
  }
  const range = `'${config.sheetName}'!${col.letter}${rowNumber}`;

  const sheets = google.sheets({ version: "v4", auth });
  await withOpsMetric("sheets", "values.update", () =>
    sheets.spreadsheets.values.update({
      spreadsheetId: config.spreadsheetId,
      range,
      valueInputOption: "RAW",
      requestBody: { values: [[value]] },
    })
  );
}

/** Writes ticket header field (mapped column under subject in CRM). */
export async function updateTicketHeaderFieldOnSheet(
  config: SheetConfig,
  rowNumber: number,
  value: string
): Promise<void> {
  await updateSheetCellByRole(config, rowNumber, "ticketHeaderField", value);
}

/** Writes a UI field slot value to its mapped sheet column. */
export async function updateUiFieldOnSheet(
  config: SheetConfig,
  rowNumber: number,
  columnIndex: number,
  value: string
): Promise<void> {
  await updateSheetCellByIndex(config, rowNumber, columnIndex, value);
}

/** Marks the user-emailed column (default Column L) as Yes after a CRM outbound send. */
export async function markUserEmailedOnSheet(
  config: SheetConfig,
  rowNumber: number
): Promise<void> {
  await updateSheetCellByRole(config, rowNumber, "userEmailed", "Yes");
}
