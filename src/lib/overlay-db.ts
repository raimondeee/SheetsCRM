import Database from "better-sqlite3";
import path from "path";
import fs from "fs";
import { v4 as uuidv4 } from "uuid";
import { buildThreadLinkNoticeBody } from "./gmail-thread-link";
import type { SheetConfig, ThreadMessage, Ticket } from "./types";
import { normalizeSheetConfig } from "./column-mapper";
import {
  crmStatusLabel,
  mapCrmStatusToSheetValue,
  mapSheetStatusToCrmId,
  normalizeStatusId,
} from "./status-mapper";
import {
  getReopenOnCustomerReplyStatus,
  resolveAutomatedReopenStatus,
} from "./status-automation";
import { resolveTicketAirbnbUserId } from "./airbnb-user-id";
import {
  computeDefaultSlaDueAt,
  DEFAULT_SLA_HOURS,
  shouldShowSlaTimer,
} from "./sla-display";
import type { AirbnbUserIdSource } from "./airbnb-user-id";

const DB_PATH = process.env.OVERLAY_DB_PATH || path.join(process.cwd(), "data", "overlay.db");

let db: Database.Database | null = null;

function getDb(): Database.Database {
  if (db) return db;
  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS sheet_config (
      id TEXT PRIMARY KEY,
      config_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS ticket_overlay (
      row_id TEXT PRIMARY KEY,
      status TEXT NOT NULL DEFAULT 'new',
      status_source TEXT NOT NULL DEFAULT 'sheet',
      sheet_status TEXT,
      crm_subject TEXT,
      admin_notes TEXT,
      admin_notes_source TEXT NOT NULL DEFAULT 'sheet',
      sheet_case_summary TEXT,
      gmail_thread_id TEXT,
      sla_hours INTEGER NOT NULL DEFAULT 24,
      sla_due_at TEXT,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS thread_messages (
      id TEXT PRIMARY KEY,
      ticket_row_id TEXT NOT NULL,
      direction TEXT NOT NULL,
      from_addr TEXT NOT NULL,
      to_addr TEXT NOT NULL,
      cc_addr TEXT,
      subject TEXT NOT NULL,
      body TEXT NOT NULL,
      gmail_message_id TEXT,
      gmail_thread_id TEXT,
      sent_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_thread_ticket ON thread_messages(ticket_row_id, sent_at);
  `);

  try {
    db.exec(`ALTER TABLE ticket_overlay ADD COLUMN status_source TEXT NOT NULL DEFAULT 'sheet'`);
  } catch {
    /* column exists */
  }
  try {
    db.exec(`ALTER TABLE ticket_overlay ADD COLUMN sheet_status TEXT`);
  } catch {
    /* column exists */
  }
  try {
    db.exec(`ALTER TABLE ticket_overlay ADD COLUMN crm_subject TEXT`);
  } catch {
    /* column exists */
  }
  try {
    db.exec(`ALTER TABLE ticket_overlay ADD COLUMN admin_notes TEXT`);
  } catch {
    /* column exists */
  }
  try {
    db.exec(`ALTER TABLE ticket_overlay ADD COLUMN admin_notes_source TEXT NOT NULL DEFAULT 'sheet'`);
  } catch {
    /* column exists */
  }
  try {
    db.exec(`ALTER TABLE ticket_overlay ADD COLUMN sheet_case_summary TEXT`);
  } catch {
    /* column exists */
  }
  try {
    db.exec(`ALTER TABLE thread_messages ADD COLUMN gmail_thread_id TEXT`);
  } catch {
    /* column exists */
  }
  try {
    db.exec(`ALTER TABLE thread_messages ADD COLUMN cc_addr TEXT`);
  } catch {
    /* column exists */
  }
  try {
    db.exec(`ALTER TABLE ticket_overlay ADD COLUMN gmail_thread_id TEXT`);
  } catch {
    /* column exists */
  }
  try {
    db.exec(`ALTER TABLE ticket_overlay ADD COLUMN contact_reason TEXT`);
  } catch {
    /* column exists */
  }
  try {
    db.exec(`ALTER TABLE ticket_overlay ADD COLUMN contact_reason_source TEXT NOT NULL DEFAULT 'sheet'`);
  } catch {
    /* column exists */
  }
  try {
    db.exec(`ALTER TABLE ticket_overlay ADD COLUMN status_changed_at TEXT`);
  } catch {
    /* column exists */
  }
  try {
    db.exec(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_ticket_overlay_gmail_thread ON ticket_overlay(gmail_thread_id) WHERE gmail_thread_id IS NOT NULL`
    );
  } catch {
    /* index exists */
  }
  try {
    db.exec(`ALTER TABLE ticket_overlay ADD COLUMN gmail_thread_linked_at TEXT`);
  } catch {
    /* column exists */
  }
  try {
    db.exec(`ALTER TABLE ticket_overlay ADD COLUMN crm_airbnb_user_id TEXT`);
  } catch {
    /* column exists */
  }
  try {
    db.exec(
      `ALTER TABLE ticket_overlay ADD COLUMN airbnb_user_id_source TEXT NOT NULL DEFAULT 'sheet'`
    );
  } catch {
    /* column exists */
  }

  return db;
}

export function saveSheetConfig(config: SheetConfig): void {
  const d = getDb();
  d.prepare(
    `INSERT INTO sheet_config (id, config_json, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET config_json = excluded.config_json, updated_at = excluded.updated_at`
  ).run(config.id, JSON.stringify(config), new Date().toISOString());
}

export function loadSheetConfig(id = "default"): SheetConfig | null {
  const row = getDb()
    .prepare("SELECT config_json FROM sheet_config WHERE id = ?")
    .get(id) as { config_json: string } | undefined;
  if (!row) return null;

  const config = JSON.parse(row.config_json) as SheetConfig;
  if (config.manuallyMapped) return config;

  const normalized = normalizeSheetConfig(config);
  if (JSON.stringify(normalized.columns) !== JSON.stringify(config.columns)) {
    saveSheetConfig(normalized);
  }
  return normalized;
}

export interface TicketOverlay {
  status: string;
  statusSource: "sheet" | "crm";
  sheetStatus: string | null;
  crmSubject: string | null;
  adminNotes: string | null;
  adminNotesSource: "sheet" | "crm";
  sheetCaseSummary: string | null;
  gmailThreadId: string | null;
  contactReason: string | null;
  contactReasonSource: "sheet" | "crm";
  statusChangedAt: string | null;
  slaHours: number;
  slaDueAt: string | null;
  crmAirbnbUserId: string | null;
  airbnbUserIdSource: AirbnbUserIdSource;
  exists: boolean;
}

function readOverlayRow(rowId: string): TicketOverlay {
  const row = getDb()
    .prepare(
      "SELECT status, status_source, sheet_status, crm_subject, admin_notes, admin_notes_source, sheet_case_summary, gmail_thread_id, contact_reason, contact_reason_source, status_changed_at, sla_hours, sla_due_at, crm_airbnb_user_id, airbnb_user_id_source FROM ticket_overlay WHERE row_id = ?"
    )
    .get(rowId) as
    | {
        status: string;
        status_source: string;
        sheet_status: string | null;
        crm_subject: string | null;
        admin_notes: string | null;
        admin_notes_source: string;
        sheet_case_summary: string | null;
        gmail_thread_id: string | null;
        contact_reason: string | null;
        contact_reason_source: string;
        status_changed_at: string | null;
        sla_hours: number;
        sla_due_at: string | null;
        crm_airbnb_user_id: string | null;
        airbnb_user_id_source: string;
      }
    | undefined;

  if (!row) {
    return {
      status: "new",
      statusSource: "sheet",
      sheetStatus: null,
      crmSubject: null,
      adminNotes: null,
      adminNotesSource: "sheet",
      sheetCaseSummary: null,
      gmailThreadId: null,
      contactReason: null,
      contactReasonSource: "sheet",
      statusChangedAt: null,
      slaHours: DEFAULT_SLA_HOURS,
      slaDueAt: null,
      crmAirbnbUserId: null,
      airbnbUserIdSource: "sheet",
      exists: false,
    };
  }

  const airbnbUserIdSource =
    row.airbnb_user_id_source === "crm" || row.airbnb_user_id_source === "column_d"
      ? row.airbnb_user_id_source
      : "sheet";

  return {
    status: normalizeStatusId(row.status),
    statusSource: row.status_source === "crm" ? "crm" : "sheet",
    sheetStatus: row.sheet_status,
    crmSubject: row.crm_subject,
    adminNotes: row.admin_notes,
    adminNotesSource: row.admin_notes_source === "crm" ? "crm" : "sheet",
    sheetCaseSummary: row.sheet_case_summary,
    gmailThreadId: row.gmail_thread_id,
    contactReason: row.contact_reason,
    contactReasonSource: row.contact_reason_source === "crm" ? "crm" : "sheet",
    statusChangedAt: row.status_changed_at,
    slaHours: row.sla_hours,
    slaDueAt: row.sla_due_at,
    crmAirbnbUserId: row.crm_airbnb_user_id,
    airbnbUserIdSource,
    exists: true,
  };
}

export function getTicketOverlay(rowId: string): TicketOverlay {
  return readOverlayRow(rowId);
}

type OverlayFields = {
  status: string;
  statusSource: "sheet" | "crm";
  sheetStatus: string | null;
  crmSubject: string | null;
  adminNotes: string | null;
  adminNotesSource: "sheet" | "crm";
  sheetCaseSummary: string | null;
  gmailThreadId: string | null;
  contactReason: string | null;
  contactReasonSource: "sheet" | "crm";
  statusChangedAt: string | null;
  slaHours: number;
  slaDueAt: string | null;
  crmAirbnbUserId: string | null;
  airbnbUserIdSource: AirbnbUserIdSource;
};

function upsertOverlayRow(
  rowId: string,
  fields: OverlayFields,
  updates: Partial<OverlayFields> = {}
): void {
  const merged = { ...fields, ...updates };
  const now = new Date().toISOString();
  getDb()
    .prepare(
      `INSERT INTO ticket_overlay (row_id, status, status_source, sheet_status, crm_subject, admin_notes, admin_notes_source, sheet_case_summary, gmail_thread_id, contact_reason, contact_reason_source, status_changed_at, sla_hours, sla_due_at, crm_airbnb_user_id, airbnb_user_id_source, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(row_id) DO UPDATE SET
         status = excluded.status,
         status_source = excluded.status_source,
         sheet_status = excluded.sheet_status,
         crm_subject = excluded.crm_subject,
         admin_notes = excluded.admin_notes,
         admin_notes_source = excluded.admin_notes_source,
         sheet_case_summary = excluded.sheet_case_summary,
         gmail_thread_id = COALESCE(excluded.gmail_thread_id, ticket_overlay.gmail_thread_id),
         contact_reason = excluded.contact_reason,
         contact_reason_source = excluded.contact_reason_source,
         status_changed_at = excluded.status_changed_at,
         sla_hours = excluded.sla_hours,
         sla_due_at = excluded.sla_due_at,
         crm_airbnb_user_id = excluded.crm_airbnb_user_id,
         airbnb_user_id_source = excluded.airbnb_user_id_source,
         updated_at = excluded.updated_at`
    )
    .run(
      rowId,
      merged.status,
      merged.statusSource,
      merged.sheetStatus,
      merged.crmSubject,
      merged.adminNotes,
      merged.adminNotesSource,
      merged.sheetCaseSummary,
      merged.gmailThreadId,
      merged.contactReason,
      merged.contactReasonSource,
      merged.statusChangedAt,
      merged.slaHours,
      merged.slaDueAt,
      merged.crmAirbnbUserId,
      merged.airbnbUserIdSource,
      now
    );
}

export function updateTicketStatus(rowId: string, status: string): void {
  const existing = readOverlayRow(rowId);
  const normalizedStatus = normalizeStatusId(status);
  const now = new Date().toISOString();
  let statusChangedAt = existing.statusChangedAt;

  if (normalizedStatus === "pending" || normalizedStatus === "longterm_hold") {
    statusChangedAt = now;
  } else if (
    normalizedStatus === "open" &&
    (existing.status === "pending" || existing.status === "longterm_hold")
  ) {
    statusChangedAt = null;
  }

  const sheetStatus = mapCrmStatusToSheetValue(normalizedStatus);
  upsertOverlayRow(rowId, overlayFields(existing), {
    status: normalizedStatus,
    statusSource: "crm",
    statusChangedAt,
    sheetStatus: sheetStatus ?? existing.sheetStatus,
  });
}

export function updateTicketAirbnbUserId(rowId: string, userId: string): void {
  const existing = readOverlayRow(rowId);
  const trimmed = userId.trim();
  upsertOverlayRow(rowId, overlayFields(existing), {
    crmAirbnbUserId: trimmed || null,
    airbnbUserIdSource: "crm",
  });
}

export function markAirbnbUserIdFromColumnD(rowId: string, userId: string): void {
  const existing = readOverlayRow(rowId);
  const trimmed = userId.trim();
  upsertOverlayRow(rowId, overlayFields(existing), {
    crmAirbnbUserId: trimmed || null,
    airbnbUserIdSource: "column_d",
  });
}

export function updateTicketContactReason(rowId: string, contactReason: string): void {
  const existing = readOverlayRow(rowId);
  upsertOverlayRow(rowId, overlayFields(existing), {
    contactReason: contactReason.trim() || null,
    contactReasonSource: "crm",
  });
}

export function updateTicketSubject(rowId: string, subject: string): void {
  const existing = readOverlayRow(rowId);
  upsertOverlayRow(rowId, overlayFields(existing), { crmSubject: subject.trim() || null });
}

export function updateTicketSla(rowId: string, slaHours: number, slaDueAt: string | null): void {
  const existing = readOverlayRow(rowId);
  upsertOverlayRow(rowId, overlayFields(existing), { slaHours, slaDueAt });
}

function overlayFields(existing: TicketOverlay): OverlayFields {
  return {
    status: existing.status,
    statusSource: existing.statusSource,
    sheetStatus: existing.sheetStatus,
    crmSubject: existing.crmSubject,
    adminNotes: existing.adminNotes,
    adminNotesSource: existing.adminNotesSource,
    sheetCaseSummary: existing.sheetCaseSummary,
    gmailThreadId: existing.gmailThreadId,
    contactReason: existing.contactReason,
    contactReasonSource: existing.contactReasonSource,
    statusChangedAt: existing.statusChangedAt,
    slaHours: existing.slaHours,
    slaDueAt: existing.slaDueAt,
    crmAirbnbUserId: existing.crmAirbnbUserId,
    airbnbUserIdSource: existing.airbnbUserIdSource,
  };
}

export function getTicketGmailThreadId(ticketRowId: string): string | null {
  return readOverlayRow(ticketRowId).gmailThreadId;
}

export function getTicketRowIdForGmailThread(threadId: string): string | null {
  const row = getDb()
    .prepare("SELECT row_id FROM ticket_overlay WHERE gmail_thread_id = ?")
    .get(threadId) as { row_id: string } | undefined;
  return row?.row_id ?? null;
}

/** Bind one Gmail thread to one ticket. Returns false if thread belongs to another ticket. */
export function claimGmailThreadForTicket(ticketRowId: string, threadId: string): boolean {
  const trimmed = threadId.trim();
  if (!trimmed) return false;

  const owner = getTicketRowIdForGmailThread(trimmed);
  if (owner && owner !== ticketRowId) return false;

  const existing = readOverlayRow(ticketRowId);
  if (existing.gmailThreadId && existing.gmailThreadId !== trimmed) return false;

  try {
    upsertOverlayRow(ticketRowId, overlayFields(existing), { gmailThreadId: trimmed });
    return true;
  } catch {
    return false;
  }
}

export function getGmailThreadImportCutoff(ticketRowId: string): string | null {
  const row = getDb()
    .prepare("SELECT gmail_thread_linked_at FROM ticket_overlay WHERE row_id = ?")
    .get(ticketRowId) as { gmail_thread_linked_at: string | null } | undefined;
  return row?.gmail_thread_linked_at ?? null;
}

export function linkExistingGmailThread(
  ticketRowId: string,
  threadId: string
): { ok: true; message: ThreadMessage } | { ok: false; error: string } {
  const trimmed = threadId.trim();
  if (!trimmed) return { ok: false, error: "Gmail thread ID is required" };

  const existing = readOverlayRow(ticketRowId);
  if (existing.gmailThreadId === trimmed) {
    return { ok: false, error: "This ticket is already linked to this Gmail thread" };
  }
  if (existing.gmailThreadId && existing.gmailThreadId !== trimmed) {
    return { ok: false, error: "This ticket is already linked to a different Gmail thread" };
  }

  if (!claimGmailThreadForTicket(ticketRowId, trimmed)) {
    const owner = getTicketRowIdForGmailThread(trimmed);
    if (owner && owner !== ticketRowId) {
      return { ok: false, error: "This Gmail thread is already linked to another ticket" };
    }
    return { ok: false, error: "Could not link Gmail thread" };
  }

  const linkedAt = new Date();
  const linkedAtIso = linkedAt.toISOString();
  getDb()
    .prepare(
      "UPDATE ticket_overlay SET gmail_thread_linked_at = ?, updated_at = ? WHERE row_id = ?"
    )
    .run(linkedAtIso, linkedAtIso, ticketRowId);

  const message: ThreadMessage = {
    id: uuidv4(),
    ticketRowId,
    direction: "system",
    from: "SheetsCRM",
    to: "",
    cc: null,
    subject: "Gmail thread linked",
    body: buildThreadLinkNoticeBody(linkedAt),
    gmailMessageId: null,
    gmailThreadId: trimmed,
    sentAt: linkedAtIso,
  };
  addThreadMessage(message);

  return { ok: true, message };
}

function getAllThreadMessagesRaw(ticketRowId: string): ThreadMessage[] {
  const rows = getDb()
    .prepare("SELECT * FROM thread_messages WHERE ticket_row_id = ? ORDER BY sent_at ASC")
    .all(ticketRowId) as Array<{
    id: string;
    ticket_row_id: string;
    direction: string;
    from_addr: string;
    to_addr: string;
    cc_addr: string | null;
    subject: string;
    body: string;
    gmail_message_id: string | null;
    gmail_thread_id: string | null;
    sent_at: string;
  }>;

  return rows.map((r) => ({
    id: r.id,
    ticketRowId: r.ticket_row_id,
    direction: r.direction as "inbound" | "outbound",
    from: r.from_addr,
    to: r.to_addr,
    cc: r.cc_addr,
    subject: r.subject,
    body: r.body,
    gmailMessageId: r.gmail_message_id,
    gmailThreadId: r.gmail_thread_id,
    sentAt: r.sent_at,
  }));
}

/** Latest inbound/outbound message direction for a ticket (ignores system notes). */
export function getLatestConversationDirection(
  ticketRowId: string
): "inbound" | "outbound" | null {
  const row = getDb()
    .prepare(
      `SELECT direction FROM thread_messages
       WHERE ticket_row_id = ? AND direction IN ('inbound', 'outbound')
       ORDER BY sent_at DESC
       LIMIT 1`
    )
    .get(ticketRowId) as { direction: string } | undefined;

  if (!row) return null;
  return row.direction as "inbound" | "outbound";
}

/** Move pending → open when the customer sent the latest email. */
export function reopenPendingOnCustomerReply(ticketRowId: string): boolean {
  const overlay = readOverlayRow(ticketRowId);
  const reopen = getReopenOnCustomerReplyStatus(
    overlay.status,
    getLatestConversationDirection(ticketRowId)
  );
  if (!reopen) return false;

  upsertOverlayRow(ticketRowId, overlayFields(overlay), {
    status: reopen,
    statusSource: "crm",
    statusChangedAt: null,
  });
  return true;
}

/** Latest thread message time per ticket (batch). */
export function getLastThreadResponseMap(): Map<string, string> {
  const rows = getDb()
    .prepare(
      `SELECT ticket_row_id, MAX(sent_at) AS last_sent
       FROM thread_messages
       GROUP BY ticket_row_id`
    )
    .all() as Array<{ ticket_row_id: string; last_sent: string }>;

  return new Map(rows.map((r) => [r.ticket_row_id, r.last_sent]));
}

/** Resolve the Gmail thread bound to this ticket (from overlay or first outbound). */
export function resolveTicketGmailThreadId(ticketRowId: string): string | null {
  const claimed = getTicketGmailThreadId(ticketRowId);
  if (claimed) return claimed;

  const messages = getAllThreadMessagesRaw(ticketRowId);
  const outbound = [...messages].reverse().find((m) => m.gmailThreadId && m.direction === "outbound");
  if (outbound?.gmailThreadId && claimGmailThreadForTicket(ticketRowId, outbound.gmailThreadId)) {
    return outbound.gmailThreadId;
  }

  return null;
}

export function pruneMismatchedThreadMessages(ticketRowId: string): void {
  const claimed = getTicketGmailThreadId(ticketRowId);
  if (!claimed) return;

  getDb()
    .prepare(
      `DELETE FROM thread_messages
       WHERE ticket_row_id = ? AND gmail_thread_id IS NOT NULL AND gmail_thread_id != ?`
    )
    .run(ticketRowId, claimed);
}

export function getThreadMessages(ticketRowId: string): ThreadMessage[] {
  const claimed = resolveTicketGmailThreadId(ticketRowId);
  const messages = getAllThreadMessagesRaw(ticketRowId);

  if (!claimed) {
    return messages.filter((m) => !m.gmailThreadId);
  }

  return messages.filter((m) => !m.gmailThreadId || m.gmailThreadId === claimed);
}

export function addThreadMessage(message: ThreadMessage): void {
  getDb()
    .prepare(
      `INSERT INTO thread_messages (id, ticket_row_id, direction, from_addr, to_addr, cc_addr, subject, body, gmail_message_id, gmail_thread_id, sent_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      message.id,
      message.ticketRowId,
      message.direction,
      message.from,
      message.to,
      message.cc,
      message.subject,
      message.body,
      message.gmailMessageId,
      message.gmailThreadId,
      message.sentAt
    );
}

export function getOutboundTicketIds(): Set<string> {
  const rows = getDb()
    .prepare(
      `SELECT DISTINCT ticket_row_id FROM thread_messages WHERE direction = 'outbound'`
    )
    .all() as Array<{ ticket_row_id: string }>;
  return new Set(rows.map((r) => r.ticket_row_id));
}

export function applyStatusAutomations(tickets: Ticket[]): Ticket[] {
  return tickets.map((ticket) => {
    const overlay = readOverlayRow(ticket.rowId);
    const reopen = resolveAutomatedReopenStatus(
      overlay.status,
      overlay.statusChangedAt,
      getLatestConversationDirection(ticket.rowId)
    );
    if (!reopen) return ticket;

    upsertOverlayRow(ticket.rowId, overlayFields(overlay), {
      status: reopen,
      statusSource: "crm",
      statusChangedAt: null,
    });

    return { ...ticket, status: reopen };
  });
}

export function mergeOverlayOntoTicket(ticket: Ticket, sheetAirbnbUserId?: string): Ticket {
  const overlay = readOverlayRow(ticket.rowId);
  const sheetAd = sheetAirbnbUserId ?? ticket.airbnbUserId;
  const mappedFromSheet = mapSheetStatusToCrmId(ticket.sheetStatus);
  const sheetStatusValue = ticket.sheetStatus.trim() || null;
  const sheetCaseSummaryValue = ticket.sheetCaseSummary.trim() || null;

  const sheetContactReason = ticket.contactReason.trim() || null;

  let status = overlay.status;
  let statusSource = overlay.statusSource;
  let contactReason = sheetContactReason ?? "";
  let contactReasonSource = overlay.contactReasonSource;

  if (!overlay.exists) {
    status = mappedFromSheet;
    statusSource = "sheet";
    contactReasonSource = "sheet";
    const slaHours = DEFAULT_SLA_HOURS;
    const slaDueAt = shouldShowSlaTimer({ status, timestamp: ticket.timestamp })
      ? computeDefaultSlaDueAt(ticket.timestamp, slaHours)
      : null;
    upsertOverlayRow(ticket.rowId, {
      status,
      statusSource,
      sheetStatus: sheetStatusValue,
      crmSubject: overlay.crmSubject,
      adminNotes: sheetCaseSummaryValue,
      adminNotesSource: "sheet",
      sheetCaseSummary: sheetCaseSummaryValue,
      gmailThreadId: overlay.gmailThreadId,
      contactReason: sheetContactReason,
      contactReasonSource: "sheet",
      statusChangedAt: null,
      slaHours,
      slaDueAt,
      crmAirbnbUserId: null,
      airbnbUserIdSource: "sheet",
    });
  } else {
    if (contactReasonSource === "sheet" && sheetContactReason !== overlay.contactReason) {
      contactReason = sheetContactReason ?? "";
      upsertOverlayRow(ticket.rowId, overlayFields(overlay), {
        contactReason: sheetContactReason,
        contactReasonSource: "sheet",
      });
    } else if (contactReasonSource === "crm" && overlay.contactReason) {
      contactReason = overlay.contactReason;
    }

    if (statusSource === "sheet") {
      const sheetChanged = sheetStatusValue !== overlay.sheetStatus;
      if (sheetChanged || overlay.sheetStatus === null) {
        status = mappedFromSheet;
        upsertOverlayRow(ticket.rowId, overlayFields(overlay), {
          status,
          statusSource: "sheet",
          sheetStatus: sheetStatusValue,
          sheetCaseSummary: sheetCaseSummaryValue,
          adminNotes: sheetCaseSummaryValue,
          adminNotesSource: "sheet",
        });
      } else if (sheetCaseSummaryValue !== overlay.sheetCaseSummary) {
        upsertOverlayRow(ticket.rowId, overlayFields(overlay), {
          sheetCaseSummary: sheetCaseSummaryValue,
          adminNotes: sheetCaseSummaryValue,
          adminNotesSource: "sheet",
          gmailThreadId: overlay.gmailThreadId,
        });
      }
    } else if (statusSource === "crm") {
      status = overlay.status;
    }
  }

  const refreshed = readOverlayRow(ticket.rowId);
  const reopen = resolveAutomatedReopenStatus(
    refreshed.status,
    refreshed.statusChangedAt,
    getLatestConversationDirection(ticket.rowId)
  );
  if (reopen) {
    upsertOverlayRow(ticket.rowId, overlayFields(refreshed), {
      status: reopen,
      statusSource: "crm",
      statusChangedAt: null,
    });
    status = reopen;
  } else {
    status = refreshed.status;
  }

  if (refreshed.contactReasonSource === "crm" && refreshed.contactReason) {
    contactReason = refreshed.contactReason;
  } else if (refreshed.contactReason) {
    contactReason = refreshed.contactReason;
  }

  const slaHours = refreshed.slaHours || DEFAULT_SLA_HOURS;
  const slaEligible = shouldShowSlaTimer({ status, timestamp: ticket.timestamp });
  let slaDueAt = slaEligible ? refreshed.slaDueAt : null;
  if (slaEligible && !slaDueAt && slaHours > 0) {
    slaDueAt = computeDefaultSlaDueAt(ticket.timestamp, slaHours);
    upsertOverlayRow(ticket.rowId, overlayFields(refreshed), { slaDueAt });
  }
  const slaBreached = slaDueAt ? new Date(slaDueAt) < new Date() : false;
  const subject = refreshed.crmSubject?.trim() || ticket.subject;
  const airbnbUserId = resolveTicketAirbnbUserId(sheetAd, ticket.columnD, refreshed);

  return {
    ...ticket,
    subject,
    contactReason,
    status,
    airbnbUserId,
    adminNotes: ticket.sheetCaseSummary.trim(),
    sheetStatus:
      refreshed.statusSource === "crm"
        ? refreshed.sheetStatus || crmStatusLabel(status)
        : ticket.sheetStatus || crmStatusLabel(status),
    slaHours,
    slaDueAt,
    slaBreached,
    needsInitialResponse: false,
  };
}
