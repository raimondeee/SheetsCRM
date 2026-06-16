import { v4 as uuidv4 } from "uuid";
import { getOverlayDb } from "./overlay-db";

export type CrmTicketEventKind =
  | "status_change"
  | "auto_reopen"
  | "pending_timer"
  | "sla_change"
  | "anchor_backfill"
  | "gmail_link_archived";

export interface CrmTicketEvent {
  id: string;
  ticketRowId: string;
  kind: CrmTicketEventKind;
  summary: string;
  detail: Record<string, unknown> | null;
  createdAt: string;
}

export function ensureCrmTicketEventsTable(): void {
  const db = getOverlayDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS crm_ticket_events (
      id TEXT PRIMARY KEY,
      ticket_row_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      summary TEXT NOT NULL,
      detail_json TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_crm_ticket_events_ticket
      ON crm_ticket_events(ticket_row_id, created_at DESC);
  `);
}

export function logCrmTicketEvent(params: {
  ticketRowId: string;
  kind: CrmTicketEventKind;
  summary: string;
  detail?: Record<string, unknown> | null;
  createdAt?: string;
}): void {
  ensureCrmTicketEventsTable();
  const db = getOverlayDb();
  db.prepare(
    `INSERT INTO crm_ticket_events (id, ticket_row_id, kind, summary, detail_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    uuidv4(),
    params.ticketRowId,
    params.kind,
    params.summary,
    params.detail ? JSON.stringify(params.detail) : null,
    params.createdAt ?? new Date().toISOString()
  );
}

export function getCrmTicketEvents(ticketRowId: string, limit = 100): CrmTicketEvent[] {
  ensureCrmTicketEventsTable();
  const rows = getOverlayDb()
    .prepare(
      `SELECT id, ticket_row_id, kind, summary, detail_json, created_at
       FROM crm_ticket_events
       WHERE ticket_row_id = ?
       ORDER BY created_at DESC
       LIMIT ?`
    )
    .all(ticketRowId, limit) as Array<{
    id: string;
    ticket_row_id: string;
    kind: string;
    summary: string;
    detail_json: string | null;
    created_at: string;
  }>;

  return rows.map((row) => ({
    id: row.id,
    ticketRowId: row.ticket_row_id,
    kind: row.kind as CrmTicketEventKind,
    summary: row.summary,
    detail: row.detail_json ? (JSON.parse(row.detail_json) as Record<string, unknown>) : null,
    createdAt: row.created_at,
  }));
}
