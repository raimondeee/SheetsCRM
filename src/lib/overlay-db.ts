import Database from "better-sqlite3";
import path from "path";
import fs from "fs";
import type { SheetConfig, ThreadMessage, Ticket } from "./types";
import { normalizeSheetConfig } from "./column-mapper";
import { crmStatusLabel, mapSheetStatusToCrmId } from "./status-mapper";

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
    db.exec(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_ticket_overlay_gmail_thread ON ticket_overlay(gmail_thread_id) WHERE gmail_thread_id IS NOT NULL`
    );
  } catch {
    /* index exists */
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
  slaHours: number;
  slaDueAt: string | null;
  exists: boolean;
}

function readOverlayRow(rowId: string): TicketOverlay {
  const row = getDb()
    .prepare(
      "SELECT status, status_source, sheet_status, crm_subject, admin_notes, admin_notes_source, sheet_case_summary, gmail_thread_id, sla_hours, sla_due_at FROM ticket_overlay WHERE row_id = ?"
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
        sla_hours: number;
        sla_due_at: string | null;
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
      slaHours: 24,
      slaDueAt: null,
      exists: false,
    };
  }

  return {
    status: row.status,
    statusSource: row.status_source === "crm" ? "crm" : "sheet",
    sheetStatus: row.sheet_status,
    crmSubject: row.crm_subject,
    adminNotes: row.admin_notes,
    adminNotesSource: row.admin_notes_source === "crm" ? "crm" : "sheet",
    sheetCaseSummary: row.sheet_case_summary,
    gmailThreadId: row.gmail_thread_id,
    slaHours: row.sla_hours,
    slaDueAt: row.sla_due_at,
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
  slaHours: number;
  slaDueAt: string | null;
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
      `INSERT INTO ticket_overlay (row_id, status, status_source, sheet_status, crm_subject, admin_notes, admin_notes_source, sheet_case_summary, gmail_thread_id, sla_hours, sla_due_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(row_id) DO UPDATE SET
         status = excluded.status,
         status_source = excluded.status_source,
         sheet_status = excluded.sheet_status,
         crm_subject = excluded.crm_subject,
         admin_notes = excluded.admin_notes,
         admin_notes_source = excluded.admin_notes_source,
         sheet_case_summary = excluded.sheet_case_summary,
         gmail_thread_id = COALESCE(excluded.gmail_thread_id, ticket_overlay.gmail_thread_id),
         sla_hours = excluded.sla_hours,
         sla_due_at = excluded.sla_due_at,
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
      merged.slaHours,
      merged.slaDueAt,
      now
    );
}

export function updateTicketStatus(rowId: string, status: string): void {
  const existing = readOverlayRow(rowId);
  upsertOverlayRow(rowId, overlayFields(existing), { status, statusSource: "crm" });
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
    slaHours: existing.slaHours,
    slaDueAt: existing.slaDueAt,
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

export function mergeOverlayOntoTicket(ticket: Ticket): Ticket {
  const overlay = readOverlayRow(ticket.rowId);
  const mappedFromSheet = mapSheetStatusToCrmId(ticket.sheetStatus);
  const sheetStatusValue = ticket.sheetStatus.trim() || null;
  const sheetCaseSummaryValue = ticket.sheetCaseSummary.trim() || null;

  let status = overlay.status;
  let statusSource = overlay.statusSource;

  if (!overlay.exists) {
    status = mappedFromSheet;
    statusSource = "sheet";
    upsertOverlayRow(ticket.rowId, {
      status,
      statusSource,
      sheetStatus: sheetStatusValue,
      crmSubject: overlay.crmSubject,
      adminNotes: sheetCaseSummaryValue,
      adminNotesSource: "sheet",
      sheetCaseSummary: sheetCaseSummaryValue,
      gmailThreadId: overlay.gmailThreadId,
      slaHours: overlay.slaHours,
      slaDueAt: overlay.slaDueAt,
    });
  } else if (statusSource === "sheet") {
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
  }

  const refreshed = readOverlayRow(ticket.rowId);
  const slaDueAt = refreshed.slaDueAt;
  const slaBreached = slaDueAt ? new Date(slaDueAt) < new Date() : false;
  const subject = refreshed.crmSubject?.trim() || ticket.subject;

  return {
    ...ticket,
    subject,
    status,
    adminNotes: ticket.sheetCaseSummary.trim(),
    sheetStatus: ticket.sheetStatus || crmStatusLabel(status),
    slaHours: refreshed.slaHours,
    slaDueAt,
    slaBreached,
  };
}
