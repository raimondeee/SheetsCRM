import type { TicketGmailThreadLink } from "./ticket-gmail-threads";
import {
  GMAIL_THREAD_APPEND_NOTICE_SUBJECT,
  GMAIL_THREAD_LINK_NOTICE_SUBJECT,
} from "./gmail-thread-link";
import { getLinkedGmailThreadsForTicket } from "./overlay-db";

const LINK_NOTICE_MATCH_MS = 5_000;

export function resolveThreadIdForLinkNotice(
  ticketRowId: string,
  notice: { subject: string; sentAt: string }
): string | null {
  const links = getLinkedGmailThreadsForTicket(ticketRowId);
  if (notice.subject === GMAIL_THREAD_LINK_NOTICE_SUBJECT) {
    return links.find((link) => link.isPrimary)?.gmailThreadId ?? null;
  }

  if (notice.subject === GMAIL_THREAD_APPEND_NOTICE_SUBJECT) {
    return matchAppendedThreadByTime(links, notice.sentAt)?.gmailThreadId ?? null;
  }

  return null;
}

function matchAppendedThreadByTime(
  links: TicketGmailThreadLink[],
  noticeSentAt: string
): TicketGmailThreadLink | null {
  const noticeMs = new Date(noticeSentAt).getTime();
  if (!Number.isFinite(noticeMs)) return null;

  let best: TicketGmailThreadLink | null = null;
  let bestDelta = Infinity;

  for (const link of links) {
    if (link.isPrimary) continue;
    const linkedMs = new Date(link.linkedAt).getTime();
    if (!Number.isFinite(linkedMs)) continue;
    const delta = Math.abs(linkedMs - noticeMs);
    if (delta < bestDelta) {
      bestDelta = delta;
      best = link;
    }
  }

  return bestDelta <= LINK_NOTICE_MATCH_MS ? best : null;
}
