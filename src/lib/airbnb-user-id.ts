import { isNumericUserId } from "./become-user-url";
import type { Ticket } from "./types";

export type AirbnbUserIdSource = "sheet" | "crm" | "column_d" | "exempt";

export interface AirbnbUserIdOverlay {
  crmAirbnbUserId: string | null;
  airbnbUserIdSource: AirbnbUserIdSource;
}

/** Confirmation copy when an agent opts out of entering a manual numeric User ID. */
export const NO_AIRBNB_USER_ID_CONFIRM_MESSAGE =
  "This value is required for a variety of reporting tools. Only disable this field if the user is not supposed to have submitted an intake, or if they do not have an Airbnb User ID — use the most relevant child account.\n\nDisable Manual User ID for this case?";

/** Value the host submitted on the intake form (Header field under subject / ui-1). */
export function intakeAirbnbUserIdFromTicket(ticket: Pick<Ticket, "headerField">): string {
  return ticket.headerField.trim();
}

/** Manual override from Internal tools sidebar (saved to mapped airbnbUserId sheet column). */
export function manualAirbnbUserIdFromOverlay(overlay: AirbnbUserIdOverlay): string | null {
  if (overlay.airbnbUserIdSource !== "crm") return null;
  const trimmed = overlay.crmAirbnbUserId?.trim();
  return trimmed || null;
}

export function isAirbnbUserIdExempt(
  overlay: Pick<AirbnbUserIdOverlay, "airbnbUserIdSource"> | Pick<Ticket, "airbnbUserIdExempt">
): boolean {
  if ("airbnbUserIdExempt" in overlay) {
    return overlay.airbnbUserIdExempt === true;
  }
  return overlay.airbnbUserIdSource === "exempt";
}

/** CRM manual override, then intake form header, then mapped sheet column, then mapped email column. */
export function resolveTicketAirbnbUserId(
  sheetAirbnbUserId: string,
  emailColumnValue: string,
  headerField: string,
  overlay: AirbnbUserIdOverlay
): string {
  if (overlay.airbnbUserIdSource === "exempt") return "";

  const manual = manualAirbnbUserIdFromOverlay(overlay);
  if (manual) return manual;

  const fromHeader = headerField.trim();
  if (fromHeader) return fromHeader;

  const fromSheet = sheetAirbnbUserId.trim();
  if (fromSheet) return fromSheet;

  const fromEmailColumn = emailColumnValue.trim();
  if (isNumericUserId(fromEmailColumn)) return fromEmailColumn;

  return "";
}

/**
 * Salesforce Search: prefer a manually entered numeric Internal Tools ID (B).
 * Otherwise fall back to the form-submitted value (A), even when A is an email.
 */
export function resolveSalesforceSearchQuery(
  ticket: Pick<Ticket, "headerField" | "crmAirbnbUserId" | "airbnbUserIdExempt">,
  draftManualId?: string
): string {
  if (ticket.airbnbUserIdExempt) {
    return intakeAirbnbUserIdFromTicket(ticket);
  }
  const manual = (draftManualId ?? ticket.crmAirbnbUserId ?? "").trim();
  if (isNumericUserId(manual)) return manual;
  return intakeAirbnbUserIdFromTicket(ticket);
}

/** Value currently stored in the mapped Airbnb User ID sheet column. */
export function getSheetColumnAirbnbUserId(ticket: Ticket): string {
  for (const [key, value] of Object.entries(ticket.raw)) {
    if (/airbnb\s*user\s*id/i.test(key)) return value.trim();
  }
  return ticket.airbnbUserId.trim();
}

/** True when Internal tools has a saved manual numeric User ID override. */
export function hasManualNumericAirbnbUserId(
  ticket: Pick<Ticket, "crmAirbnbUserId">
): boolean {
  return isNumericUserId(ticket.crmAirbnbUserId ?? "");
}

export function shouldBackfillAirbnbUserIdFromColumnD(
  sheetAirbnbUserId: string,
  emailColumnValue: string,
  overlay: Pick<AirbnbUserIdOverlay, "airbnbUserIdSource">
): boolean {
  if (overlay.airbnbUserIdSource === "crm" || overlay.airbnbUserIdSource === "exempt") {
    return false;
  }
  if (sheetAirbnbUserId.trim()) return false;
  return isNumericUserId(emailColumnValue);
}
