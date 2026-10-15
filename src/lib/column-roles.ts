import type { ColumnMapping, ColumnRole, SheetConfig } from "./types";

/** Where each mapped role appears in the ticket UI (for Setup reference). */
export const CRM_ROLE_DESTINATIONS: Partial<Record<ColumnRole, string>> = {
  rowKey: "Hidden — decides which sheet rows become tickets",
  timestamp: "Ticket sorting, SLA timers, dashboard dates",
  email: "Ticket header (requester email)",
  name: "Ticket header (requester name) · Mixmax templates",
  ticketHeaderField:
    "Form value under subject · Salesforce search default (Header field legacy)",
    subject: "Sheet subject column (optional) · separate from CRM email subject prefix",
    description: "Conversation panel → Original request",
  marketManager: "Ticket header · CC Market Manager on reply",
  contactReason: "Details → Contact reason dropdown",
  userEmailed: "Sheet only — set to Yes when CRM sends email",
  status: "Details → Status · written back to sheet status column",
  caseSummary: "Admin notes · appended to sheet case summary on send",
  airbnbUserId:
    "Manual override in sidebar · written to the mapped sheet column when saved",
  reservationCode: "Details → Reso · Nova reservation link",
  claimNumber: "Details → Claims · Salesforce Care search link",
  listingId: "Details → Listing · Nova listing link",
  internalToolK: "Legacy sheet column — not shown in CRM",
  internalToolM: "Legacy sheet column — not shown in CRM",
  internalToolR: "Legacy sheet column — not shown in CRM",
  inFavorOfHost: "Close-case modal → sheet column P",
  csInTheWrong: "Close-case modal → sheet column Q",
  remediationSuccessful: "Close-case modal → sheet column R",
};

export const COLUMN_ROLE_OPTIONS: { value: ColumnRole; label: string; hint?: string }[] = [
  { value: "unknown", label: "— Not mapped —", hint: "Column ignored by CRM" },
  {
    value: "rowKey",
    label: "Row key",
    hint: CRM_ROLE_DESTINATIONS.rowKey,
  },
  {
    value: "timestamp",
    label: "Timestamp → sorting & SLA",
    hint: CRM_ROLE_DESTINATIONS.timestamp,
  },
  {
    value: "email",
    label: "Requester email → header",
    hint: CRM_ROLE_DESTINATIONS.email,
  },
  {
    value: "name",
    label: "Requester name → header",
    hint: CRM_ROLE_DESTINATIONS.name,
  },
  {
    value: "ticketHeaderField",
    label: "Header field under subject (form ID)",
    hint: CRM_ROLE_DESTINATIONS.ticketHeaderField,
  },
  {
    value: "subject",
    label: "Subject → sheet subject (optional)",
    hint: CRM_ROLE_DESTINATIONS.subject,
  },
  {
    value: "description",
    label: "Description → Conversation",
    hint: CRM_ROLE_DESTINATIONS.description,
  },
  {
    value: "marketManager",
    label: "Market Manager → header",
    hint: CRM_ROLE_DESTINATIONS.marketManager,
  },
  {
    value: "contactReason",
    label: "Contact reason → Details",
    hint: CRM_ROLE_DESTINATIONS.contactReason,
  },
  {
    value: "userEmailed",
    label: "User emailed? → sheet flag",
    hint: CRM_ROLE_DESTINATIONS.userEmailed,
  },
  {
    value: "status",
    label: "Sheet status → Details & sync",
    hint: CRM_ROLE_DESTINATIONS.status,
  },
  {
    value: "caseSummary",
    label: "Case summary → admin notes",
    hint: CRM_ROLE_DESTINATIONS.caseSummary,
  },
  {
    value: "airbnbUserId",
    label: "Manual User ID → sidebar & sheet column",
    hint: CRM_ROLE_DESTINATIONS.airbnbUserId,
  },
  {
    value: "reservationCode",
    label: "Reservation code → Reso",
    hint: CRM_ROLE_DESTINATIONS.reservationCode,
  },
  {
    value: "claimNumber",
    label: "Claim number → Claims",
    hint: CRM_ROLE_DESTINATIONS.claimNumber,
  },
  {
    value: "listingId",
    label: "Listing ID → Listing & Nova",
    hint: CRM_ROLE_DESTINATIONS.listingId,
  },
  {
    value: "internalToolK",
    label: "Legacy sheet link K (not used in CRM)",
    hint: CRM_ROLE_DESTINATIONS.internalToolK,
  },
  {
    value: "internalToolM",
    label: "Legacy sheet link M (not used in CRM)",
    hint: CRM_ROLE_DESTINATIONS.internalToolM,
  },
  {
    value: "internalToolR",
    label: "Legacy sheet link R (not used in CRM)",
    hint: CRM_ROLE_DESTINATIONS.internalToolR,
  },
  {
    value: "inFavorOfHost",
    label: "In favor of host? → close modal (P)",
    hint: CRM_ROLE_DESTINATIONS.inFavorOfHost,
  },
  {
    value: "csInTheWrong",
    label: "CS in the wrong? → close modal (Q)",
    hint: CRM_ROLE_DESTINATIONS.csInTheWrong,
  },
  {
    value: "remediationSuccessful",
    label: "Remediation successful? → close modal (R)",
    hint: CRM_ROLE_DESTINATIONS.remediationSuccessful,
  },
];

export const RECOMMENDED_ROLES: ColumnRole[] = [
  "rowKey",
  "email",
  "name",
  "marketManager",
  "contactReason",
  "status",
  "caseSummary",
  "airbnbUserId",
  "reservationCode",
  "claimNumber",
  "listingId",
  "inFavorOfHost",
  "csInTheWrong",
  "remediationSuccessful",
];

export function getMappingSummary(config: SheetConfig): {
  mapped: ColumnRole[];
  missing: ColumnRole[];
} {
  const mapped = RECOMMENDED_ROLES.filter((role) =>
    config.columns.some((c) => c.role === role)
  );
  const missing = RECOMMENDED_ROLES.filter((role) => !mapped.includes(role));
  return { mapped, missing };
}

export function roleLabel(role: ColumnRole): string {
  return COLUMN_ROLE_OPTIONS.find((o) => o.value === role)?.label ?? role;
}

export function roleDestination(role: ColumnRole): string | undefined {
  return CRM_ROLE_DESTINATIONS[role];
}

export function highlightMappedRow(col: ColumnMapping): boolean {
  return col.role !== "unknown";
}
