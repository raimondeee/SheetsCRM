/**
 * Shared domain types for SheetsCRM.
 *
 * Reviewers: start here for vocabulary. Many Ticket / SheetConfig fields document
 * whether a value lives on the Google Sheet, in the SQLite overlay, or both.
 * ColumnRole is the stable CRM meaning of a sheet column after auto/manual mapping.
 *
 * @see column-mapper (header → role), overlay-db (CRM-owned fields), sheets (intake)
 */
import type { BusinessHoursConfig } from "./business-hours";

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
  | "reservationCode"
  | "claimNumber"
  | "listingId"
  | "userEmailed"
  | "ticketHeaderField"
  | "unknown";

export interface ColumnMapping {
  /** 0-based column index */
  index: number;
  /** Column letter e.g. "K" */
  letter: string;
  /** Display label in CRM (editable in Setup). */
  header: string;
  /** Original header text from row 1 of the sheet. */
  sheetHeader?: string;
  role: ColumnRole;
  /** Hidden from column mapping UI (unmapped columns only). */
  hidden?: boolean;
}

/** Editable ticket-header field mapped to a sheet column (Setup → UI fields). */
export interface UiFieldSlot {
  id: string;
  label: string;
  /** 0-based sheet column index; null = unused placeholder slot. */
  columnIndex: number | null;
}

export interface SheetConfig {
  id: string;
  sheetUrl: string;
  spreadsheetId: string;
  sheetName: string;
  headerRow: number;
  columns: ColumnMapping[];
  /** Optional header-area fields under the ticket subject. */
  uiFieldSlots?: UiFieldSlot[];
  /**
   * Fixed text prepended to the editable CRM email subject (compose + sends).
   * Not a sheet column — typed in Setup.
   * - `undefined` / omitted → default “Form Submission Response - ”
   * - `""` → prefix disabled
   * - any other string → custom prefix
   */
  emailSubjectPrefix?: string;
  /** Workspace business schedule for timers and service metrics. */
  businessHours?: BusinessHoursConfig;
  /** When true, saved column roles are not auto-overwritten on load. */
  manuallyMapped?: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Teammate intake sheet configured under Setup → Team coverage. */
export interface CoverSheetEntry {
  id: string;
  /** Agent or team name shown on tickets from this sheet. */
  label: string;
  enabled: boolean;
  config: SheetConfig | null;
}

export interface Ticket {
  rowId: string;
  rowNumber: number;
  spreadsheetId: string;
  sheetName: string;
  timestamp: string;
  requesterEmail: string;
  /** Value from the mapped email column (legacy field name). */
  columnD: string;
  requesterName: string;
  /** Mappable header field shown under the ticket subject (Setup → column role). */
  headerField: string;
  /** Values for Setup → UI field slots keyed by slot id. */
  uiFields: Record<string, string>;
  subject: string;
  /** CRM-only subject suffix (after the fixed email prefix) for list display. */
  crmSubjectLabel: string;
  description: string;
  /** Contact reason from the mapped contact reason column */
  contactReason: string;
  /** Market Manager from the mapped market manager column */
  marketManager: string;
  /** Raw value from the mapped status column */
  sheetStatus: string;
  /** Case summary from the mapped case summary column (read-only reference) */
  sheetCaseSummary: string;
  /** CRM admin notes (seeded from case summary column, editable in overlay) */
  adminNotes: string;
  /** Airbnb User ID from the mapped airbnbUserId column */
  airbnbUserId: string;
  /** Reservation code from the mapped reservation code column */
  reservationCode: string;
  /** Claim number from the mapped claim number column */
  claimNumber: string;
  /** Listing ID from the mapped listing ID column */
  listingId: string;
  /** CRM overlay status */
  status: string;
  /** When status was set to pending/longterm_hold — anchors response timer while waiting */
  statusChangedAt: string | null;
  /** Weekday-hour pending timer when set via Set to Pending (null = workspace default). */
  pendingReopenHours: number | null;
  /** True when resolved via Resolve & Close — blocks auto-reopen. */
  resolvedClosed?: boolean;
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
  /** No agent reply yet and past initial-response SLA */
  needsInitialResponse: boolean;
  /** Linked Gmail thread open URL from overlay (null when not linked) */
  gmailOpenUrl: string | null;
  /** When Gmail thread claim was archived after prolonged closed status */
  gmailLinkArchivedAt: string | null;
  /** Next outbound send should start a fresh Gmail thread (not reply to a prior link). */
  forceNewGmailThreadOnSend: boolean;
  /** CRM-only linked case URLs (not synced to intake sheet) */
  linkedCases: [string, string, string];
  /** When set, ticket is from a teammate cover sheet (Setup → Team coverage). */
  coverSourceLabel?: string | null;
  /** CRM-only manual Airbnb User ID from Internal tools (syncs to mapped airbnbUserId column). */
  crmAirbnbUserId?: string | null;
  /**
   * Agent confirmed there is no Airbnb User ID to enter for reporting.
   * Allows resolve/close without a numeric Manual User ID.
   */
  airbnbUserIdExempt?: boolean;
  raw: Record<string, string>;
}

export interface ThreadMessageAttachment {
  id: string;
  threadMessageId: string;
  ticketRowId: string;
  gmailMessageId: string;
  gmailAttachmentId: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
}

export interface ThreadMessage {
  id: string;
  ticketRowId: string;
  direction: "inbound" | "outbound" | "system" | "admin_note" | "redacted";
  from: string;
  to: string;
  cc: string | null;
  subject: string;
  body: string;
  gmailMessageId: string | null;
  gmailThreadId: string | null;
  sentAt: string;
  attachments?: ThreadMessageAttachment[];
}

export interface GmailThreadCandidatePreview {
  apiThreadId: string;
  subject: string;
  from: string;
  to: string;
  sentAt: string;
  snippet: string;
  messageCount: number;
  folders: string[];
}

export interface GmailUnreadThreadPreview {
  threadId: string;
  subject: string;
  from: string;
  fromEmail: string;
  snippet: string;
  latestAt: string;
  messageCount: number;
  unreadCount: number;
  linkedTicketRowId: string | null;
  openUrl: string;
}

export type GmailThreadLinkResolveResult =
  | { status: "resolved"; apiThreadId: string }
  | { status: "ambiguous"; threadIds: string[] }
  | { status: "not_found" };

export interface StatusOption {
  id: string;
  label: string;
  color: string;
}

export const DEFAULT_STATUSES: StatusOption[] = [
  { id: "new", label: "New", color: "#30aabc" },
  { id: "open", label: "Open", color: "#038153" },
  { id: "pending", label: "Pending", color: "#bf5000" },
  { id: "resolved", label: "Resolved", color: "#87929d" },
  { id: "do_not_action", label: "Do Not Action", color: "#4b5563" },
  { id: "longterm_hold", label: "Longterm Hold/Bugs", color: "#68737d" },
];

/** Column N values synced from CRM (excludes CRM-only New). */
export const SHEET_STATUS_VALUES = [
  "Open",
  "Pending",
  "Resolved",
  "Do Not Action",
  "Longterm Hold/Bugs",
] as const;

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
