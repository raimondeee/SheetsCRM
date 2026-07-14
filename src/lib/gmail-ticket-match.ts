import type { Ticket } from "./types";

export interface GmailThreadPreview {
  fromEmail: string;
  from: string;
  subject: string;
}

export interface LinkableTicketMatch {
  rowId: string;
  rowNumber: number;
  requesterEmail: string;
  crmSubjectLabel: string;
  reservationCode: string;
  status: string;
  hasGmailLink: boolean;
  score: number;
  reasons: string[];
}

const RESERVATION_CODE = /\bH[A-Z0-9]{8,12}\b/i;

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

function tokenizeSubject(subject: string): Set<string> {
  return new Set(
    subject
      .toLowerCase()
      .split(/[^a-z0-9]+/i)
      .map((token) => token.trim())
      .filter((token) => token.length >= 3)
  );
}

function scoreTicketForThread(thread: GmailThreadPreview, ticket: Ticket): LinkableTicketMatch | null {
  const reasons: string[] = [];
  let score = 0;

  const threadEmail = normalizeEmail(thread.fromEmail);
  const ticketEmail = normalizeEmail(ticket.requesterEmail);
  if (threadEmail && ticketEmail && threadEmail === ticketEmail) {
    score += 100;
    reasons.push("Same requester email");
  }

  const reservation = ticket.reservationCode.trim();
  if (reservation && thread.subject.toLowerCase().includes(reservation.toLowerCase())) {
    score += 60;
    reasons.push("Reservation code in subject");
  } else {
    const threadCode = thread.subject.match(RESERVATION_CODE)?.[0];
    if (threadCode && reservation && threadCode.toUpperCase() === reservation.toUpperCase()) {
      score += 60;
      reasons.push("Reservation code in subject");
    }
  }

  const listingId = ticket.listingId.trim();
  if (listingId && thread.subject.includes(listingId)) {
    score += 40;
    reasons.push("Listing ID in subject");
  }

  const subjectTokens = tokenizeSubject(thread.subject);
  const ticketSubjectTokens = tokenizeSubject(
    `${ticket.crmSubjectLabel} ${ticket.subject} ${ticket.requesterName}`
  );
  let overlap = 0;
  for (const token of subjectTokens) {
    if (ticketSubjectTokens.has(token)) overlap += 1;
  }
  if (overlap >= 2) {
    score += Math.min(overlap * 8, 32);
    reasons.push("Subject overlap");
  }

  if (score < 40) return null;

  return {
    rowId: ticket.rowId,
    rowNumber: ticket.rowNumber,
    requesterEmail: ticket.requesterEmail,
    crmSubjectLabel: ticket.crmSubjectLabel || ticket.subject,
    reservationCode: ticket.reservationCode,
    status: ticket.status,
    hasGmailLink: Boolean(ticket.gmailOpenUrl),
    score,
    reasons,
  };
}

export function findLinkableTicketsForThread(
  thread: GmailThreadPreview,
  tickets: Ticket[],
  limit = 8
): LinkableTicketMatch[] {
  const matches: LinkableTicketMatch[] = [];
  for (const ticket of tickets) {
    const match = scoreTicketForThread(thread, ticket);
    if (match) matches.push(match);
  }
  return matches
    .sort(
      (a, b) =>
        b.score - a.score ||
        a.rowNumber - b.rowNumber ||
        a.crmSubjectLabel.localeCompare(b.crmSubjectLabel)
    )
    .slice(0, limit);
}
