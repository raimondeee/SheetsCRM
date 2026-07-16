import { google } from "googleapis";
import type { SheetConfig, Ticket } from "./types";
import {
  analyzeHeaders,
  getCellValue,
  getCellValueByRole,
  getColumnByRole,
  requireColumnByRole,
} from "./column-mapper";
import {
  buildDefaultSheetConfig,
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

function defaultRowKeyColumn(config: SheetConfig): ColumnMapping {
  return (
    getColumnByRole(config, "rowKey") ??
    getColumnByRole(config, "timestamp") ?? {
      index: 0,
      letter: "A",
      header: "A",
      role: "rowKey" as const,
    }
  );
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

  const rowKeyCol = defaultRowKeyColumn(config);

  for (let i = 0; i < dataRows.length; i++) {
    const row = dataRows[i] as string[];
    const ticket = buildTicketFromSheetRow(row, i, config, timerSettings, rowKeyCol);
    if (!ticket) continue;
    const sheetAirbnbUserId = ticket.airbnbUserId;
    tickets.push(mergeOverlayOntoTicket(ticket, sheetAirbnbUserId, timerSettings));
  }

  const merged = tickets.reverse();
  void backfillAirbnbUserIdsFromColumnD(config, merged).catch(() => {
    /* background backfill — must not block ticket list load */
  });
  return merged;
}

function buildTicketFromSheetRow(
  row: string[],
  dataRowIndex: number,
  config: SheetConfig,
  timerSettings: TimerSettings,
  rowKeyCol: ColumnMapping,
  options?: { coverSourceLabel?: string | null }
): Ticket | null {
  if (!rowQualifiesAsTicket(row, config, rowKeyCol)) return null;

  const rowNumber = config.headerRow + dataRowIndex + 1;
  const rowId = `${config.spreadsheetId}:${config.sheetName}:${rowNumber}`;

  const raw: Record<string, string> = {};
  config.columns.forEach((col) => {
    raw[col.header || col.letter] = getCellValue(row, col);
  });

  const uiFields = buildUiFieldValues(config, row);
  const legacyHeader = getCellValue(row, getColumnByRole(config, "ticketHeaderField"));
  const headerField = uiFields["ui-1"] ?? legacyHeader ?? uiFields["legacy-header"] ?? "";

  return {
    rowId,
    rowNumber,
    spreadsheetId: config.spreadsheetId,
    sheetName: config.sheetName,
    timestamp:
      getCellValueByRole(row, config, "timestamp") ||
      getCellValueByRole(row, config, "rowKey"),
    requesterEmail: getCellValueByRole(row, config, "email"),
    columnD: getCellValueByRole(row, config, "email"),
    requesterName: getCellValueByRole(row, config, "name"),
    headerField,
    uiFields,
    subject: getCellValueByRole(row, config, "subject"),
    crmSubjectLabel: "",
    description: getCellValueByRole(row, config, "description"),
    contactReason: getCellValueByRole(row, config, "contactReason"),
    marketManager: getCellValueByRole(row, config, "marketManager"),
    sheetStatus: getCellValueByRole(row, config, "status"),
    sheetCaseSummary: getCellValueByRole(row, config, "caseSummary"),
    adminNotes: "",
    airbnbUserId: getCellValueByRole(row, config, "airbnbUserId"),
    reservationCode: getCellValueByRole(row, config, "reservationCode"),
    claimNumber: getCellValueByRole(row, config, "claimNumber"),
    listingId: getCellValueByRole(row, config, "listingId"),
    status: "new",
    statusChangedAt: null,
    pendingReopenHours: null,
    gmailOpenUrl: null,
    gmailLinkArchivedAt: null,
    forceNewGmailThreadOnSend: false,
    linkedCases: ["", "", ""],
    internalTools: {
      k: getCellValueByRole(row, config, "internalToolK"),
      m: getCellValueByRole(row, config, "internalToolM"),
      r: getCellValueByRole(row, config, "internalToolR"),
    },
    slaHours: timerSettings.defaultSlaHours,
    slaDueAt: null,
    slaBreached: false,
    lastResponseAt: null,
    needsInitialResponse: false,
    coverSourceLabel: options?.coverSourceLabel ?? null,
    raw,
  };
}

export async function fetchTicketFromSheetRow(
  config: SheetConfig,
  rowNumber: number,
  timerSettings: TimerSettings = DEFAULT_TIMER_SETTINGS,
  options?: { coverSourceLabel?: string | null }
): Promise<Ticket | null> {
  const auth = await getGoogleAuthClient();
  if (!auth) throw new Error("Sign in with Google or configure a service account");

  const dataRowIndex = rowNumber - config.headerRow - 1;
  if (dataRowIndex < 0) return null;

  const sheets = google.sheets({ version: "v4", auth });
  const res = await withOpsMetric("sheets", "values.get", () =>
    sheets.spreadsheets.values.get({
      spreadsheetId: config.spreadsheetId,
      range: `'${config.sheetName}'!A${rowNumber}:ZZ${rowNumber}`,
    })
  );

  const row = (res.data.values?.[0] ?? []) as string[];
  const rowKeyCol = defaultRowKeyColumn(config);

  return buildTicketFromSheetRow(row, dataRowIndex, config, timerSettings, rowKeyCol, options);
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

function getAirbnbUserIdRawKey(_ticket: Ticket, config: SheetConfig): string {
  const col = getColumnByRole(config, "airbnbUserId");
  return col?.header || col?.letter || "Airbnb User ID";
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

/** Writes full case summary text to the mapped case summary column. */
export async function writeCaseSummaryOnSheet(
  config: SheetConfig,
  rowNumber: number,
  fullText: string
): Promise<void> {
  const auth = await getGoogleAuthClient();
  if (!auth) throw new Error("Sign in with Google to update the sheet");

  const col = requireColumnByRole(config, "caseSummary");
  const range = `'${config.sheetName}'!${col.letter}${rowNumber}`;

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

/** Appends a bullet note to the mapped case summary column. Returns the updated cell text. */
export async function appendAdminNoteOnSheet(
  config: SheetConfig,
  rowNumber: number,
  noteText: string
): Promise<string> {
  const auth = await getGoogleAuthClient();
  if (!auth) throw new Error("Sign in with Google to update the sheet");

  const col = requireColumnByRole(config, "caseSummary");
  const range = `'${config.sheetName}'!${col.letter}${rowNumber}`;

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

/** Writes CRM status to the mapped status column. */
export async function updateSheetStatusOnSheet(
  config: SheetConfig,
  rowNumber: number,
  statusValue: string
): Promise<void> {
  const auth = await getGoogleAuthClient();
  if (!auth) throw new Error("Sign in with Google to update the sheet");

  const col = requireColumnByRole(config, "status");
  const range = `'${config.sheetName}'!${col.letter}${rowNumber}`;

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

/** Writes contact reason to the mapped contact reason column. */
export async function updateContactReasonOnSheet(
  config: SheetConfig,
  rowNumber: number,
  value: string
): Promise<void> {
  const auth = await getGoogleAuthClient();
  if (!auth) throw new Error("Sign in with Google to update the sheet");

  const col = requireColumnByRole(config, "contactReason");
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

async function updateSheetCellByRole(
  config: SheetConfig,
  rowNumber: number,
  role:
    | "reservationCode"
    | "claimNumber"
    | "listingId"
    | "airbnbUserId"
    | "userEmailed"
    | "ticketHeaderField",
  value: string
): Promise<void> {
  const auth = await getGoogleAuthClient();
  if (!auth) throw new Error("Sign in with Google to update the sheet");

  const col = requireColumnByRole(config, role);
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

/** Writes reservation code to the mapped reservation code column. */
export async function updateReservationCodeOnSheet(
  config: SheetConfig,
  rowNumber: number,
  value: string
): Promise<void> {
  await updateSheetCellByRole(config, rowNumber, "reservationCode", value);
}

/** Writes claim number to the mapped claim number column. */
export async function updateClaimNumberOnSheet(
  config: SheetConfig,
  rowNumber: number,
  value: string
): Promise<void> {
  await updateSheetCellByRole(config, rowNumber, "claimNumber", value);
}

/** Writes listing ID to the mapped listing ID column. */
export async function updateListingIdOnSheet(
  config: SheetConfig,
  rowNumber: number,
  value: string
): Promise<void> {
  await updateSheetCellByRole(config, rowNumber, "listingId", value);
}

/** Writes Airbnb User ID to the mapped airbnbUserId column. */
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

/** Marks the mapped user-emailed column as Yes after a CRM outbound send. */
export async function markUserEmailedOnSheet(
  config: SheetConfig,
  rowNumber: number
): Promise<void> {
  await updateSheetCellByRole(config, rowNumber, "userEmailed", "Yes");
}
