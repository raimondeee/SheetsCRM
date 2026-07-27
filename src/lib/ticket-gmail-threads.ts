/**
 * Multi-thread Gmail link table (primary + appended threads per ticket).
 * Migrates legacy single gmail_thread_id on ticket_overlay. A Gmail thread id
 * can belong to at most one ticket (unique index).
 */
import type Database from "better-sqlite3";
import { v4 as uuidv4 } from "uuid";

export interface TicketGmailThreadLink {
  id: string;
  ticketRowId: string;
  gmailThreadId: string;
  openUrl: string | null;
  linkedAt: string;
  isPrimary: boolean;
}

export function ensureTicketGmailThreadsSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS ticket_gmail_threads (
      id TEXT PRIMARY KEY,
      ticket_row_id TEXT NOT NULL,
      gmail_thread_id TEXT NOT NULL,
      open_url TEXT,
      linked_at TEXT NOT NULL,
      is_primary INTEGER NOT NULL DEFAULT 0
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_ticket_gmail_threads_thread
      ON ticket_gmail_threads(gmail_thread_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_ticket_gmail_threads_ticket_thread
      ON ticket_gmail_threads(ticket_row_id, gmail_thread_id);
    CREATE INDEX IF NOT EXISTS idx_ticket_gmail_threads_ticket
      ON ticket_gmail_threads(ticket_row_id);
  `);
}

export function migrateTicketGmailThreadsFromOverlay(db: Database.Database): void {
  const rows = db
    .prepare(
      `SELECT row_id, gmail_thread_id, gmail_thread_open_url, gmail_thread_linked_at
       FROM ticket_overlay
       WHERE gmail_thread_id IS NOT NULL AND TRIM(gmail_thread_id) != ''`
    )
    .all() as Array<{
    row_id: string;
    gmail_thread_id: string;
    gmail_thread_open_url: string | null;
    gmail_thread_linked_at: string | null;
  }>;

  const insert = db.prepare(
    `INSERT OR IGNORE INTO ticket_gmail_threads (
       id, ticket_row_id, gmail_thread_id, open_url, linked_at, is_primary
     ) VALUES (?, ?, ?, ?, ?, 1)`
  );

  const now = new Date().toISOString();
  for (const row of rows) {
    insert.run(
      uuidv4(),
      row.row_id,
      row.gmail_thread_id.trim(),
      row.gmail_thread_open_url?.trim() || null,
      row.gmail_thread_linked_at?.trim() || now
    );
  }
}

export function listTicketGmailThreads(
  db: Database.Database,
  ticketRowId: string
): TicketGmailThreadLink[] {
  const rows = db
    .prepare(
      `SELECT id, ticket_row_id, gmail_thread_id, open_url, linked_at, is_primary
       FROM ticket_gmail_threads
       WHERE ticket_row_id = ?
       ORDER BY is_primary DESC, linked_at ASC`
    )
    .all(ticketRowId) as Array<{
    id: string;
    ticket_row_id: string;
    gmail_thread_id: string;
    open_url: string | null;
    linked_at: string;
    is_primary: number;
  }>;

  return rows.map((row) => ({
    id: row.id,
    ticketRowId: row.ticket_row_id,
    gmailThreadId: row.gmail_thread_id,
    openUrl: row.open_url,
    linkedAt: row.linked_at,
    isPrimary: row.is_primary === 1,
  }));
}

export function getPrimaryGmailThreadLink(
  db: Database.Database,
  ticketRowId: string
): TicketGmailThreadLink | null {
  return listTicketGmailThreads(db, ticketRowId).find((link) => link.isPrimary) ?? null;
}

export function getLinkedGmailThreadIds(db: Database.Database, ticketRowId: string): string[] {
  return listTicketGmailThreads(db, ticketRowId).map((link) => link.gmailThreadId);
}

export function getTicketRowIdForLinkedGmailThread(
  db: Database.Database,
  threadId: string
): string | null {
  const trimmed = threadId.trim();
  if (!trimmed) return null;
  const row = db
    .prepare(`SELECT ticket_row_id FROM ticket_gmail_threads WHERE gmail_thread_id = ?`)
    .get(trimmed) as { ticket_row_id: string } | undefined;
  return row?.ticket_row_id ?? null;
}

export function isGmailThreadLinkedToTicket(
  db: Database.Database,
  ticketRowId: string,
  threadId: string
): boolean {
  const row = db
    .prepare(
      `SELECT 1 FROM ticket_gmail_threads
       WHERE ticket_row_id = ? AND gmail_thread_id = ?`
    )
    .get(ticketRowId, threadId.trim());
  return Boolean(row);
}

export function getGmailThreadLinkedAt(
  db: Database.Database,
  ticketRowId: string,
  threadId: string
): string | null {
  const row = db
    .prepare(
      `SELECT linked_at FROM ticket_gmail_threads
       WHERE ticket_row_id = ? AND gmail_thread_id = ?`
    )
    .get(ticketRowId, threadId.trim()) as { linked_at: string } | undefined;
  return row?.linked_at ?? null;
}

export function syncPrimaryThreadToOverlay(
  db: Database.Database,
  ticketRowId: string
): void {
  const primary = getPrimaryGmailThreadLink(db, ticketRowId);
  const now = new Date().toISOString();
  if (!primary) {
    db.prepare(
      `UPDATE ticket_overlay
       SET gmail_thread_id = NULL, updated_at = ?
       WHERE row_id = ?`
    ).run(now, ticketRowId);
    return;
  }

  db.prepare(
    `UPDATE ticket_overlay
     SET gmail_thread_id = ?,
         gmail_thread_open_url = COALESCE(?, gmail_thread_open_url),
         gmail_thread_linked_at = COALESCE(gmail_thread_linked_at, ?),
         updated_at = ?
     WHERE row_id = ?`
  ).run(primary.gmailThreadId, primary.openUrl, primary.linkedAt, now, ticketRowId);
}

export function addGmailThreadToTicket(
  db: Database.Database,
  params: {
    ticketRowId: string;
    threadId: string;
    openUrl: string;
    isPrimary: boolean;
    linkedAt?: string;
  }
): { ok: true } | { ok: false; error: string; linkedTicketRowId?: string } {
  const trimmed = params.threadId.trim();
  const openUrl = params.openUrl.trim();
  if (!trimmed) return { ok: false, error: "Gmail thread ID is required" };

  const owner = getTicketRowIdForLinkedGmailThread(db, trimmed);
  if (owner && owner !== params.ticketRowId) {
    return {
      ok: false,
      error: "This Gmail thread is already linked to another ticket",
      linkedTicketRowId: owner,
    };
  }

  if (isGmailThreadLinkedToTicket(db, params.ticketRowId, trimmed)) {
    return { ok: true };
  }

  const linkedAt = params.linkedAt ?? new Date().toISOString();

  if (params.isPrimary) {
    db.prepare(
      `UPDATE ticket_gmail_threads SET is_primary = 0 WHERE ticket_row_id = ?`
    ).run(params.ticketRowId);
  }

  try {
    db.prepare(
      `INSERT INTO ticket_gmail_threads (
         id, ticket_row_id, gmail_thread_id, open_url, linked_at, is_primary
       ) VALUES (?, ?, ?, ?, ?, ?)`
    ).run(
      uuidv4(),
      params.ticketRowId,
      trimmed,
      openUrl || null,
      linkedAt,
      params.isPrimary ? 1 : 0
    );
  } catch {
    return { ok: false, error: "Could not link Gmail thread" };
  }

  if (params.isPrimary) {
    syncPrimaryThreadToOverlay(db, params.ticketRowId);
  }

  return { ok: true };
}

export function ticketHasAnyGmailThreadLink(db: Database.Database, ticketRowId: string): boolean {
  const row = db
    .prepare(`SELECT 1 FROM ticket_gmail_threads WHERE ticket_row_id = ? LIMIT 1`)
    .get(ticketRowId);
  return Boolean(row);
}
