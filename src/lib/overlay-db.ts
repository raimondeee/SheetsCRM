import Database from "better-sqlite3";
import path from "path";
import fs from "fs";
import { v4 as uuidv4 } from "uuid";
import {
  buildGmailResetForNewThreadBody,
  buildThreadAppendNoticeBody,
  buildThreadLinkNoticeBody,
  buildThreadLinkUpdatedBody,
} from "./gmail-thread-link";
import { isGmailApiThreadId } from "./gmail-urls";
import type { CoverSheetEntry, SheetConfig, ThreadMessage, ThreadMessageAttachment, Ticket } from "./types";
import { parseTicketRowId } from "./types";
import { normalizeSheetConfig } from "./column-mapper";
import { prepareSheetConfig } from "./ui-field-slots";
import {
  blocksTicketAutoReopen,
  crmStatusLabel,
  mapCrmStatusToSheetValue,
  mapSheetStatusToCrmId,
  normalizeStatusId,
} from "./status-mapper";
import { businessHoursFromSheetConfig, type BusinessHoursConfig } from "./business-hours";
import { ensureCrmTicketEventsTable, logCrmTicketEvent } from "./crm-ticket-log";
import {
  combineNotesForPendingInference,
  resolvePendingTimerAnchor,
} from "./pending-timer-anchor";
import {
  describePendingReopenTimer,
  getReopenOnCustomerReplyStatus,
  resolveAutomatedReopenStatus,
} from "./status-automation";
import { resolveTicketAirbnbUserId, manualAirbnbUserIdFromOverlay } from "./airbnb-user-id";
import { crmSubjectLabelFromStored } from "./email-subject";
import {
  computeResponseSlaDueAt,
  isResponseSlaEligibleStatus,
  resolveResponseSlaAnchor,
  shouldShowResponseSla,
} from "./sla-display";
import {
  DEFAULT_TIMER_SETTINGS,
  type TimerSettings,
} from "./timer-settings";
import type { AirbnbUserIdSource } from "./airbnb-user-id";
import { appendAdminNoteToText } from "./admin-notes";
import { buildGmailConversationUrl } from "./gmail-urls";
import {
  buildRedactAdminNote,
  buildRedactedMessagePlaceholderBody,
} from "./thread-redaction";
import {
  clearGmailLinkArchivedAt,
  clearTicketResolvedAt,
  getTicketGmailLinkArchivedAt,
  markTicketResolvedNow,
  ticketGmailLinkIsArchived,
} from "./gmail-link-archive";
import {
  addGmailThreadToTicket,
  ensureTicketGmailThreadsSchema,
  getGmailThreadLinkedAt,
  getLinkedGmailThreadIds,
  getPrimaryGmailThreadLink,
  getTicketRowIdForLinkedGmailThread,
  isGmailThreadLinkedToTicket,
  listTicketGmailThreads,
  migrateTicketGmailThreadsFromOverlay,
  syncPrimaryThreadToOverlay,
  ticketHasAnyGmailThreadLink,
} from "./ticket-gmail-threads";
import {
  COVER_SHEETS_STORE_ID,
  normalizeCoverSheetEntries,
  resolveSheetConfigForTicket,
} from "./cover-sheets";

const DB_PATH = process.env.OVERLAY_DB_PATH || path.join(process.cwd(), "data", "overlay.db");

let db: Database.Database | null = null;

export function getOverlayDb(): Database.Database {
  return getDb();
}

function workspaceBusinessHours(): BusinessHoursConfig {
  const config = businessHoursFromSheetConfig(loadSheetConfig("default"));
  const holidays = loadWorkspaceHolidayDatesFromCache();
  if (!holidays.size) return config;
  return { ...config, holidayDates: holidays };
}

const WORKSPACE_HOLIDAY_CALENDAR_ID = "en.usa#holiday@group.v.calendar.google.com";

export function loadWorkspaceHolidayDatesFromCache(
  calendarId = WORKSPACE_HOLIDAY_CALENDAR_ID
): ReadonlySet<string> {
  const database = getDb();
  const rows = database
    .prepare(
      `SELECT date_key FROM holiday_calendar_cache WHERE calendar_id = ? ORDER BY date_key`
    )
    .all(calendarId) as Array<{ date_key: string }>;
  return new Set(rows.map((row) => row.date_key));
}

export function saveWorkspaceHolidayDatesToCache(
  dates: Iterable<string>,
  calendarId = WORKSPACE_HOLIDAY_CALENDAR_ID
): void {
  const database = getDb();
  const unique = [...new Set(dates)].sort();
  const tx = database.transaction(() => {
    database
      .prepare(`DELETE FROM holiday_calendar_cache WHERE calendar_id = ?`)
      .run(calendarId);
    const insert = database.prepare(
      `INSERT INTO holiday_calendar_cache (calendar_id, date_key) VALUES (?, ?)`
    );
    for (const dateKey of unique) {
      insert.run(calendarId, dateKey);
    }
    database
      .prepare(
        `INSERT INTO holiday_calendar_meta (calendar_id, fetched_at)
         VALUES (?, ?)
         ON CONFLICT(calendar_id) DO UPDATE SET fetched_at = excluded.fetched_at`
      )
      .run(calendarId, new Date().toISOString());
  });
  tx();
}

export function workspaceHolidayCacheIsFresh(
  calendarId = WORKSPACE_HOLIDAY_CALENDAR_ID,
  ttlMs = 7 * 24 * 60 * 60 * 1000
): boolean {
  const database = getDb();
  const row = database
    .prepare(`SELECT fetched_at FROM holiday_calendar_meta WHERE calendar_id = ?`)
    .get(calendarId) as { fetched_at: string } | undefined;
  if (!row?.fetched_at) return false;
  const fetchedAt = new Date(row.fetched_at).getTime();
  if (!Number.isFinite(fetchedAt)) return false;
  return Date.now() - fetchedAt < ttlMs;
}

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
    CREATE TABLE IF NOT EXISTS overlay_migrations (
      id TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS user_preferences (
      user_key TEXT PRIMARY KEY,
      preferences_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS ticket_compose_prefs (
      user_key TEXT NOT NULL,
      ticket_row_id TEXT NOT NULL,
      cc_market_manager INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (user_key, ticket_row_id)
    );
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
    db.exec(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_thread_gmail_message_unique
       ON thread_messages(ticket_row_id, gmail_message_id)
       WHERE gmail_message_id IS NOT NULL`
    );
  } catch {
    /* index exists */
  }
  try {
    db.exec(`ALTER TABLE ticket_overlay ADD COLUMN gmail_thread_open_url TEXT`);
  } catch {
    /* column exists */
  }
  for (const column of ["linked_case_1", "linked_case_2", "linked_case_3"]) {
    try {
      db.exec(`ALTER TABLE ticket_overlay ADD COLUMN ${column} TEXT`);
    } catch {
      /* column exists */
    }
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
  try {
    db.exec(
      `ALTER TABLE ticket_overlay ADD COLUMN initial_response_sla_cleared INTEGER NOT NULL DEFAULT 0`
    );
  } catch {
    /* column exists */
  }
  try {
    db.exec(`ALTER TABLE ticket_overlay ADD COLUMN pending_reopen_hours INTEGER`);
  } catch {
    /* column exists */
  }
  try {
    db.exec(
      `ALTER TABLE ticket_overlay ADD COLUMN resolved_closed INTEGER NOT NULL DEFAULT 0`
    );
  } catch {
    /* column exists */
  }

  ensureCrmTicketEventsTable();
  try {
    db.exec(`ALTER TABLE ticket_overlay ADD COLUMN bg_gmail_sync_enabled_at TEXT`);
  } catch {
    /* column exists */
  }
  try {
    db.exec(`ALTER TABLE ticket_overlay ADD COLUMN bg_gmail_sync_last_at TEXT`);
  } catch {
    /* column exists */
  }
  try {
    db.exec(
      `ALTER TABLE ticket_overlay ADD COLUMN force_new_gmail_thread_on_send INTEGER NOT NULL DEFAULT 0`
    );
  } catch {
    /* column exists */
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS message_attachments (
      id TEXT PRIMARY KEY,
      thread_message_id TEXT NOT NULL,
      ticket_row_id TEXT NOT NULL,
      gmail_message_id TEXT NOT NULL,
      gmail_attachment_id TEXT NOT NULL,
      filename TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      size_bytes INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_attachments_message ON message_attachments(thread_message_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_attachments_gmail_part
      ON message_attachments(gmail_message_id, gmail_attachment_id);
    CREATE TABLE IF NOT EXISTS blocked_gmail_messages (
      ticket_row_id TEXT NOT NULL,
      gmail_message_id TEXT NOT NULL,
      redacted_at TEXT NOT NULL,
      original_sent_at TEXT NOT NULL,
      original_direction TEXT NOT NULL,
      PRIMARY KEY (ticket_row_id, gmail_message_id)
    );
    CREATE TABLE IF NOT EXISTS holiday_calendar_cache (
      calendar_id TEXT NOT NULL,
      date_key TEXT NOT NULL,
      PRIMARY KEY (calendar_id, date_key)
    );
    CREATE TABLE IF NOT EXISTS holiday_calendar_meta (
      calendar_id TEXT PRIMARY KEY,
      fetched_at TEXT NOT NULL
    );
  `);

  ensureTicketGmailThreadsSchema(db);
  if (!isOverlayMigrationApplied("ticket_gmail_threads_v1")) {
    migrateTicketGmailThreadsFromOverlay(db);
    markOverlayMigrationApplied("ticket_gmail_threads_v1");
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
  const storedBusinessHours = config.businessHours;
  const prepared = prepareSheetConfig(config);
  const columnsChanged =
    JSON.stringify(prepared.columns) !== JSON.stringify(config.columns);
  if (columnsChanged) {
    saveSheetConfig({
      ...prepared,
      businessHours: prepared.businessHours ?? storedBusinessHours,
      manuallyMapped: config.manuallyMapped ?? true,
    });
  }
  if (prepared.manuallyMapped) {
    return {
      ...prepared,
      businessHours: prepared.businessHours ?? storedBusinessHours,
    };
  }

  const normalized = normalizeSheetConfig(prepared);
  if (JSON.stringify(normalized.columns) !== JSON.stringify(prepared.columns)) {
    saveSheetConfig({
      ...normalized,
      businessHours: normalized.businessHours ?? storedBusinessHours,
    });
  }
  return {
    ...normalized,
    businessHours: normalized.businessHours ?? storedBusinessHours,
  };
}

export function loadCoverSheets(): CoverSheetEntry[] {
  const row = getDb()
    .prepare("SELECT config_json FROM sheet_config WHERE id = ?")
    .get(COVER_SHEETS_STORE_ID) as { config_json: string } | undefined;
  if (!row) return normalizeCoverSheetEntries(null);
  try {
    const parsed = JSON.parse(row.config_json) as { entries?: CoverSheetEntry[] };
    return normalizeCoverSheetEntries(parsed.entries);
  } catch {
    return normalizeCoverSheetEntries(null);
  }
}

export function saveCoverSheets(entries: CoverSheetEntry[]): CoverSheetEntry[] {
  const normalized = normalizeCoverSheetEntries(entries);
  const d = getDb();
  d.prepare(
    `INSERT INTO sheet_config (id, config_json, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET config_json = excluded.config_json, updated_at = excluded.updated_at`
  ).run(
    COVER_SHEETS_STORE_ID,
    JSON.stringify({ entries: normalized }),
    new Date().toISOString()
  );
  return normalized;
}

export function resolveSheetConfigForRowId(
  rowId: string,
  defaultConfig: SheetConfig | null = loadSheetConfig("default")
): SheetConfig | null {
  return resolveSheetConfigForTicket(rowId, defaultConfig, loadCoverSheets());
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
  /** Weekday hours until auto-reopen when set via Set to Pending (no email). */
  pendingReopenHours: number | null;
  /** True when resolved via Resolve & Close — blocks auto-reopen and background Gmail polling. */
  resolvedClosed: boolean;
  slaHours: number;
  slaDueAt: string | null;
  crmAirbnbUserId: string | null;
  airbnbUserIdSource: AirbnbUserIdSource;
  initialResponseSlaCleared: boolean;
  linkedCases: [string, string, string];
  exists: boolean;
}

function readOverlayRow(rowId: string): TicketOverlay {
  const row = getDb()
    .prepare(
      "SELECT status, status_source, sheet_status, crm_subject, admin_notes, admin_notes_source, sheet_case_summary, gmail_thread_id, gmail_thread_open_url, contact_reason, contact_reason_source, status_changed_at, pending_reopen_hours, resolved_closed, sla_hours, sla_due_at, crm_airbnb_user_id, airbnb_user_id_source, initial_response_sla_cleared, linked_case_1, linked_case_2, linked_case_3 FROM ticket_overlay WHERE row_id = ?"
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
        gmail_thread_open_url: string | null;
        contact_reason: string | null;
        contact_reason_source: string;
        status_changed_at: string | null;
        pending_reopen_hours: number | null;
        resolved_closed: number;
        sla_hours: number;
        sla_due_at: string | null;
        crm_airbnb_user_id: string | null;
        airbnb_user_id_source: string;
        initial_response_sla_cleared: number;
        linked_case_1: string | null;
        linked_case_2: string | null;
        linked_case_3: string | null;
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
      pendingReopenHours: null,
      resolvedClosed: false,
      slaHours: DEFAULT_TIMER_SETTINGS.defaultSlaHours,
      slaDueAt: null,
      crmAirbnbUserId: null,
      airbnbUserIdSource: "sheet",
      initialResponseSlaCleared: false,
      linkedCases: ["", "", ""],
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
    pendingReopenHours: row.pending_reopen_hours,
    resolvedClosed: row.resolved_closed === 1,
    slaHours: row.sla_hours,
    slaDueAt: row.sla_due_at,
    crmAirbnbUserId: row.crm_airbnb_user_id,
    airbnbUserIdSource,
    initialResponseSlaCleared: row.initial_response_sla_cleared === 1,
    linkedCases: [
      row.linked_case_1?.trim() ?? "",
      row.linked_case_2?.trim() ?? "",
      row.linked_case_3?.trim() ?? "",
    ],
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
  initialResponseSlaCleared: boolean;
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
      `INSERT INTO ticket_overlay (row_id, status, status_source, sheet_status, crm_subject, admin_notes, admin_notes_source, sheet_case_summary, gmail_thread_id, contact_reason, contact_reason_source, status_changed_at, sla_hours, sla_due_at, crm_airbnb_user_id, airbnb_user_id_source, initial_response_sla_cleared, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
         initial_response_sla_cleared = excluded.initial_response_sla_cleared,
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
      merged.initialResponseSlaCleared ? 1 : 0,
      now
    );
}

export function getLatestInboundMessageAt(ticketRowId: string): string | null {
  const row = getDb()
    .prepare(
      `SELECT MAX(sent_at) AS sent_at FROM thread_messages
       WHERE ticket_row_id = ? AND direction = 'inbound'`
    )
    .get(ticketRowId) as { sent_at: string | null } | undefined;
  return row?.sent_at ?? null;
}

/** Recompute Response SLA from the customer's last message (or intake) while Open. */
export function refreshResponseSlaDueAt(
  rowId: string,
  intakeTimestamp: string,
  timerSettings: TimerSettings = DEFAULT_TIMER_SETTINGS
): string | null {
  const existing = readOverlayRow(rowId);
  const latest = getLatestConversationActivity(rowId);

  if (
    !isResponseSlaEligibleStatus(existing.status) ||
    !shouldShowResponseSla({ status: existing.status }, latest?.direction ?? null)
  ) {
    if (existing.slaDueAt) {
      upsertOverlayRow(rowId, overlayFields(existing), { slaDueAt: null });
    }
    return null;
  }

  const anchor = resolveResponseSlaAnchor(
    getLatestInboundMessageAt(rowId),
    intakeTimestamp
  );
  if (!anchor) return null;

  const slaHours = existing.slaHours || timerSettings.defaultSlaHours;
  const slaDueAt = computeResponseSlaDueAt(anchor, slaHours);
  upsertOverlayRow(rowId, overlayFields(existing), { slaDueAt });
  return slaDueAt;
}

function setOverlayPendingReopenHours(rowId: string, hours: number | null): void {
  getDb()
    .prepare(
      `UPDATE ticket_overlay SET pending_reopen_hours = ?, updated_at = ? WHERE row_id = ?`
    )
    .run(hours, new Date().toISOString(), rowId);
}

function setOverlayResolvedClosed(rowId: string, closed: boolean): void {
  getDb()
    .prepare(
      `UPDATE ticket_overlay SET resolved_closed = ?, updated_at = ? WHERE row_id = ?`
    )
    .run(closed ? 1 : 0, new Date().toISOString(), rowId);
}

/** Start background Gmail polling when a ticket is newly marked pending or resolved. */
export function enableBackgroundGmailSync(rowId: string): void {
  const now = new Date().toISOString();
  getDb()
    .prepare(
      `UPDATE ticket_overlay
       SET bg_gmail_sync_enabled_at = ?, bg_gmail_sync_last_at = NULL, updated_at = ?
       WHERE row_id = ?`
    )
    .run(now, now, rowId);
}

/** Enroll pending/resolved tickets that predate background sync or were set via the sheet. */
export function ensureBackgroundGmailSyncEnabled(rowId: string): boolean {
  if (getBackgroundGmailSyncSchedule(rowId)) return false;
  enableBackgroundGmailSync(rowId);
  return true;
}

/** Stop background Gmail polling when a ticket leaves pending/resolved. */
export function disableBackgroundGmailSync(rowId: string): void {
  getDb()
    .prepare(
      `UPDATE ticket_overlay
       SET bg_gmail_sync_enabled_at = NULL, bg_gmail_sync_last_at = NULL, updated_at = ?
       WHERE row_id = ?`
    )
    .run(new Date().toISOString(), rowId);
}

export function markBackgroundGmailSyncAttempt(rowId: string): void {
  const now = new Date().toISOString();
  getDb()
    .prepare(
      `UPDATE ticket_overlay SET bg_gmail_sync_last_at = ?, updated_at = ? WHERE row_id = ?`
    )
    .run(now, now, rowId);
}

export function getBackgroundGmailSyncSchedule(
  rowId: string
): { enabledAt: string; lastAt: string | null } | null {
  const row = getDb()
    .prepare(
      `SELECT bg_gmail_sync_enabled_at, bg_gmail_sync_last_at
       FROM ticket_overlay WHERE row_id = ?`
    )
    .get(rowId) as
    | { bg_gmail_sync_enabled_at: string | null; bg_gmail_sync_last_at: string | null }
    | undefined;

  if (!row?.bg_gmail_sync_enabled_at) return null;
  return {
    enabledAt: row.bg_gmail_sync_enabled_at,
    lastAt: row.bg_gmail_sync_last_at,
  };
}

function syncBackgroundGmailSyncForTicket(
  rowId: string,
  status: string,
  resolvedClosed: boolean
): void {
  const next = normalizeStatusId(status);
  if (next === "pending") {
    enableBackgroundGmailSync(rowId);
    return;
  }
  if (next === "resolved" && !resolvedClosed) {
    if (ticketGmailLinkIsArchived(rowId)) return;
    if (!ticketHasExplicitGmailLink(rowId)) return;
    enableBackgroundGmailSync(rowId);
    return;
  }
  disableBackgroundGmailSync(rowId);
}

function applyBackgroundGmailSyncEligibility(
  rowId: string,
  previousStatus: string,
  nextStatus: string,
  resolvedClosed: boolean
): void {
  const prev = normalizeStatusId(previousStatus);
  const next = normalizeStatusId(nextStatus);
  if (prev === next && next !== "resolved") return;
  syncBackgroundGmailSyncForTicket(rowId, nextStatus, resolvedClosed);
}

export function updateTicketStatus(
  rowId: string,
  status: string,
  timerSettings: TimerSettings = DEFAULT_TIMER_SETTINGS,
  intakeTimestamp?: string,
  options?: { pendingReopenHours?: number | null; skipEventLog?: boolean; resolvedClosed?: boolean }
): { statusChangedAt: string | null; slaDueAt: string | null } {
  const existing = readOverlayRow(rowId);
  const normalizedStatus = normalizeStatusId(status);
  const now = new Date().toISOString();
  let statusChangedAt = existing.statusChangedAt;
  let slaDueAt = existing.slaDueAt;
  let nextPendingReopenHours: number | null = existing.pendingReopenHours;
  let nextResolvedClosed = existing.resolvedClosed;

  if (normalizedStatus === "resolved" || normalizedStatus === "solved") {
    if (options?.resolvedClosed === true) {
      nextResolvedClosed = true;
    } else if (options?.resolvedClosed === false) {
      nextResolvedClosed = false;
    } else if (normalizeStatusId(existing.status) !== "resolved") {
      nextResolvedClosed = false;
    }
  } else {
    nextResolvedClosed = false;
  }

  if (normalizedStatus === "pending" || normalizedStatus === "longterm_hold") {
    statusChangedAt = now;
    slaDueAt = null;
    if (normalizedStatus === "pending" && options?.pendingReopenHours !== undefined) {
      nextPendingReopenHours = options.pendingReopenHours;
    } else if (normalizedStatus === "pending") {
      nextPendingReopenHours = null;
    } else {
      nextPendingReopenHours = null;
    }
  } else if (
    normalizedStatus === "open" &&
    (existing.status === "pending" || existing.status === "longterm_hold")
  ) {
    statusChangedAt = null;
    nextPendingReopenHours = null;
  } else if (
    normalizedStatus === "resolved" ||
    normalizedStatus === "solved" ||
    normalizedStatus === "do_not_action"
  ) {
    statusChangedAt = null;
    slaDueAt = null;
    nextPendingReopenHours = null;
  }

  const sheetStatus = mapCrmStatusToSheetValue(normalizedStatus);
  upsertOverlayRow(rowId, overlayFields(existing), {
    status: normalizedStatus,
    statusSource: "crm",
    statusChangedAt,
    sheetStatus: sheetStatus ?? existing.sheetStatus,
    slaDueAt,
  });
  setOverlayPendingReopenHours(rowId, nextPendingReopenHours);
  setOverlayResolvedClosed(rowId, nextResolvedClosed);

  if (intakeTimestamp && isResponseSlaEligibleStatus(normalizedStatus)) {
    slaDueAt = refreshResponseSlaDueAt(rowId, intakeTimestamp, timerSettings);
  }

  if (normalizedStatus !== existing.status) {
    const previousNormalized = normalizeStatusId(existing.status);
    const closedStatuses = new Set(["resolved", "do_not_action"]);
    if (closedStatuses.has(normalizedStatus) && !closedStatuses.has(previousNormalized)) {
      markTicketResolvedNow(rowId, now);
    } else if (
      closedStatuses.has(previousNormalized) &&
      !closedStatuses.has(normalizedStatus)
    ) {
      clearTicketResolvedAt(rowId);
    }
    applyBackgroundGmailSyncEligibility(
      rowId,
      existing.status,
      normalizedStatus,
      nextResolvedClosed
    );
    const detail: Record<string, unknown> = {
      from: existing.status,
      to: normalizedStatus,
    };
    if (normalizedStatus === "pending") {
      detail.pendingReopenHours = nextPendingReopenHours;
      detail.timer = describePendingReopenTimer(
        nextPendingReopenHours,
        timerSettings,
        workspaceBusinessHours()
      );
      if (statusChangedAt) detail.statusChangedAt = statusChangedAt;
    }
    if (!options?.skipEventLog) {
      logCrmTicketEvent({
        ticketRowId: rowId,
        kind: normalizedStatus === "pending" ? "pending_timer" : "status_change",
        summary:
          normalizedStatus === "pending"
            ? `Set to Pending (${describePendingReopenTimer(nextPendingReopenHours, timerSettings, workspaceBusinessHours())})`
            : `Status changed to ${crmStatusLabel(normalizedStatus)}`,
        detail,
      });
    }
  } else if (
    nextResolvedClosed !== existing.resolvedClosed &&
    normalizeStatusId(normalizedStatus) === "resolved"
  ) {
    syncBackgroundGmailSyncForTicket(rowId, normalizedStatus, nextResolvedClosed);
  }

  return { statusChangedAt, slaDueAt };
}

/** Resolve a teammate cover ticket in CRM only — never writes to their sheet. */
export function ignoreCoverTicket(
  rowId: string,
  timerSettings: TimerSettings = DEFAULT_TIMER_SETTINGS
): { status: string; statusChangedAt: string | null; slaDueAt: string | null } {
  const existing = readOverlayRow(rowId);
  if (normalizeStatusId(existing.status) === "resolved") {
    return {
      status: "resolved",
      statusChangedAt: existing.statusChangedAt,
      slaDueAt: existing.slaDueAt,
    };
  }
  const { statusChangedAt, slaDueAt } = updateTicketStatus(rowId, "resolved", timerSettings, undefined, {
    skipEventLog: true,
    resolvedClosed: true,
  });
  logCrmTicketEvent({
    ticketRowId: rowId,
    kind: "cover_ignore",
    summary: "Ignored cover ticket (CRM resolved, sheet unchanged)",
    detail: { status: "resolved" },
  });
  return { status: "resolved", statusChangedAt, slaDueAt };
}

export function updateTicketAirbnbUserId(rowId: string, userId: string): void {
  const existing = readOverlayRow(rowId);
  const trimmed = userId.trim();
  if (!trimmed) {
    upsertOverlayRow(rowId, overlayFields(existing), {
      crmAirbnbUserId: null,
      airbnbUserIdSource: "sheet",
    });
    return;
  }
  upsertOverlayRow(rowId, overlayFields(existing), {
    crmAirbnbUserId: trimmed,
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

export function appendAdminNoteToOverlay(rowId: string, noteText: string): string {
  const existing = readOverlayRow(rowId);
  const base =
    existing.adminNotesSource === "crm" && existing.adminNotes
      ? existing.adminNotes
      : existing.adminNotes || existing.sheetCaseSummary || "";
  const updated = appendAdminNoteToText(base, noteText);
  upsertOverlayRow(rowId, overlayFields(existing), {
    adminNotes: updated,
    adminNotesSource: "crm",
    sheetCaseSummary: updated,
  });
  return updated;
}

/** Record a manually added admin note in the conversation timeline. */
export function addAdminNoteThreadMessage(
  rowId: string,
  noteText: string,
  author?: string
): ThreadMessage {
  const sentAt = new Date();
  const message: ThreadMessage = {
    id: uuidv4(),
    ticketRowId: rowId,
    direction: "admin_note",
    from: author?.trim() || "Admin",
    to: "",
    cc: null,
    subject: "Admin note",
    body: noteText.trim(),
    gmailMessageId: null,
    gmailThreadId: null,
    sentAt: sentAt.toISOString(),
  };
  addThreadMessage(message);
  return message;
}

export function updateTicketSubject(rowId: string, subject: string): void {
  const existing = readOverlayRow(rowId);
  upsertOverlayRow(rowId, overlayFields(existing), { crmSubject: subject.trim() || null });
}

export function updateTicketLinkedCase(
  rowId: string,
  index: 0 | 1 | 2,
  value: string
): void {
  const existing = readOverlayRow(rowId);
  if (!existing.exists) {
    upsertOverlayRow(rowId, overlayFields(existing), {});
  }
  const column =
    index === 0 ? "linked_case_1" : index === 1 ? "linked_case_2" : "linked_case_3";
  const trimmed = value.trim();
  getDb()
    .prepare(
      `UPDATE ticket_overlay SET ${column} = ?, updated_at = ? WHERE row_id = ?`
    )
    .run(trimmed || null, new Date().toISOString(), rowId);
}

export function updateTicketSla(
  rowId: string,
  slaHours: number,
  intakeTimestamp: string,
  timerSettings: TimerSettings = DEFAULT_TIMER_SETTINGS
): string | null {
  const existing = readOverlayRow(rowId);
  if (!isResponseSlaEligibleStatus(existing.status)) {
    if (existing.slaDueAt) {
      upsertOverlayRow(rowId, overlayFields(existing), { slaDueAt: null });
    }
    return null;
  }
  const previousHours = existing.slaHours;
  upsertOverlayRow(rowId, overlayFields(existing), { slaHours });
  const slaDueAt = refreshResponseSlaDueAt(rowId, intakeTimestamp, timerSettings);
  if (previousHours !== slaHours) {
    logCrmTicketEvent({
      ticketRowId: rowId,
      kind: "sla_change",
      summary: `Response SLA set to ${slaHours}h`,
      detail: { fromHours: previousHours, toHours: slaHours, slaDueAt },
    });
  }
  return slaDueAt;
}

export function clearInitialResponseSla(rowId: string): void {
  const existing = readOverlayRow(rowId);
  upsertOverlayRow(rowId, overlayFields(existing), { initialResponseSlaCleared: true });
}

export function isOverlayMigrationApplied(id: string): boolean {
  const row = getDb()
    .prepare("SELECT id FROM overlay_migrations WHERE id = ?")
    .get(id) as { id: string } | undefined;
  return Boolean(row);
}

export function markOverlayMigrationApplied(id: string): void {
  getDb()
    .prepare(
      `INSERT INTO overlay_migrations (id, applied_at) VALUES (?, ?)
       ON CONFLICT(id) DO NOTHING`
    )
    .run(id, new Date().toISOString());
}

/** Set the initial-response SLA cleared flag without overwriting other overlay fields. */
export function bulkSetInitialResponseSlaCleared(rowIds: string[]): number {
  if (rowIds.length === 0) return 0;

  const now = new Date().toISOString();
  const stmt = getDb().prepare(
    `INSERT INTO ticket_overlay (
       row_id, status, status_source, admin_notes_source, contact_reason_source,
       sla_hours, initial_response_sla_cleared, updated_at
     ) VALUES (?, 'new', 'sheet', 'sheet', 'sheet', ?, 1, ?)
     ON CONFLICT(row_id) DO UPDATE SET
       initial_response_sla_cleared = 1,
       updated_at = excluded.updated_at`
  );

  const transaction = getDb().transaction((ids: string[]) => {
    for (const rowId of ids) {
      stmt.run(rowId, DEFAULT_TIMER_SETTINGS.defaultSlaHours, now);
    }
  });
  transaction(rowIds);
  return rowIds.length;
}

/** Ticket row IDs where the >48h initial-response SLA was manually cleared. */
export function getInitialResponseSlaClearedTicketIds(): Set<string> {
  const rows = getDb()
    .prepare(
      `SELECT row_id FROM ticket_overlay WHERE initial_response_sla_cleared = 1`
    )
    .all() as Array<{ row_id: string }>;
  return new Set(rows.map((r) => r.row_id));
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
    initialResponseSlaCleared: existing.initialResponseSlaCleared,
  };
}

export function getTicketGmailThreadId(ticketRowId: string): string | null {
  return readOverlayRow(ticketRowId).gmailThreadId;
}

/** Stored Gmail open URL for a ticket (overlay open URL or thread id fallback). */
export function resolveTicketGmailOpenUrl(ticketRowId: string): string | null {
  const openUrl = getGmailThreadOpenUrl(ticketRowId);
  if (openUrl?.trim()) return openUrl.trim();
  const threadId = getTicketGmailThreadId(ticketRowId);
  return threadId ? buildGmailConversationUrl(threadId) : null;
}

export function getGmailThreadOpenUrl(ticketRowId: string): string | null {
  const row = getDb()
    .prepare("SELECT gmail_thread_open_url FROM ticket_overlay WHERE row_id = ?")
    .get(ticketRowId) as { gmail_thread_open_url: string | null } | undefined;
  return row?.gmail_thread_open_url ?? null;
}

export function getTicketRowIdForGmailThread(threadId: string): string | null {
  const trimmed = threadId.trim();
  if (!trimmed) return null;
  const fromJunction = getTicketRowIdForLinkedGmailThread(getDb(), trimmed);
  if (fromJunction) return fromJunction;
  const row = getDb()
    .prepare("SELECT row_id FROM ticket_overlay WHERE gmail_thread_id = ?")
    .get(trimmed) as { row_id: string } | undefined;
  return row?.row_id ?? null;
}

/** Bind one Gmail thread to one ticket (primary). Returns false if thread belongs to another ticket. */
export function claimGmailThreadForTicket(
  ticketRowId: string,
  threadId: string,
  options?: { replace?: boolean }
): boolean {
  const trimmed = threadId.trim();
  if (!trimmed) return false;

  const owner = getTicketRowIdForGmailThread(trimmed);
  if (owner && owner !== ticketRowId) return false;

  const db = getDb();
  const primary = getPrimaryGmailThreadLink(db, ticketRowId);
  if (primary && primary.gmailThreadId !== trimmed) {
    const hasValidApiThreadId = Boolean(
      primary.gmailThreadId && isGmailApiThreadId(primary.gmailThreadId)
    );
    if (!options?.replace && hasValidApiThreadId && getGmailThreadOpenUrl(ticketRowId)) {
      return false;
    }
  }

  const result = addGmailThreadToTicket(db, {
    ticketRowId,
    threadId: trimmed,
    openUrl: buildGmailConversationUrl(trimmed),
    isPrimary: true,
  });
  return result.ok;
}

export function getGmailThreadImportCutoff(ticketRowId: string): string | null {
  const primary = getPrimaryGmailThreadLink(getDb(), ticketRowId);
  if (primary) return primary.linkedAt;
  const row = getDb()
    .prepare("SELECT gmail_thread_linked_at FROM ticket_overlay WHERE row_id = ?")
    .get(ticketRowId) as { gmail_thread_linked_at: string | null } | undefined;
  return row?.gmail_thread_linked_at ?? null;
}

export function getGmailThreadImportCutoffForThread(
  ticketRowId: string,
  threadId: string
): string | null {
  return (
    getGmailThreadLinkedAt(getDb(), ticketRowId, threadId) ??
    getGmailThreadImportCutoff(ticketRowId)
  );
}

export function getLinkedGmailThreadsForTicket(ticketRowId: string) {
  return listTicketGmailThreads(getDb(), ticketRowId);
}

export function getLinkedGmailThreadIdsForTicket(ticketRowId: string): string[] {
  return getLinkedGmailThreadIds(getDb(), ticketRowId);
}

/** True when this ticket has a Gmail link stored in overlay (manual link or CRM send claim). */
export function ticketHasExplicitGmailLink(ticketRowId: string): boolean {
  if (ticketForceNewGmailThreadOnSend(ticketRowId)) return false;
  if (ticketHasAnyGmailThreadLink(getDb(), ticketRowId)) return true;

  const overlay = readOverlayRow(ticketRowId);
  return Boolean(
    overlay.gmailThreadId || getGmailThreadOpenUrl(ticketRowId) || getGmailThreadImportCutoff(ticketRowId)
  );
}

export function ticketForceNewGmailThreadOnSend(ticketRowId: string): boolean {
  const row = getDb()
    .prepare(`SELECT force_new_gmail_thread_on_send FROM ticket_overlay WHERE row_id = ?`)
    .get(ticketRowId) as { force_new_gmail_thread_on_send: number } | undefined;
  return row?.force_new_gmail_thread_on_send === 1;
}

export function setForceNewGmailThreadOnSend(ticketRowId: string, enabled: boolean): void {
  const existing = readOverlayRow(ticketRowId);
  if (!existing.exists) {
    upsertOverlayRow(ticketRowId, overlayFields(existing), {});
  }
  getDb()
    .prepare(
      `UPDATE ticket_overlay
       SET force_new_gmail_thread_on_send = ?, updated_at = ?
       WHERE row_id = ?`
    )
    .run(enabled ? 1 : 0, new Date().toISOString(), ticketRowId);
}

export function clearForceNewGmailThreadOnSend(ticketRowId: string): void {
  setForceNewGmailThreadOnSend(ticketRowId, false);
}

function clearImportedGmailMessagesForTicket(ticketRowId: string): number {
  const rows = getDb()
    .prepare(
      `SELECT id, gmail_message_id, direction, sent_at
       FROM thread_messages
       WHERE ticket_row_id = ?
         AND direction IN ('inbound', 'outbound')
         AND (gmail_message_id IS NOT NULL OR gmail_thread_id IS NOT NULL)`
    )
    .all(ticketRowId) as Array<{
    id: string;
    gmail_message_id: string | null;
    direction: string;
    sent_at: string;
  }>;

  if (rows.length === 0) return 0;

  const now = new Date().toISOString();
  const blockStmt = getDb().prepare(
    `INSERT INTO blocked_gmail_messages (
       ticket_row_id, gmail_message_id, redacted_at, original_sent_at, original_direction
     ) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(ticket_row_id, gmail_message_id) DO UPDATE SET
       redacted_at = excluded.redacted_at,
       original_sent_at = excluded.original_sent_at,
       original_direction = excluded.original_direction`
  );

  const transaction = getDb().transaction((messageRows: typeof rows) => {
    for (const row of messageRows) {
      const gmailMessageId = row.gmail_message_id?.trim();
      if (gmailMessageId) {
        blockStmt.run(ticketRowId, gmailMessageId, now, row.sent_at, row.direction);
      }
      deleteThreadMessageAndAttachments(row.id);
    }
  });
  transaction(rows);
  return rows.length;
}

/**
 * Clear a mistaken Gmail link, remove imported thread messages, and require the next
 * outbound send to start a fresh Gmail thread (no auto-link until then).
 */
export function resetGmailThreadForNewOutbound(
  ticketRowId: string
): { ok: true; removedMessageCount: number } | { ok: false; error: string } {
  const existing = readOverlayRow(ticketRowId);
  const existingOpenUrl = getGmailThreadOpenUrl(ticketRowId);
  const hadLink = Boolean(existing.gmailThreadId || existingOpenUrl);
  const removedMessageCount = clearImportedGmailMessagesForTicket(ticketRowId);

  if (!hadLink && removedMessageCount === 0 && !ticketForceNewGmailThreadOnSend(ticketRowId)) {
    return { ok: false, error: "No Gmail thread is linked to this ticket" };
  }

  if (!existing.exists) {
    upsertOverlayRow(ticketRowId, overlayFields(existing), {});
  }

  const now = new Date().toISOString();
  getDb().prepare(`DELETE FROM ticket_gmail_threads WHERE ticket_row_id = ?`).run(ticketRowId);
  getDb()
    .prepare(
      `UPDATE ticket_overlay
       SET gmail_thread_id = NULL,
           gmail_thread_open_url = NULL,
           gmail_thread_linked_at = NULL,
           force_new_gmail_thread_on_send = 1,
           updated_at = ?
       WHERE row_id = ?`
    )
    .run(now, ticketRowId);

  clearGmailLinkArchivedAt(ticketRowId);

  updateTicketSubject(ticketRowId, "");

  const resetAt = new Date();
  addThreadMessage({
    id: uuidv4(),
    ticketRowId,
    direction: "system",
    from: "SheetsCRM",
    to: "",
    cc: null,
    subject: "Gmail link cleared for new thread",
    body: buildGmailResetForNewThreadBody(resetAt),
    gmailMessageId: null,
    gmailThreadId: null,
    sentAt: resetAt.toISOString(),
  });

  logCrmTicketEvent({
    ticketRowId,
    kind: "gmail_thread_reset",
    summary: "Gmail link cleared — next send starts a new thread",
    detail: { removedMessageCount },
  });

  return { ok: true, removedMessageCount };
}

export function unlinkGmailThread(
  ticketRowId: string
): { ok: true } | { ok: false; error: string } {
  const existing = readOverlayRow(ticketRowId);
  const existingOpenUrl = getGmailThreadOpenUrl(ticketRowId);
  if (!existing.gmailThreadId && !existingOpenUrl) {
    return { ok: false, error: "No Gmail thread is linked to this ticket" };
  }

  const now = new Date().toISOString();
  getDb().prepare(`DELETE FROM ticket_gmail_threads WHERE ticket_row_id = ?`).run(ticketRowId);
  getDb()
    .prepare(
      `UPDATE ticket_overlay
       SET gmail_thread_id = NULL,
           gmail_thread_open_url = NULL,
           gmail_thread_linked_at = NULL,
           updated_at = ?
       WHERE row_id = ?`
    )
    .run(now, ticketRowId);

  return { ok: true };
}

export function linkExistingGmailThread(
  ticketRowId: string,
  params: { threadId: string; openUrl: string; replace?: boolean; append?: boolean }
):
  | { ok: true; message: ThreadMessage | null; openUrl: string; appended?: boolean }
  | { ok: false; error: string; linkedTicketRowId?: string } {
  const trimmed = params.threadId.trim();
  const openUrl = params.openUrl.trim();
  if (!trimmed) return { ok: false, error: "Gmail thread ID is required" };
  if (!openUrl) return { ok: false, error: "Gmail open URL is required" };

  const db = getDb();
  const existing = readOverlayRow(ticketRowId);
  const existingOpenUrl = getGmailThreadOpenUrl(ticketRowId);
  const hasExistingLink =
    ticketHasAnyGmailThreadLink(db, ticketRowId) ||
    Boolean(existing.gmailThreadId || existingOpenUrl);
  const appending = Boolean(params.append && hasExistingLink);
  const replacing = Boolean(params.replace && hasExistingLink && !appending);

  if (isGmailThreadLinkedToTicket(db, ticketRowId, trimmed)) {
    return {
      ok: true,
      message: null,
      openUrl: resolveTicketGmailOpenUrl(ticketRowId) ?? existingOpenUrl ?? openUrl,
    };
  }

  if (hasExistingLink && !replacing && !appending) {
    return {
      ok: false,
      error:
        "This ticket is already linked — use Append to add another thread or Change link to replace the primary thread",
    };
  }

  const linkedAt = new Date();
  const linkedAtIso = linkedAt.toISOString();

  if (replacing) {
    const oldPrimary = getPrimaryGmailThreadLink(db, ticketRowId);
    if (oldPrimary) {
      db.prepare(`DELETE FROM ticket_gmail_threads WHERE id = ?`).run(oldPrimary.id);
    }
  }

  if (appending) {
    const added = addGmailThreadToTicket(db, {
      ticketRowId,
      threadId: trimmed,
      openUrl,
      isPrimary: false,
      linkedAt: linkedAtIso,
    });
    if (!added.ok) {
      if (added.linkedTicketRowId) {
        return {
          ok: false,
          error: added.error,
          linkedTicketRowId: added.linkedTicketRowId,
        };
      }
      return { ok: false, error: added.error };
    }

    clearGmailLinkArchivedAt(ticketRowId);
    if (normalizeStatusId(existing.status) === "resolved" && !existing.resolvedClosed) {
      enableBackgroundGmailSync(ticketRowId);
    }

    const message: ThreadMessage = {
      id: uuidv4(),
      ticketRowId,
      direction: "system",
      from: "SheetsCRM",
      to: "",
      cc: null,
      subject: "Additional Gmail thread linked",
      body: buildThreadAppendNoticeBody(linkedAt),
      gmailMessageId: null,
      gmailThreadId: null,
      sentAt: linkedAtIso,
    };
    addThreadMessage(message);

    return {
      ok: true,
      message,
      openUrl: resolveTicketGmailOpenUrl(ticketRowId) ?? existingOpenUrl ?? openUrl,
      appended: true,
    };
  }

  const added = addGmailThreadToTicket(db, {
    ticketRowId,
    threadId: trimmed,
    openUrl,
    isPrimary: true,
    linkedAt: linkedAtIso,
  });
  if (!added.ok) {
    if (added.linkedTicketRowId) {
      return {
        ok: false,
        error: added.error,
        linkedTicketRowId: added.linkedTicketRowId,
      };
    }
    return { ok: false, error: added.error };
  }

  db.prepare(
    `UPDATE ticket_overlay
     SET gmail_thread_linked_at = ?, gmail_thread_open_url = ?, updated_at = ?
     WHERE row_id = ?`
  ).run(linkedAtIso, openUrl, linkedAtIso, ticketRowId);

  clearGmailLinkArchivedAt(ticketRowId);
  if (normalizeStatusId(existing.status) === "resolved" && !existing.resolvedClosed) {
    enableBackgroundGmailSync(ticketRowId);
  }

  let message: ThreadMessage | null = null;
  if (!replacing) {
    message = {
      id: uuidv4(),
      ticketRowId,
      direction: "system",
      from: "SheetsCRM",
      to: "",
      cc: null,
      subject: "Gmail thread linked",
      body: buildThreadLinkNoticeBody(linkedAt),
      gmailMessageId: null,
      gmailThreadId: null,
      sentAt: linkedAtIso,
    };
    addThreadMessage(message);
  } else {
    message = {
      id: uuidv4(),
      ticketRowId,
      direction: "system",
      from: "SheetsCRM",
      to: "",
      cc: null,
      subject: "Gmail thread link updated",
      body: buildThreadLinkUpdatedBody(linkedAt),
      gmailMessageId: null,
      gmailThreadId: null,
      sentAt: linkedAtIso,
    };
    addThreadMessage(message);
  }

  return {
    ok: true,
    message,
    openUrl: resolveTicketGmailOpenUrl(ticketRowId) ?? openUrl,
  };
}

export interface MessageAttachmentInput {
  gmailAttachmentId: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
}

function mapAttachmentRow(row: {
  id: string;
  thread_message_id: string;
  ticket_row_id: string;
  gmail_message_id: string;
  gmail_attachment_id: string;
  filename: string;
  mime_type: string;
  size_bytes: number;
}): ThreadMessageAttachment {
  return {
    id: row.id,
    threadMessageId: row.thread_message_id,
    ticketRowId: row.ticket_row_id,
    gmailMessageId: row.gmail_message_id,
    gmailAttachmentId: row.gmail_attachment_id,
    filename: row.filename,
    mimeType: row.mime_type,
    sizeBytes: row.size_bytes,
  };
}

function loadAttachmentsForMessages(messages: ThreadMessage[]): ThreadMessage[] {
  if (messages.length === 0) return messages;

  const ids = messages.map((m) => m.id);
  const placeholders = ids.map(() => "?").join(",");
  const rows = getDb()
    .prepare(
      `SELECT * FROM message_attachments
       WHERE thread_message_id IN (${placeholders})
       ORDER BY filename ASC`
    )
    .all(...ids) as Array<{
    id: string;
    thread_message_id: string;
    ticket_row_id: string;
    gmail_message_id: string;
    gmail_attachment_id: string;
    filename: string;
    mime_type: string;
    size_bytes: number;
  }>;

  const byMessage = new Map<string, ThreadMessageAttachment[]>();
  for (const row of rows) {
    const list = byMessage.get(row.thread_message_id) ?? [];
    list.push(mapAttachmentRow(row));
    byMessage.set(row.thread_message_id, list);
  }

  return messages.map((m) => ({
    ...m,
    attachments: byMessage.get(m.id) ?? [],
  }));
}

export function getThreadMessageIdByGmailMessageId(
  ticketRowId: string,
  gmailMessageId: string
): string | null {
  const row = getDb()
    .prepare(
      `SELECT id FROM thread_messages WHERE ticket_row_id = ? AND gmail_message_id = ?`
    )
    .get(ticketRowId, gmailMessageId) as { id: string } | undefined;
  return row?.id ?? null;
}

export function replaceMessageAttachments(params: {
  threadMessageId: string;
  ticketRowId: string;
  gmailMessageId: string;
  attachments: MessageAttachmentInput[];
}): void {
  const db = getDb();

  // Preserve row IDs across syncs so in-memory download links stay valid.
  // (Thread UI equality skips attachment ids; regenerating UUIDs caused 404 downloads.)
  const existing = db
    .prepare(
      `SELECT id, gmail_attachment_id FROM message_attachments WHERE thread_message_id = ?`
    )
    .all(params.threadMessageId) as Array<{ id: string; gmail_attachment_id: string }>;
  const existingByGmailId = new Map(
    existing.map((row) => [row.gmail_attachment_id, row.id])
  );

  const keepIds: string[] = [];
  const insert = db.prepare(
    `INSERT INTO message_attachments
      (id, thread_message_id, ticket_row_id, gmail_message_id, gmail_attachment_id, filename, mime_type, size_bytes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const update = db.prepare(
    `UPDATE message_attachments
     SET ticket_row_id = ?, gmail_message_id = ?, filename = ?, mime_type = ?, size_bytes = ?
     WHERE id = ? AND thread_message_id = ?`
  );

  for (const att of params.attachments) {
    const existingId = existingByGmailId.get(att.gmailAttachmentId);
    if (existingId) {
      update.run(
        params.ticketRowId,
        params.gmailMessageId,
        att.filename,
        att.mimeType,
        att.sizeBytes,
        existingId,
        params.threadMessageId
      );
      keepIds.push(existingId);
      continue;
    }

    const id = uuidv4();
    insert.run(
      id,
      params.threadMessageId,
      params.ticketRowId,
      params.gmailMessageId,
      att.gmailAttachmentId,
      att.filename,
      att.mimeType,
      att.sizeBytes
    );
    keepIds.push(id);
  }

  if (keepIds.length === 0) {
    db.prepare(`DELETE FROM message_attachments WHERE thread_message_id = ?`).run(
      params.threadMessageId
    );
    return;
  }

  const placeholders = keepIds.map(() => "?").join(",");
  db.prepare(
    `DELETE FROM message_attachments
     WHERE thread_message_id = ? AND id NOT IN (${placeholders})`
  ).run(params.threadMessageId, ...keepIds);
}
export function getMessageAttachmentById(
  attachmentId: string,
  ticketRowId: string
): ThreadMessageAttachment | null {
  const row = getDb()
    .prepare(`SELECT * FROM message_attachments WHERE id = ? AND ticket_row_id = ?`)
    .get(attachmentId, ticketRowId) as
    | {
        id: string;
        thread_message_id: string;
        ticket_row_id: string;
        gmail_message_id: string;
        gmail_attachment_id: string;
        filename: string;
        mime_type: string;
        size_bytes: number;
      }
    | undefined;

  return row ? mapAttachmentRow(row) : null;
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
    direction: r.direction as ThreadMessage["direction"],
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

/** Latest inbound/outbound message for a ticket (ignores system notes). */
export function getLatestConversationActivity(ticketRowId: string): {
  direction: "inbound" | "outbound";
  sentAt: string;
} | null {
  const row = getDb()
    .prepare(
      `SELECT direction, sent_at FROM thread_messages
       WHERE ticket_row_id = ? AND direction IN ('inbound', 'outbound')
       ORDER BY sent_at DESC
       LIMIT 1`
    )
    .get(ticketRowId) as { direction: string; sent_at: string } | undefined;

  if (!row) return null;
  return { direction: row.direction as "inbound" | "outbound", sentAt: row.sent_at };
}

/** Latest inbound/outbound message direction for a ticket (ignores system notes). */
export function getLatestConversationDirection(
  ticketRowId: string
): "inbound" | "outbound" | null {
  return getLatestConversationActivity(ticketRowId)?.direction ?? null;
}

export function getLastOutboundSentAt(ticketRowId: string): string | null {
  const row = getDb()
    .prepare(
      `SELECT sent_at FROM thread_messages
       WHERE ticket_row_id = ? AND direction = 'outbound'
       ORDER BY sent_at DESC
       LIMIT 1`
    )
    .get(ticketRowId) as { sent_at: string } | undefined;
  return row?.sent_at ?? null;
}

function getOverlayUpdatedAt(rowId: string): string | null {
  const row = getDb()
    .prepare(`SELECT updated_at FROM ticket_overlay WHERE row_id = ?`)
    .get(rowId) as { updated_at: string } | undefined;
  return row?.updated_at ?? null;
}

/** Backfill pending timer anchors for tickets marked pending before timers were tracked. */
function ensurePendingTimerAnchor(
  rowId: string,
  overlay: TicketOverlay,
  sheetCaseSummary: string,
  timerSettings: TimerSettings
): TicketOverlay {
  if (normalizeStatusId(overlay.status) !== "pending" || overlay.statusChangedAt) {
    return overlay;
  }

  const adminNotes = combineNotesForPendingInference(
    overlay.adminNotes,
    overlay.sheetCaseSummary,
    sheetCaseSummary
  );
  const anchor = resolvePendingTimerAnchor({
    adminNotes,
    lastOutboundSentAt: getLastOutboundSentAt(rowId),
    overlayUpdatedAt: getOverlayUpdatedAt(rowId),
  });
  if (!anchor) return overlay;

  upsertOverlayRow(rowId, overlayFields(overlay), {
    statusChangedAt: anchor.statusChangedAt,
  });
  if (anchor.pendingReopenHours != null) {
    setOverlayPendingReopenHours(rowId, anchor.pendingReopenHours);
  }

  logCrmTicketEvent({
    ticketRowId: rowId,
    kind: "anchor_backfill",
    summary: "Pending timer anchor restored",
    detail: {
      source: anchor.source,
      statusChangedAt: anchor.statusChangedAt,
      pendingReopenHours: anchor.pendingReopenHours,
      timer: describePendingReopenTimer(anchor.pendingReopenHours, timerSettings, workspaceBusinessHours()),
    },
    createdAt: anchor.statusChangedAt,
  });

  return readOverlayRow(rowId);
}

function logAutomatedReopen(
  rowId: string,
  previousStatus: string,
  reason: "customer_reply" | "pending_timer" | "hold_timer"
): void {
  logCrmTicketEvent({
    ticketRowId: rowId,
    kind: "auto_reopen",
    summary: `Auto-reopened to Open from ${crmStatusLabel(previousStatus)}`,
    detail: { reason, previousStatus },
  });
}

function queueAutoReopenSheetSync(rowId: string, status: string): void {
  if (process.env.USE_MOCK_DATA === "true") return;
  const sheetStatusValue = mapCrmStatusToSheetValue(status);
  if (!sheetStatusValue) return;

  void import("./sheets")
    .then(({ updateSheetStatusOnSheet }) => {
      const config = loadSheetConfig("default");
      const parsed = parseTicketRowId(rowId);
      if (!config || !parsed) return;
      return updateSheetStatusOnSheet(config, parsed.rowNumber, sheetStatusValue);
    })
    .catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[SheetsCRM sheet sync] auto-reopen (${rowId}):`, message);
    });
}

/** Move pending → open when the customer sent the latest email. */
export function reopenPendingOnCustomerReply(ticketRowId: string): boolean {
  const overlay = readOverlayRow(ticketRowId);
  if (blocksTicketAutoReopen(overlay.status, overlay.resolvedClosed)) return false;
  const latest = getLatestConversationActivity(ticketRowId);
  const reopen = getReopenOnCustomerReplyStatus(
    overlay.status,
    latest?.direction,
    latest?.sentAt,
    overlay.statusChangedAt
  );
  if (!reopen) return false;

  const previousStatus = overlay.status;
  const slaHours = overlay.slaHours || DEFAULT_TIMER_SETTINGS.defaultSlaHours;
  const slaDueAt =
    latest?.direction === "inbound" && latest.sentAt
      ? computeResponseSlaDueAt(latest.sentAt, slaHours)
      : null;

  upsertOverlayRow(ticketRowId, overlayFields(overlay), {
    status: reopen,
    statusSource: "crm",
    statusChangedAt: null,
    slaDueAt,
  });
  setOverlayPendingReopenHours(ticketRowId, null);
  applyBackgroundGmailSyncEligibility(ticketRowId, previousStatus, reopen, false);
  logAutomatedReopen(ticketRowId, previousStatus, "customer_reply");
  queueAutoReopenSheetSync(ticketRowId, reopen);
  return true;
}

/** Earliest imported inbound message per ticket (batch). */
export function getFirstInboundAtMap(): Map<string, string> {
  const rows = getDb()
    .prepare(
      `SELECT ticket_row_id, MIN(sent_at) AS first_inbound
       FROM thread_messages
       WHERE direction = 'inbound'
       GROUP BY ticket_row_id`
    )
    .all() as Array<{ ticket_row_id: string; first_inbound: string }>;

  return new Map(rows.map((r) => [r.ticket_row_id, r.first_inbound]));
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

/** Resolve the primary Gmail thread for outbound replies. */
export function resolveTicketGmailThreadId(ticketRowId: string): string | null {
  if (ticketForceNewGmailThreadOnSend(ticketRowId)) return null;

  const primary = getPrimaryGmailThreadLink(getDb(), ticketRowId);
  if (primary) return primary.gmailThreadId;

  const claimed = getTicketGmailThreadId(ticketRowId);
  if (claimed) return claimed;

  const messages = getAllThreadMessagesRaw(ticketRowId);
  const latestWithThread = [...messages]
    .reverse()
    .find((m) => m.gmailThreadId);
  if (
    latestWithThread?.gmailThreadId &&
    claimGmailThreadForTicket(ticketRowId, latestWithThread.gmailThreadId)
  ) {
    return latestWithThread.gmailThreadId;
  }

  return null;
}

export function pruneMismatchedThreadMessages(ticketRowId: string): void {
  const linked = getLinkedGmailThreadIds(getDb(), ticketRowId);
  const claimed = getTicketGmailThreadId(ticketRowId);
  const allowed = linked.length > 0 ? linked : claimed ? [claimed] : [];
  if (allowed.length === 0) return;

  const placeholders = allowed.map(() => "?").join(",");
  getDb()
    .prepare(
      `DELETE FROM thread_messages
       WHERE ticket_row_id = ? AND gmail_thread_id IS NOT NULL AND gmail_thread_id NOT IN (${placeholders})`
    )
    .run(ticketRowId, ...allowed);
}

export function getThreadMessageById(messageId: string): ThreadMessage | null {
  const row = getDb()
    .prepare("SELECT * FROM thread_messages WHERE id = ?")
    .get(messageId) as
    | {
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
      }
    | undefined;

  if (!row) return null;

  return {
    id: row.id,
    ticketRowId: row.ticket_row_id,
    direction: row.direction as ThreadMessage["direction"],
    from: row.from_addr,
    to: row.to_addr,
    cc: row.cc_addr,
    subject: row.subject,
    body: row.body,
    gmailMessageId: row.gmail_message_id,
    gmailThreadId: row.gmail_thread_id,
    sentAt: row.sent_at,
  };
}

export function updateThreadMessageBody(messageId: string, body: string): void {
  getDb().prepare(`UPDATE thread_messages SET body = ? WHERE id = ?`).run(body, messageId);
}

export function getThreadMessages(ticketRowId: string): ThreadMessage[] {
  const linked = getLinkedGmailThreadIds(getDb(), ticketRowId);
  const claimed = resolveTicketGmailThreadId(ticketRowId);
  const allowed = new Set(linked.length > 0 ? linked : claimed ? [claimed] : []);
  const messages = getAllThreadMessagesRaw(ticketRowId);

  const filtered =
    allowed.size === 0
      ? messages.filter((m) => !m.gmailThreadId)
      : messages.filter((m) => !m.gmailThreadId || allowed.has(m.gmailThreadId));

  return loadAttachmentsForMessages(filtered);
}

export function isGmailMessageRedactionBlocked(
  ticketRowId: string,
  gmailMessageId: string
): boolean {
  const row = getDb()
    .prepare(
      `SELECT 1 FROM blocked_gmail_messages
       WHERE ticket_row_id = ? AND gmail_message_id = ?`
    )
    .get(ticketRowId, gmailMessageId);
  return Boolean(row);
}

function deleteThreadMessageAndAttachments(messageId: string): void {
  const db = getDb();
  db.prepare(`DELETE FROM message_attachments WHERE thread_message_id = ?`).run(messageId);
  db.prepare(`DELETE FROM thread_messages WHERE id = ?`).run(messageId);
}

export function redactThreadMessage(params: {
  ticketRowId: string;
  messageId: string;
}):
  | { ok: true; messages: ThreadMessage[]; adminNotes: string }
  | { ok: false; error: string } {
  const rows = getDb()
    .prepare("SELECT * FROM thread_messages WHERE id = ? AND ticket_row_id = ?")
    .all(params.messageId, params.ticketRowId) as Array<{
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

  const row = rows[0];
  if (!row) {
    return { ok: false, error: "Message not found" };
  }
  if (row.direction === "system" || row.direction === "redacted") {
    return { ok: false, error: "This message cannot be redacted" };
  }
  if (row.direction !== "inbound" && row.direction !== "outbound") {
    return { ok: false, error: "This message cannot be redacted" };
  }

  const direction = row.direction;
  const sentAt = row.sent_at;
  const gmailMessageId = row.gmail_message_id?.trim() || null;

  deleteThreadMessageAndAttachments(row.id);

  if (gmailMessageId) {
    getDb()
      .prepare(
        `INSERT INTO blocked_gmail_messages (
           ticket_row_id, gmail_message_id, redacted_at, original_sent_at, original_direction
         ) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(ticket_row_id, gmail_message_id) DO UPDATE SET
           redacted_at = excluded.redacted_at,
           original_sent_at = excluded.original_sent_at,
           original_direction = excluded.original_direction`
      )
      .run(params.ticketRowId, gmailMessageId, new Date().toISOString(), sentAt, direction);
  }

  const placeholder: ThreadMessage = {
    id: uuidv4(),
    ticketRowId: params.ticketRowId,
    direction: "redacted",
    from: "SheetsCRM",
    to: "",
    cc: null,
    subject: "Message redacted",
    body: buildRedactedMessagePlaceholderBody(sentAt),
    gmailMessageId: null,
    gmailThreadId: null,
    sentAt,
  };
  addThreadMessage(placeholder);

  const adminNotes = appendAdminNoteToOverlay(
    params.ticketRowId,
    buildRedactAdminNote({ direction, sentAt })
  );

  return {
    ok: true,
    messages: getThreadMessages(params.ticketRowId),
    adminNotes,
  };
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

/** Insert or refresh a Gmail-synced row (prevents duplicate message IDs). */
export function upsertThreadMessageFromGmail(
  message: ThreadMessage,
  attachments: MessageAttachmentInput[] = []
): void {
  let threadMessageId: string;

  if (!message.gmailMessageId) {
    addThreadMessage(message);
    return;
  }

  if (isGmailMessageRedactionBlocked(message.ticketRowId, message.gmailMessageId)) {
    return;
  }

  const existing = getDb()
    .prepare(
      `SELECT id FROM thread_messages WHERE ticket_row_id = ? AND gmail_message_id = ?`
    )
    .get(message.ticketRowId, message.gmailMessageId) as { id: string } | undefined;

  if (existing) {
    threadMessageId = existing.id;
    getDb()
      .prepare(
        `UPDATE thread_messages
         SET direction = ?, from_addr = ?, to_addr = ?, cc_addr = ?, subject = ?, body = ?, gmail_thread_id = ?, sent_at = ?
         WHERE id = ?`
      )
      .run(
        message.direction,
        message.from,
        message.to,
        message.cc,
        message.subject,
        message.body,
        message.gmailThreadId,
        message.sentAt,
        existing.id
      );
  } else {
    threadMessageId = message.id;
    try {
      addThreadMessage(message);
    } catch {
      const raced = getThreadMessageIdByGmailMessageId(
        message.ticketRowId,
        message.gmailMessageId
      );
      if (!raced) return;
      threadMessageId = raced;
    }
  }

  replaceMessageAttachments({
    threadMessageId,
    ticketRowId: message.ticketRowId,
    gmailMessageId: message.gmailMessageId,
    attachments,
  });
}

/** Remove duplicate thread rows (same Gmail id or identical inbound snapshot). */
export function dedupeThreadMessagesForTicket(ticketRowId: string): void {
  const db = getDb();

  db.prepare(
    `DELETE FROM thread_messages
     WHERE ticket_row_id = ?
       AND gmail_message_id IS NOT NULL
       AND id NOT IN (
         SELECT MIN(id)
         FROM thread_messages
         WHERE ticket_row_id = ? AND gmail_message_id IS NOT NULL
         GROUP BY gmail_message_id
       )`
  ).run(ticketRowId, ticketRowId);

  const inbound = getAllThreadMessagesRaw(ticketRowId).filter((m) => m.direction === "inbound");
  const seen = new Set<string>();
  const duplicateIds: string[] = [];

  for (const message of inbound) {
    const bodyKey = message.body.trim().slice(0, 500);
    const key = `${message.sentAt}|${message.from}|${bodyKey}`;
    if (seen.has(key)) {
      duplicateIds.push(message.id);
      continue;
    }
    seen.add(key);
  }

  if (duplicateIds.length > 0) {
    const deleteAttachments = db.prepare(
      `DELETE FROM message_attachments WHERE thread_message_id = ?`
    );
    const deleteMessage = db.prepare(`DELETE FROM thread_messages WHERE id = ?`);
    for (const id of duplicateIds) {
      deleteAttachments.run(id);
      deleteMessage.run(id);
    }
  }
}

export function getOutboundTicketIds(): Set<string> {
  const rows = getDb()
    .prepare(
      `SELECT DISTINCT ticket_row_id FROM thread_messages WHERE direction = 'outbound'`
    )
    .all() as Array<{ ticket_row_id: string }>;
  return new Set(rows.map((r) => r.ticket_row_id));
}

function resolveTicketAutomatedReopen(
  rowId: string,
  overlay: TicketOverlay,
  sheetCaseSummary: string,
  timerSettings: TimerSettings
): "open" | null {
  if (blocksTicketAutoReopen(overlay.status, overlay.resolvedClosed)) return null;
  const anchored = ensurePendingTimerAnchor(rowId, overlay, sheetCaseSummary, timerSettings);
  const latest = getLatestConversationActivity(rowId);
  const latestOutboundSentAt = getLastOutboundSentAt(rowId);
  return resolveAutomatedReopenStatus(
    anchored.status,
    anchored.statusChangedAt,
    latest?.direction,
    latest?.sentAt,
    new Date(),
    timerSettings,
    anchored.pendingReopenHours,
    latestOutboundSentAt,
    workspaceBusinessHours(),
    anchored.resolvedClosed
  );
}

export function applyStatusAutomations(
  tickets: Ticket[],
  timerSettings: TimerSettings = DEFAULT_TIMER_SETTINGS
): Ticket[] {
  return tickets.map((ticket) => {
    const overlay = readOverlayRow(ticket.rowId);
    const reopen = resolveTicketAutomatedReopen(
      ticket.rowId,
      overlay,
      ticket.sheetCaseSummary,
      timerSettings
    );
    if (!reopen) return ticket;

    const previousStatus = overlay.status;
    upsertOverlayRow(ticket.rowId, overlayFields(overlay), {
      status: reopen,
      statusSource: "crm",
      statusChangedAt: null,
    });
    setOverlayPendingReopenHours(ticket.rowId, null);
    logAutomatedReopen(ticket.rowId, previousStatus, "pending_timer");
    queueAutoReopenSheetSync(ticket.rowId, reopen);

    return { ...ticket, status: reopen };
  });
}

/** Reset CRM overrides on a cover ticket and re-apply current sheet row values. */
export function resyncCoverTicketOverlayFromSheet(
  freshTicket: Ticket,
  timerSettings: TimerSettings = DEFAULT_TIMER_SETTINGS
): Ticket {
  const existing = readOverlayRow(freshTicket.rowId);
  const mappedStatus = mapSheetStatusToCrmId(freshTicket.sheetStatus);
  const normalizedStatus = normalizeStatusId(mappedStatus);
  const sheetStatusValue = freshTicket.sheetStatus.trim() || null;
  const sheetCaseSummaryValue = freshTicket.sheetCaseSummary.trim() || null;
  const sheetContactReason = freshTicket.contactReason.trim() || null;
  const now = new Date().toISOString();
  const statusChangedAt =
    normalizedStatus === "pending" || normalizedStatus === "longterm_hold" ? now : null;

  upsertOverlayRow(freshTicket.rowId, overlayFields(existing), {
    status: normalizedStatus,
    statusSource: "sheet",
    sheetStatus: sheetStatusValue,
    crmSubject: null,
    adminNotes: sheetCaseSummaryValue,
    adminNotesSource: "sheet",
    sheetCaseSummary: sheetCaseSummaryValue,
    contactReason: sheetContactReason,
    contactReasonSource: "sheet",
    statusChangedAt,
    crmAirbnbUserId: null,
    airbnbUserIdSource: "sheet",
  });
  setOverlayPendingReopenHours(freshTicket.rowId, null);
  setOverlayResolvedClosed(freshTicket.rowId, false);

  if (existing.exists) {
    const previousStatus = normalizeStatusId(existing.status);
    applyBackgroundGmailSyncEligibility(
      freshTicket.rowId,
      previousStatus,
      normalizedStatus,
      false
    );
    if (
      (normalizedStatus === "resolved" || normalizedStatus === "do_not_action") &&
      previousStatus !== normalizedStatus
    ) {
      markTicketResolvedNow(freshTicket.rowId);
    } else if (
      (previousStatus === "resolved" || previousStatus === "do_not_action") &&
      normalizedStatus !== previousStatus &&
      normalizedStatus !== "resolved" &&
      normalizedStatus !== "do_not_action"
    ) {
      clearTicketResolvedAt(freshTicket.rowId);
    }
  }

  logCrmTicketEvent({
    ticketRowId: freshTicket.rowId,
    kind: "sheet_resync",
    summary: "Resynced ticket from teammate sheet",
    detail: {
      status: normalizedStatus,
      sheetStatus: sheetStatusValue,
    },
  });

  return mergeOverlayOntoTicket(freshTicket, freshTicket.airbnbUserId, timerSettings);
}

export function mergeOverlayOntoTicket(
  ticket: Ticket,
  sheetAirbnbUserId?: string,
  timerSettings: TimerSettings = DEFAULT_TIMER_SETTINGS
): Ticket {
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
    const slaHours = timerSettings.defaultSlaHours;
    const slaDueAt = null;
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
      initialResponseSlaCleared: false,
    });
    if (mappedFromSheet === "pending" || mappedFromSheet === "resolved") {
      syncBackgroundGmailSyncForTicket(ticket.rowId, mappedFromSheet, false);
    }
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
        const previousStatus = normalizeStatusId(overlay.status);
        const nextStatus = normalizeStatusId(status);
        const sheetStatusUpdates: Partial<OverlayFields> = {
          status,
          statusSource: "sheet",
          sheetStatus: sheetStatusValue,
          sheetCaseSummary: sheetCaseSummaryValue,
          adminNotes: sheetCaseSummaryValue,
          adminNotesSource: "sheet",
        };
        if (nextStatus === "pending" && previousStatus !== "pending") {
          sheetStatusUpdates.statusChangedAt = new Date().toISOString();
        } else if (
          previousStatus === "pending" &&
          nextStatus !== "pending" &&
          nextStatus !== "longterm_hold"
        ) {
          sheetStatusUpdates.statusChangedAt = null;
        }
        if (
          (nextStatus === "resolved" || nextStatus === "do_not_action") &&
          previousStatus !== nextStatus
        ) {
          markTicketResolvedNow(ticket.rowId);
        } else if (
          (previousStatus === "resolved" || previousStatus === "do_not_action") &&
          nextStatus !== previousStatus &&
          nextStatus !== "resolved" &&
          nextStatus !== "do_not_action"
        ) {
          clearTicketResolvedAt(ticket.rowId);
        }
        upsertOverlayRow(ticket.rowId, overlayFields(overlay), sheetStatusUpdates);
        if (nextStatus === "pending" && previousStatus !== "pending") {
          setOverlayPendingReopenHours(ticket.rowId, null);
        }
        applyBackgroundGmailSyncEligibility(
          ticket.rowId,
          previousStatus,
          nextStatus,
          overlay.resolvedClosed
        );
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

  let refreshed = readOverlayRow(ticket.rowId);
  refreshed = ensurePendingTimerAnchor(
    ticket.rowId,
    refreshed,
    sheetCaseSummaryValue ?? ticket.sheetCaseSummary,
    timerSettings
  );
  const reopen = resolveTicketAutomatedReopen(
    ticket.rowId,
    refreshed,
    sheetCaseSummaryValue ?? ticket.sheetCaseSummary,
    timerSettings
  );
  if (reopen) {
    const previousStatus = refreshed.status;
    upsertOverlayRow(ticket.rowId, overlayFields(refreshed), {
      status: reopen,
      statusSource: "crm",
      statusChangedAt: null,
    });
    setOverlayPendingReopenHours(ticket.rowId, null);
    applyBackgroundGmailSyncEligibility(ticket.rowId, previousStatus, reopen, false);
    logAutomatedReopen(ticket.rowId, previousStatus, "pending_timer");
    queueAutoReopenSheetSync(ticket.rowId, reopen);
    status = reopen;
    refreshed = readOverlayRow(ticket.rowId);
  } else {
    status = refreshed.status;
  }

  const finalStatus = normalizeStatusId(status);
  if (finalStatus === "pending") {
    ensureBackgroundGmailSyncEnabled(ticket.rowId);
  } else if (
    finalStatus === "resolved" &&
    !refreshed.resolvedClosed &&
    ticketHasExplicitGmailLink(ticket.rowId) &&
    !ticketGmailLinkIsArchived(ticket.rowId)
  ) {
    ensureBackgroundGmailSyncEnabled(ticket.rowId);
  } else if (finalStatus === "resolved" && refreshed.resolvedClosed) {
    disableBackgroundGmailSync(ticket.rowId);
  }

  if (refreshed.contactReasonSource === "crm" && refreshed.contactReason) {
    contactReason = refreshed.contactReason;
  } else if (refreshed.contactReason) {
    contactReason = refreshed.contactReason;
  }

  const slaHours = refreshed.slaHours || timerSettings.defaultSlaHours;
  const slaDueAt = isResponseSlaEligibleStatus(status)
    ? refreshResponseSlaDueAt(ticket.rowId, ticket.timestamp, timerSettings)
    : null;
  const slaBreached = slaDueAt ? new Date(slaDueAt) < new Date() : false;
  const crmSubject = refreshed.crmSubject?.trim() || null;
  const subject = crmSubject || ticket.subject;
  const crmSubjectLabel = crmSubjectLabelFromStored(crmSubject);
  const airbnbUserId = resolveTicketAirbnbUserId(
    sheetAd,
    ticket.columnD,
    ticket.headerField,
    refreshed
  );

  return {
    ...ticket,
    subject,
    crmSubjectLabel,
    contactReason,
    status,
    airbnbUserId,
    crmAirbnbUserId: manualAirbnbUserIdFromOverlay(refreshed),
    adminNotes: ticket.sheetCaseSummary.trim(),
    sheetStatus:
      refreshed.statusSource === "crm"
        ? refreshed.sheetStatus || crmStatusLabel(status)
        : ticket.sheetStatus || crmStatusLabel(status),
    slaHours,
    slaDueAt,
    slaBreached,
    statusChangedAt: refreshed.statusChangedAt,
    pendingReopenHours: refreshed.pendingReopenHours,
    resolvedClosed: refreshed.resolvedClosed,
    gmailOpenUrl: resolveTicketGmailOpenUrl(ticket.rowId),
    gmailLinkArchivedAt: getTicketGmailLinkArchivedAt(ticket.rowId),
    forceNewGmailThreadOnSend: ticketForceNewGmailThreadOnSend(ticket.rowId),
    linkedCases: refreshed.linkedCases,
    needsInitialResponse: false,
  };
}
