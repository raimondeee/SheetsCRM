import { ensureCrmTicketEventsTable } from "./crm-ticket-log";
import { getOverlayDb } from "./overlay-db";
import { normalizeStatusId } from "./status-mapper";
import type { TimeInterval } from "./business-hours";

export const PAUSE_STATUSES = new Set(["pending", "longterm_hold", "on_hold"]);

/** Pause windows while a ticket was Pending, Long-term hold, or On hold. */
export function loadPauseIntervalsMap(asOf?: Date): Map<string, TimeInterval[]> {
  ensureCrmTicketEventsTable();
  const rows = getOverlayDb()
    .prepare(
      `SELECT ticket_row_id, kind, summary, detail_json, created_at
       FROM crm_ticket_events
       WHERE kind IN ('status_change', 'pending_timer', 'auto_reopen')
       ORDER BY ticket_row_id, created_at ASC`
    )
    .all() as Array<{
    ticket_row_id: string;
    kind: string;
    summary: string;
    detail_json: string | null;
    created_at: string;
  }>;

  const map = new Map<string, TimeInterval[]>();
  const openPause = new Map<string, Date>();

  for (const row of rows) {
    const detail = row.detail_json
      ? (JSON.parse(row.detail_json) as Record<string, unknown>)
      : null;
    const to = typeof detail?.to === "string" ? normalizeStatusId(detail.to) : null;
    const from = typeof detail?.from === "string" ? normalizeStatusId(detail.from) : null;

    if (to && PAUSE_STATUSES.has(to)) {
      openPause.set(row.ticket_row_id, new Date(row.created_at));
      continue;
    }

    if (from && PAUSE_STATUSES.has(from)) {
      const start = openPause.get(row.ticket_row_id);
      if (start) {
        const list = map.get(row.ticket_row_id) ?? [];
        list.push({ start, end: new Date(row.created_at) });
        map.set(row.ticket_row_id, list);
        openPause.delete(row.ticket_row_id);
      }
    }
  }

  if (asOf) {
    for (const [ticketRowId, start] of openPause) {
      const list = map.get(ticketRowId) ?? [];
      list.push({ start, end: asOf });
      map.set(ticketRowId, list);
    }
  }

  return map;
}
