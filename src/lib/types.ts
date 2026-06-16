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
  /** Value from sheet Column D (Salesforce search) */
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
  /** Reservation code from sheet Column E */
  reservationCode: string;
  /** Listing ID from sheet Column F */
  listingId: string;
  /** CRM overlay status */
  status: string;
  /** When status was set to pending/longterm_hold — anchors response timer while waiting */
  statusChangedAt: string | null;
  /** Calendar-hour pending timer when set via Set to Pending (null = business-hour default). */
  pendingReopenHours: number | null;
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
  /** CRM-only linked case URLs (not synced to intake sheet) */
  linkedCases: [string, string, string];
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
  direction: "inbound" | "outbound" | "system";
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
