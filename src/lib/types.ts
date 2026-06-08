export type ColumnRole =
  | "rowKey"
  | "timestamp"
  | "email"
  | "name"
  | "subject"
  | "description"
  | "contactReason"
  | "marketManager"
  | "status"
  | "caseSummary"
  | "internalToolK"
  | "internalToolM"
  | "internalToolR"
  | "airbnbUserId"
  | "unknown";

export interface ColumnMapping {
  /** 0-based column index */
  index: number;
  /** Column letter e.g. "K" */
  letter: string;
  /** Header text from row 1 */
  header: string;
  role: ColumnRole;
}

export interface SheetConfig {
  id: string;
  sheetUrl: string;
  spreadsheetId: string;
  sheetName: string;
  headerRow: number;
  columns: ColumnMapping[];
  /** When true, saved column roles are not auto-overwritten on load. */
  manuallyMapped?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Ticket {
  rowId: string;
  rowNumber: number;
  spreadsheetId: string;
  sheetName: string;
  timestamp: string;
  requesterEmail: string;
  requesterName: string;
  subject: string;
  description: string;
  /** Contact reason from sheet Column I */
  contactReason: string;
  /** Market Manager from sheet Column H */
  marketManager: string;
  /** Raw value from sheet Column N / status column */
  sheetStatus: string;
  /** Case summary from sheet Column U (read-only reference) */
  sheetCaseSummary: string;
  /** CRM admin notes (seeded from Column U, editable in overlay) */
  adminNotes: string;
  /** Airbnb User ID from sheet Column AD */
  airbnbUserId: string;
  /** CRM overlay status */
  status: string;
  internalTools: {
    k: string;
    m: string;
    r: string;
  };
  slaHours: number;
  slaDueAt: string | null;
  slaBreached: boolean;
  /** Latest thread message or intake timestamp — used for sorting and age display */
  lastResponseAt: string | null;
  raw: Record<string, string>;
}

export interface ThreadMessage {
  id: string;
  ticketRowId: string;
  direction: "inbound" | "outbound";
  from: string;
  to: string;
  cc: string | null;
  subject: string;
  body: string;
  gmailMessageId: string | null;
  gmailThreadId: string | null;
  sentAt: string;
}

export interface StatusOption {
  id: string;
  label: string;
  color: string;
}

export const DEFAULT_STATUSES: StatusOption[] = [
  { id: "new", label: "New", color: "#30aabc" },
  { id: "open", label: "Open", color: "#038153" },
  { id: "pending", label: "Pending", color: "#bf5000" },
  { id: "on_hold", label: "On hold", color: "#68737d" },
  { id: "solved", label: "Solved", color: "#87929d" },
];

export const COLUMN_LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

export function indexToLetter(index: number): string {
  let n = index;
  let result = "";
  while (n >= 0) {
    result = COLUMN_LETTERS[n % 26] + result;
    n = Math.floor(n / 26) - 1;
  }
  return result;
}

export function letterToIndex(letter: string): number {
  const upper = letter.toUpperCase();
  let result = 0;
  for (let i = 0; i < upper.length; i++) {
    result = result * 26 + (upper.charCodeAt(i) - 64);
  }
  return result - 1;
}

export function parseTicketRowId(
  rowId: string
): { spreadsheetId: string; sheetName: string; rowNumber: number } | null {
  const lastColon = rowId.lastIndexOf(":");
  const sheetSep = rowId.lastIndexOf(":", lastColon - 1);
  if (lastColon === -1 || sheetSep === -1) return null;

  const rowNumber = parseInt(rowId.slice(lastColon + 1), 10);
  if (Number.isNaN(rowNumber)) return null;

  return {
    spreadsheetId: rowId.slice(0, sheetSep),
    sheetName: rowId.slice(sheetSep + 1, lastColon),
    rowNumber,
  };
}

export function parseSheetUrl(url: string): { spreadsheetId: string; gid?: string } | null {
  const idMatch = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (!idMatch) return null;
  const gidMatch = url.match(/[#?&]gid=(\d+)/);
  return {
    spreadsheetId: idMatch[1],
    gid: gidMatch?.[1],
  };
}
