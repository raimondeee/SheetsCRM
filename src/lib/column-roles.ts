import type { ColumnMapping, ColumnRole, SheetConfig } from "./types";

export const COLUMN_ROLE_OPTIONS: { value: ColumnRole; label: string; hint?: string }[] = [
  { value: "unknown", label: "— Not mapped —" },
  { value: "rowKey", label: "Row key", hint: "Rows with an empty value here are skipped" },
  { value: "timestamp", label: "Timestamp" },
  { value: "email", label: "Requester email" },
  { value: "name", label: "Requester name", hint: "Used for Mixmax {{first name}} placeholders" },
  { value: "subject", label: "Subject" },
  { value: "description", label: "Description / message" },
  { value: "marketManager", label: "Market Manager", hint: "Read-only in CRM" },
  { value: "contactReason", label: "Contact reason" },
  { value: "userEmailed", label: "User emailed?", hint: "Set to Yes when CRM sends a reply" },
  { value: "status", label: "Sheet status" },
  { value: "caseSummary", label: "Case summary / admin notes column" },
  { value: "airbnbUserId", label: "Airbnb User ID" },
  { value: "reservationCode", label: "Reservation code (E)", hint: "Read-only in CRM" },
  { value: "listingId", label: "Listing ID (F)", hint: "Read-only in CRM" },
  { value: "internalToolK", label: "Internal tool (K)" },
  { value: "internalToolM", label: "Internal tool (M)" },
  { value: "internalToolR", label: "Internal tool (R)" },
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
  "listingId",
  "internalToolK",
  "internalToolM",
  "internalToolR",
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

export function highlightMappedRow(col: ColumnMapping): boolean {
  return col.role !== "unknown";
}
