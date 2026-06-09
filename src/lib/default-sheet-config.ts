import type { SheetConfig } from "./types";
import { indexToLetter } from "./types";

/** Example intake sheet shared by the team */
export const EXAMPLE_SPREADSHEET_ID = "1Kj8p-USf20vZREe-Cxg2c28vq4ppTwmgr05lYGxJebg";
export const EXAMPLE_SHEET_GID = "223304028";
export const EXAMPLE_SHEET_URL = `https://docs.google.com/spreadsheets/d/${EXAMPLE_SPREADSHEET_ID}/edit?gid=${EXAMPLE_SHEET_GID}`;

/**
 * Fixed column positions from the example sheet (1-based letters → 0-based index).
 * Headers are resolved at runtime via Sheets API or setup wizard.
 * K/M/R = internal tool access strings; N = sheet status.
 */
export const EXAMPLE_COLUMN_POSITIONS = {
  rowKey: { letter: "A", index: 0 },
  email: { letter: "D", index: 3 },
  reservationCode: { letter: "E", index: 4 },
  listingId: { letter: "F", index: 5 },
  marketManager: { letter: "H", index: 7 },
  contactReason: { letter: "I", index: 8 },
  userEmailed: { letter: "L", index: 11 },
  internalToolK: { letter: "K", index: 10 },
  internalToolM: { letter: "M", index: 12 },
  status: { letter: "N", index: 13 },
  internalToolR: { letter: "R", index: 17 },
  caseSummary: { letter: "U", index: 20 },
  airbnbUserId: { letter: "AD", index: 29 },
} as const;

export function buildDefaultSheetConfig(headers: string[] = []): SheetConfig {
  const now = new Date().toISOString();
  const getHeader = (index: number) => headers[index]?.trim() || `Column ${indexToLetter(index)}`;

  const roles = [
    { role: "rowKey" as const, ...EXAMPLE_COLUMN_POSITIONS.rowKey },
    { role: "email" as const, ...EXAMPLE_COLUMN_POSITIONS.email },
    { role: "reservationCode" as const, ...EXAMPLE_COLUMN_POSITIONS.reservationCode },
    { role: "listingId" as const, ...EXAMPLE_COLUMN_POSITIONS.listingId },
    { role: "marketManager" as const, ...EXAMPLE_COLUMN_POSITIONS.marketManager },
    { role: "contactReason" as const, ...EXAMPLE_COLUMN_POSITIONS.contactReason },
    { role: "userEmailed" as const, ...EXAMPLE_COLUMN_POSITIONS.userEmailed },
    { role: "internalToolK" as const, ...EXAMPLE_COLUMN_POSITIONS.internalToolK },
    { role: "internalToolM" as const, ...EXAMPLE_COLUMN_POSITIONS.internalToolM },
    { role: "status" as const, ...EXAMPLE_COLUMN_POSITIONS.status },
    { role: "internalToolR" as const, ...EXAMPLE_COLUMN_POSITIONS.internalToolR },
    { role: "caseSummary" as const, ...EXAMPLE_COLUMN_POSITIONS.caseSummary },
    { role: "airbnbUserId" as const, ...EXAMPLE_COLUMN_POSITIONS.airbnbUserId },
  ];

  const mappedIndices = new Set(roles.map((r) => r.index));
  const columns = headers.map((header, index) => {
    const match = roles.find((r) => r.index === index);
    if (match) {
      return {
        index,
        letter: match.letter,
        header: getHeader(index),
        role: match.role,
      };
    }
    return {
      index,
      letter: indexToLetter(index),
      header: getHeader(index),
      role: inferRoleFromHeader(header, index),
    };
  });

  // Ensure K/M/R/N exist even if headers array is short
  for (const role of roles) {
    if (!columns.some((c) => c.index === role.index)) {
      columns.push({
        index: role.index,
        letter: role.letter,
        header: getHeader(role.index),
        role: role.role,
      });
    }
  }

  columns.sort((a, b) => a.index - b.index);

  return {
    id: "default",
    sheetUrl: EXAMPLE_SHEET_URL,
    spreadsheetId: EXAMPLE_SPREADSHEET_ID,
    sheetName: "Form Responses",
    headerRow: 1,
    columns,
    createdAt: now,
    updatedAt: now,
  };
}

function inferRoleFromHeader(header: string, index: number): import("./types").ColumnRole {
  const h = header.toLowerCase();
  if (/timestamp|submitted|date/.test(h)) return "timestamp";
  if (index === EXAMPLE_COLUMN_POSITIONS.rowKey.index) return "timestamp";
  if (index === EXAMPLE_COLUMN_POSITIONS.email.index) return "email";
  if (index === EXAMPLE_COLUMN_POSITIONS.reservationCode.index) return "reservationCode";
  if (index === EXAMPLE_COLUMN_POSITIONS.listingId.index) return "listingId";
  if (index === EXAMPLE_COLUMN_POSITIONS.marketManager.index) return "marketManager";
  if (index === EXAMPLE_COLUMN_POSITIONS.contactReason.index) return "contactReason";
  if (index === EXAMPLE_COLUMN_POSITIONS.userEmailed.index) return "userEmailed";
  if (index === EXAMPLE_COLUMN_POSITIONS.caseSummary.index) return "caseSummary";
  if (index === EXAMPLE_COLUMN_POSITIONS.airbnbUserId.index) return "airbnbUserId";
  if (/email|e-mail/.test(h)) return "email";
  if (/name|contact/.test(h) && !/company|org/.test(h)) return "name";
  if (/subject|title|topic/.test(h)) return "subject";
  if (/description|message|details|issue|request/.test(h)) return "description";
  if (/user\s*emailed/i.test(h)) return "userEmailed";
  if (/status|state|stage/.test(h)) return "status";
  if (index === EXAMPLE_COLUMN_POSITIONS.internalToolK.index) return "internalToolK";
  if (index === EXAMPLE_COLUMN_POSITIONS.internalToolM.index) return "internalToolM";
  if (index === EXAMPLE_COLUMN_POSITIONS.internalToolR.index) return "internalToolR";
  if (index === EXAMPLE_COLUMN_POSITIONS.status.index) return "status";
  return "unknown";
}
