/**
 * SQLite persistence for compose drafts and recent-send archive.
 * Replaces browser localStorage so PII is not readable by page JS / other origins.
 */
import { v4 as uuidv4 } from "uuid";
import { getOverlayDb } from "./overlay-db";
import type { SendArchiveEntry, SendArchiveStatus } from "./send-archive-types";
import type { ReplyDraft } from "./reply-draft-types";
import {
  MAX_REPLY_DRAFTS,
  SEND_ARCHIVE_LIMIT,
} from "./composer-persistence-constants";

export type { SendArchiveEntry, SendArchiveStatus } from "./send-archive-types";
export type { ReplyDraft } from "./reply-draft-types";
export { SEND_ARCHIVE_LIMIT, MAX_REPLY_DRAFTS } from "./composer-persistence-constants";

export function ensureComposerPersistenceTables(): void {
  const db = getOverlayDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS reply_drafts (
      ticket_row_id TEXT PRIMARY KEY,
      body TEXT NOT NULL,
      subject TEXT NOT NULL DEFAULT '',
      cc TEXT NOT NULL DEFAULT '',
      bcc TEXT NOT NULL DEFAULT '',
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS admin_note_drafts (
      ticket_row_id TEXT PRIMARY KEY,
      text TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS send_archive (
      id TEXT PRIMARY KEY,
      saved_at TEXT NOT NULL,
      status TEXT NOT NULL,
      ticket_row_id TEXT NOT NULL,
      label TEXT NOT NULL DEFAULT '',
      to_addr TEXT NOT NULL,
      subject TEXT NOT NULL,
      message TEXT NOT NULL,
      cc TEXT,
      bcc TEXT,
      status_after_send TEXT NOT NULL,
      intake_timestamp TEXT,
      attachments_json TEXT NOT NULL DEFAULT '[]',
      error_message TEXT,
      completed_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_send_archive_saved
      ON send_archive(saved_at DESC);
  `);
}

export function getReplyDraft(ticketRowId: string): ReplyDraft | null {
  ensureComposerPersistenceTables();
  const row = getOverlayDb()
    .prepare(
      `SELECT body, subject, cc, bcc, updated_at FROM reply_drafts WHERE ticket_row_id = ?`
    )
    .get(ticketRowId) as
    | { body: string; subject: string; cc: string; bcc: string; updated_at: number }
    | undefined;
  if (!row) return null;
  return {
    body: row.body,
    subject: row.subject,
    cc: row.cc,
    bcc: row.bcc,
    updatedAt: row.updated_at,
  };
}

export function upsertReplyDraft(
  ticketRowId: string,
  draft: { body: string; subject: string; cc?: string; bcc?: string }
): ReplyDraft {
  ensureComposerPersistenceTables();
  const updatedAt = Date.now();
  const payload: ReplyDraft = {
    body: draft.body,
    subject: draft.subject,
    cc: draft.cc ?? "",
    bcc: draft.bcc ?? "",
    updatedAt,
  };
  getOverlayDb()
    .prepare(
      `INSERT INTO reply_drafts (ticket_row_id, body, subject, cc, bcc, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(ticket_row_id) DO UPDATE SET
         body = excluded.body,
         subject = excluded.subject,
         cc = excluded.cc,
         bcc = excluded.bcc,
         updated_at = excluded.updated_at`
    )
    .run(
      ticketRowId,
      payload.body,
      payload.subject,
      payload.cc,
      payload.bcc,
      payload.updatedAt
    );

  pruneReplyDrafts();
  return payload;
}

export function deleteReplyDraft(ticketRowId: string): void {
  ensureComposerPersistenceTables();
  getOverlayDb().prepare(`DELETE FROM reply_drafts WHERE ticket_row_id = ?`).run(ticketRowId);
}

function pruneReplyDrafts(): void {
  const db = getOverlayDb();
  const count = (
    db.prepare(`SELECT COUNT(*) AS c FROM reply_drafts`).get() as { c: number }
  ).c;
  if (count <= MAX_REPLY_DRAFTS) return;
  db.prepare(
    `DELETE FROM reply_drafts WHERE ticket_row_id IN (
       SELECT ticket_row_id FROM reply_drafts
       ORDER BY updated_at ASC
       LIMIT ?
     )`
  ).run(count - MAX_REPLY_DRAFTS);
}

export function getAdminNoteDraft(ticketRowId: string): string | null {
  ensureComposerPersistenceTables();
  const row = getOverlayDb()
    .prepare(`SELECT text FROM admin_note_drafts WHERE ticket_row_id = ?`)
    .get(ticketRowId) as { text: string } | undefined;
  if (!row?.text?.trim()) return null;
  return row.text;
}

export function upsertAdminNoteDraft(ticketRowId: string, text: string): void {
  ensureComposerPersistenceTables();
  if (!text.trim()) {
    deleteAdminNoteDraft(ticketRowId);
    return;
  }
  getOverlayDb()
    .prepare(
      `INSERT INTO admin_note_drafts (ticket_row_id, text, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(ticket_row_id) DO UPDATE SET
         text = excluded.text,
         updated_at = excluded.updated_at`
    )
    .run(ticketRowId, text, Date.now());
}

export function deleteAdminNoteDraft(ticketRowId: string): void {
  ensureComposerPersistenceTables();
  getOverlayDb()
    .prepare(`DELETE FROM admin_note_drafts WHERE ticket_row_id = ?`)
    .run(ticketRowId);
}

function rowToSendArchiveEntry(row: {
  id: string;
  saved_at: string;
  status: string;
  ticket_row_id: string;
  label: string;
  to_addr: string;
  subject: string;
  message: string;
  cc: string | null;
  bcc: string | null;
  status_after_send: string;
  intake_timestamp: string | null;
  attachments_json: string;
  error_message: string | null;
  completed_at: string | null;
}): SendArchiveEntry {
  let attachments: SendArchiveEntry["attachments"] = [];
  try {
    const parsed = JSON.parse(row.attachments_json) as unknown;
    if (Array.isArray(parsed)) attachments = parsed as SendArchiveEntry["attachments"];
  } catch {
    attachments = [];
  }
  return {
    id: row.id,
    savedAt: row.saved_at,
    status: row.status as SendArchiveStatus,
    ticketRowId: row.ticket_row_id,
    label: row.label,
    to: row.to_addr,
    subject: row.subject,
    message: row.message,
    cc: row.cc,
    bcc: row.bcc,
    statusAfterSend: row.status_after_send as SendArchiveEntry["statusAfterSend"],
    intakeTimestamp: row.intake_timestamp ?? undefined,
    attachments,
    errorMessage: row.error_message ?? undefined,
    completedAt: row.completed_at ?? undefined,
  };
}

export function listSendArchive(limit = SEND_ARCHIVE_LIMIT): SendArchiveEntry[] {
  ensureComposerPersistenceTables();
  const rows = getOverlayDb()
    .prepare(
      `SELECT id, saved_at, status, ticket_row_id, label, to_addr, subject, message,
              cc, bcc, status_after_send, intake_timestamp, attachments_json,
              error_message, completed_at
       FROM send_archive
       ORDER BY saved_at DESC
       LIMIT ?`
    )
    .all(limit) as Array<Parameters<typeof rowToSendArchiveEntry>[0]>;
  return rows.map(rowToSendArchiveEntry);
}

export function upsertSendArchiveEntry(entry: SendArchiveEntry): void {
  ensureComposerPersistenceTables();
  const db = getOverlayDb();
  db.prepare(
    `INSERT INTO send_archive (
       id, saved_at, status, ticket_row_id, label, to_addr, subject, message,
       cc, bcc, status_after_send, intake_timestamp, attachments_json,
       error_message, completed_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       saved_at = excluded.saved_at,
       status = excluded.status,
       ticket_row_id = excluded.ticket_row_id,
       label = excluded.label,
       to_addr = excluded.to_addr,
       subject = excluded.subject,
       message = excluded.message,
       cc = excluded.cc,
       bcc = excluded.bcc,
       status_after_send = excluded.status_after_send,
       intake_timestamp = excluded.intake_timestamp,
       attachments_json = excluded.attachments_json,
       error_message = excluded.error_message,
       completed_at = excluded.completed_at`
  ).run(
    entry.id,
    entry.savedAt,
    entry.status,
    entry.ticketRowId,
    entry.label,
    entry.to,
    entry.subject,
    entry.message,
    entry.cc,
    entry.bcc,
    entry.statusAfterSend,
    entry.intakeTimestamp ?? null,
    JSON.stringify(entry.attachments ?? []),
    entry.errorMessage ?? null,
    entry.completedAt ?? null
  );

  const count = (db.prepare(`SELECT COUNT(*) AS c FROM send_archive`).get() as { c: number }).c;
  if (count > SEND_ARCHIVE_LIMIT) {
    db.prepare(
      `DELETE FROM send_archive WHERE id IN (
         SELECT id FROM send_archive
         ORDER BY saved_at ASC
         LIMIT ?
       )`
    ).run(count - SEND_ARCHIVE_LIMIT);
  }
}

export function patchSendArchiveEntry(
  id: string,
  patch: Partial<Pick<SendArchiveEntry, "status" | "errorMessage" | "completedAt">>
): SendArchiveEntry | null {
  ensureComposerPersistenceTables();
  const existing = listSendArchive(SEND_ARCHIVE_LIMIT).find((e) => e.id === id);
  if (!existing) {
    const row = getOverlayDb()
      .prepare(
        `SELECT id, saved_at, status, ticket_row_id, label, to_addr, subject, message,
                cc, bcc, status_after_send, intake_timestamp, attachments_json,
                error_message, completed_at
         FROM send_archive WHERE id = ?`
      )
      .get(id) as Parameters<typeof rowToSendArchiveEntry>[0] | undefined;
    if (!row) return null;
    const entry = { ...rowToSendArchiveEntry(row), ...patch };
    upsertSendArchiveEntry(entry);
    return entry;
  }
  const next = { ...existing, ...patch };
  upsertSendArchiveEntry(next);
  return next;
}

export function clearSendArchiveStore(): void {
  ensureComposerPersistenceTables();
  getOverlayDb().prepare(`DELETE FROM send_archive`).run();
}

export function newArchiveId(): string {
  return uuidv4();
}
