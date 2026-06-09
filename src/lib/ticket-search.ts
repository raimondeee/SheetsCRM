import type { Ticket } from "./types";

const RESO_LISTING_RAW_KEY = /reso|reservation|listing|property|space|confirmation/i;

function normalizeSearchToken(value: string): string {
  return value.toLowerCase().replace(/[\s_\-./]+/g, "");
}

function valueMatchesQuery(value: string, query: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;

  const q = query.trim();
  if (!q) return true;

  if (trimmed.toLowerCase().includes(q.toLowerCase())) return true;
  return normalizeSearchToken(trimmed).includes(normalizeSearchToken(q));
}

/** Collect reso + listing values from mapped fields and raw sheet columns (E/F, headers). */
export function getResoAndListingValues(ticket: Ticket): string[] {
  const values = new Set<string>();

  const add = (value: string | undefined | null) => {
    const trimmed = value?.trim();
    if (trimmed) values.add(trimmed);
  };

  add(ticket.reservationCode);
  add(ticket.listingId);

  for (const [key, value] of Object.entries(ticket.raw)) {
    if (RESO_LISTING_RAW_KEY.test(key)) add(value);
  }

  add(ticket.raw.E);
  add(ticket.raw.F);
  add(ticket.raw["Column E"]);
  add(ticket.raw["Column F"]);

  return [...values];
}

export function ticketHasResoOrListingValue(ticket: Ticket): boolean {
  return getResoAndListingValues(ticket).length > 0;
}

/** Match when the query hits a reso or listing ID on the ticket. */
export function ticketMatchesResoOrListingSearch(ticket: Ticket, query: string): boolean {
  const q = query.trim();
  if (!q) return false;
  return getResoAndListingValues(ticket).some((value) => valueMatchesQuery(value, q));
}

function generalSearchValues(ticket: Ticket): string[] {
  return [
    ticket.requesterEmail,
    ticket.columnD,
    ticket.requesterName,
    ticket.subject,
    ticket.airbnbUserId,
    ...getResoAndListingValues(ticket),
  ];
}

/** Match tickets by email, reso, listing ID, name, subject, or user ID (partial, case-insensitive). */
export function ticketMatchesSearch(ticket: Ticket, query: string): boolean {
  const q = query.trim();
  if (!q) return true;
  return generalSearchValues(ticket).some((value) => valueMatchesQuery(value, q));
}

/** Status filter + search; reso/listing matches are shown across all CRM statuses. */
export function ticketPassesListFilters(params: {
  ticket: Ticket;
  statusFilter: string;
  search: string;
}): boolean {
  const q = params.search.trim();
  const matchStatus =
    params.statusFilter === "all" || params.ticket.status === params.statusFilter;

  if (!q) return matchStatus;
  if (ticketMatchesResoOrListingSearch(params.ticket, q)) return true;
  return matchStatus && ticketMatchesSearch(params.ticket, q);
}
