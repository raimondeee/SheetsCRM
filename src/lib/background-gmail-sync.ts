import { syncGmailThreadForTicket } from "./gmail";
import {
  ensureBackgroundGmailSyncEnabled,
  getBackgroundGmailSyncSchedule,
  markBackgroundGmailSyncAttempt,
  mergeOverlayOntoTicket,
  ticketHasExplicitGmailLink,
} from "./overlay-db";
import { ticketGmailLinkIsArchived } from "./gmail-link-archive";
import { normalizeStatusId } from "./status-mapper";
import type { TimerSettings } from "./timer-settings";
import type { Ticket } from "./types";

/** Pending tickets: check Gmail for customer replies every 10 minutes. */
export const BACKGROUND_GMAIL_SYNC_PENDING_MS = 10 * 60 * 1000;

/** Resolved tickets: check Gmail every 24 hours. */
export const BACKGROUND_GMAIL_SYNC_RESOLVED_MS = 24 * 60 * 60 * 1000;

const MAX_CONCURRENT_SYNCS = 4;

function syncIntervalMs(status: string): number | null {
  const normalized = normalizeStatusId(status);
  if (normalized === "pending") return BACKGROUND_GMAIL_SYNC_PENDING_MS;
  if (normalized === "resolved") return BACKGROUND_GMAIL_SYNC_RESOLVED_MS;
  return null;
}

export function isTicketDueForBackgroundGmailSync(ticket: Ticket, now = Date.now()): boolean {
  const interval = syncIntervalMs(ticket.status);
  if (!interval) return false;
  if (!ticket.requesterEmail?.trim()) return false;
  if (ticketGmailLinkIsArchived(ticket.rowId)) return false;
  if (normalizeStatusId(ticket.status) === "resolved" && !ticketHasExplicitGmailLink(ticket.rowId)) {
    return false;
  }

  let schedule = getBackgroundGmailSyncSchedule(ticket.rowId);
  if (!schedule) {
    ensureBackgroundGmailSyncEnabled(ticket.rowId);
    schedule = getBackgroundGmailSyncSchedule(ticket.rowId);
    if (!schedule) return false;
    return true;
  }

  const anchorMs = new Date(schedule.lastAt ?? schedule.enabledAt).getTime();
  if (Number.isNaN(anchorMs)) return false;

  return now - anchorMs >= interval;
}

async function syncOneTicket(ticket: Ticket): Promise<string> {
  try {
    await syncGmailThreadForTicket({
      ticketRowId: ticket.rowId,
      requesterEmail: ticket.requesterEmail,
      intakeTimestamp: ticket.timestamp,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[SheetsCRM background Gmail sync] ${ticket.rowId}: ${message}`);
  } finally {
    markBackgroundGmailSyncAttempt(ticket.rowId);
  }
  return ticket.rowId;
}

async function syncTicketsWithConcurrency(
  tickets: Ticket[],
  concurrency: number
): Promise<Set<string>> {
  const synced = new Set<string>();
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < tickets.length) {
      const ticket = tickets[nextIndex]!;
      nextIndex += 1;
      const rowId = await syncOneTicket(ticket);
      synced.add(rowId);
    }
  }

  const workers = Math.min(concurrency, tickets.length);
  await Promise.all(Array.from({ length: workers }, () => worker()));
  return synced;
}

/** Sync due pending/resolved tickets, then re-merge overlay fields for those rows. */
export async function runBackgroundGmailSyncForTickets(
  tickets: Ticket[],
  timerSettings: TimerSettings
): Promise<Ticket[]> {
  const due = tickets.filter((ticket) => isTicketDueForBackgroundGmailSync(ticket));
  if (due.length === 0) return tickets;

  const syncedRowIds = await syncTicketsWithConcurrency(due, MAX_CONCURRENT_SYNCS);
  if (syncedRowIds.size === 0) return tickets;

  return tickets.map((ticket) =>
    syncedRowIds.has(ticket.rowId)
      ? mergeOverlayOntoTicket(ticket, undefined, timerSettings)
      : ticket
  );
}
