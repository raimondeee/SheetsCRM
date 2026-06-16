import { v4 as uuidv4 } from "uuid";
import { getCrmTicketEvents, logCrmTicketEvent } from "./crm-ticket-log";
import {
  addThreadMessage,
  disableBackgroundGmailSync,
  getGmailThreadImportCutoff,
  getGmailThreadOpenUrl,
  getOverlayDb,
  getTicketOverlay,
  ticketHasExplicitGmailLink,
} from "./overlay-db";
import { normalizeStatusId } from "./status-mapper";
import type { Ticket } from "./types";

/** Default: release Gmail thread claims on tickets closed longer than this. */
export const GMAIL_LINK_ARCHIVE_DAYS =
  Number(process.env.GMAIL_LINK_ARCHIVE_DAYS) || 90;

export const GMAIL_LINK_ARCHIVE_MS = GMAIL_LINK_ARCHIVE_DAYS * 24 * 60 * 60 * 1000;

const CLOSED_STATUSES = new Set(["resolved", "do_not_action"]);

export function isClosedTicketStatus(status: string): boolean {
  return CLOSED_STATUSES.has(normalizeStatusId(status));
}

function ensureArchiveColumns(): void {
  const db = getOverlayDb();
  try {
    db.exec(`ALTER TABLE ticket_overlay ADD COLUMN resolved_at TEXT`);
  } catch {
    /* exists */
  }
  try {
    db.exec(`ALTER TABLE ticket_overlay ADD COLUMN gmail_link_archived_at TEXT`);
  } catch {
    /* exists */
  }
}

export function getTicketResolvedAt(rowId: string): string | null {
  ensureArchiveColumns();
  const row = getOverlayDb()
    .prepare(`SELECT resolved_at FROM ticket_overlay WHERE row_id = ?`)
    .get(rowId) as { resolved_at: string | null } | undefined;
  return row?.resolved_at ?? null;
}

export function getTicketGmailLinkArchivedAt(rowId: string): string | null {
  ensureArchiveColumns();
  const row = getOverlayDb()
    .prepare(`SELECT gmail_link_archived_at FROM ticket_overlay WHERE row_id = ?`)
    .get(rowId) as { gmail_link_archived_at: string | null } | undefined;
  return row?.gmail_link_archived_at ?? null;
}

export function setTicketResolvedAt(rowId: string, resolvedAt: string | null): void {
  ensureArchiveColumns();
  const now = new Date().toISOString();
  getOverlayDb()
    .prepare(
      `UPDATE ticket_overlay SET resolved_at = ?, updated_at = ? WHERE row_id = ?`
    )
    .run(resolvedAt, now, rowId);
}

export function clearGmailLinkArchivedAt(rowId: string): void {
  ensureArchiveColumns();
  const now = new Date().toISOString();
  getOverlayDb()
    .prepare(
      `UPDATE ticket_overlay SET gmail_link_archived_at = NULL, updated_at = ? WHERE row_id = ?`
    )
    .run(now, rowId);
}

function getLastOutboundSentAt(rowId: string): string | null {
  const row = getOverlayDb()
    .prepare(
      `SELECT sent_at FROM thread_messages
       WHERE ticket_row_id = ? AND direction = 'outbound'
       ORDER BY sent_at DESC
       LIMIT 1`
    )
    .get(rowId) as { sent_at: string } | undefined;
  return row?.sent_at ?? null;
}

function getOverlayUpdatedAt(rowId: string): string | null {
  const row = getOverlayDb()
    .prepare(`SELECT updated_at FROM ticket_overlay WHERE row_id = ?`)
    .get(rowId) as { updated_at: string } | undefined;
  return row?.updated_at ?? null;
}

function getResolvedAtFromEvents(rowId: string): string | null {
  const events = getCrmTicketEvents(rowId, 100);
  for (const event of events) {
    if (event.kind !== "status_change" && event.kind !== "pending_timer") continue;
    const to = event.detail?.to;
    if (to === "resolved" || to === "do_not_action") {
      return event.createdAt;
    }
    if (/resolved|do not action/i.test(event.summary)) {
      return event.createdAt;
    }
  }
  return null;
}

/** Best-effort closed timestamp for archive eligibility. */
export function resolveTicketClosedAt(rowId: string): string | null {
  const stored = getTicketResolvedAt(rowId);
  if (stored) return stored;

  const candidates = [
    getResolvedAtFromEvents(rowId),
    getLastOutboundSentAt(rowId),
    getGmailThreadImportCutoff(rowId),
    getOverlayUpdatedAt(rowId),
  ].filter((value): value is string => Boolean(value));

  if (candidates.length === 0) return null;

  const best = candidates
    .map((value) => ({ value, ms: new Date(value).getTime() }))
    .filter((entry) => !Number.isNaN(entry.ms))
    .sort((a, b) => b.ms - a.ms)[0]?.value;

  if (best) {
    setTicketResolvedAt(rowId, best);
  }
  return best ?? null;
}

export function ticketGmailLinkIsArchived(rowId: string): boolean {
  return Boolean(getTicketGmailLinkArchivedAt(rowId));
}

export function shouldArchiveTicketGmailLink(
  ticket: Pick<Ticket, "rowId" | "status">,
  now = Date.now()
): boolean {
  if (!isClosedTicketStatus(ticket.status)) return false;
  if (!ticketHasExplicitGmailLink(ticket.rowId)) return false;
  if (ticketGmailLinkIsArchived(ticket.rowId)) return false;

  const closedAt = resolveTicketClosedAt(ticket.rowId);
  if (!closedAt) return false;

  const closedMs = new Date(closedAt).getTime();
  if (Number.isNaN(closedMs)) return false;

  return now - closedMs >= GMAIL_LINK_ARCHIVE_MS;
}

export function archiveGmailLinkForTicket(rowId: string): boolean {
  if (!ticketHasExplicitGmailLink(rowId)) return false;

  const previousOpenUrl = getGmailThreadOpenUrl(rowId);
  const now = new Date().toISOString();
  ensureArchiveColumns();
  getOverlayDb()
    .prepare(
      `UPDATE ticket_overlay
       SET gmail_thread_id = NULL,
           gmail_thread_open_url = NULL,
           gmail_thread_linked_at = NULL,
           gmail_link_archived_at = ?,
           bg_gmail_sync_enabled_at = NULL,
           bg_gmail_sync_last_at = NULL,
           updated_at = ?
       WHERE row_id = ?`
    )
    .run(now, now, rowId);

  disableBackgroundGmailSync(rowId);

  addThreadMessage({
    id: uuidv4(),
    ticketRowId: rowId,
    direction: "system",
    from: "SheetsCRM",
    to: "",
    cc: null,
    subject: "Gmail link archived",
    body: `Gmail thread link archived after ${GMAIL_LINK_ARCHIVE_DAYS} days closed. The thread can be linked to a new ticket if the customer replies on the old email thread.`,
    gmailMessageId: null,
    gmailThreadId: null,
    sentAt: now,
  });

  logCrmTicketEvent({
    ticketRowId: rowId,
    kind: "gmail_link_archived",
    summary: `Gmail link archived (${GMAIL_LINK_ARCHIVE_DAYS}+ days closed)`,
    detail: {
      archivedAt: now,
      previousOpenUrl,
    },
  });

  return true;
}

/** Release stale Gmail claims before background sync runs. */
export function archiveStaleGmailLinksForTickets(tickets: Ticket[]): number {
  let archived = 0;
  const now = Date.now();
  for (const ticket of tickets) {
    if (!shouldArchiveTicketGmailLink(ticket, now)) continue;
    if (archiveGmailLinkForTicket(ticket.rowId)) archived += 1;
  }
  return archived;
}

/** Call when a ticket transitions into a closed status. */
export function markTicketResolvedNow(rowId: string, at = new Date().toISOString()): void {
  if (!getTicketResolvedAt(rowId)) {
    setTicketResolvedAt(rowId, at);
  }
}

/** Call when a ticket leaves resolved / do-not-action. */
export function clearTicketResolvedAt(rowId: string): void {
  setTicketResolvedAt(rowId, null);
}

export function overlayHasActiveGmailLink(rowId: string): boolean {
  const overlay = getTicketOverlay(rowId);
  return Boolean(
    overlay.gmailThreadId || getGmailThreadOpenUrl(rowId) || getGmailThreadImportCutoff(rowId)
  );
}
