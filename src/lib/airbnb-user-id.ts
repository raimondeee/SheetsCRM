import { isNumericUserId } from "./become-user-url";
import type { Ticket } from "./types";

export type AirbnbUserIdSource = "sheet" | "crm" | "column_d";

export interface AirbnbUserIdOverlay {
  crmAirbnbUserId: string | null;
  airbnbUserIdSource: AirbnbUserIdSource;
}

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

/** CRM manual override, then intake form header, then mapped sheet column, then mapped email column. */
export function resolveTicketAirbnbUserId(
  sheetAirbnbUserId: string,
  emailColumnValue: string,
  headerField: string,
  overlay: AirbnbUserIdOverlay
): string {
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

/** Salesforce uses manual sidebar ID when set; otherwise the intake form header value. */
export function resolveSalesforceSearchQuery(
  ticket: Pick<Ticket, "headerField" | "crmAirbnbUserId">
): string {
  const manual = ticket.crmAirbnbUserId?.trim();
  if (manual) return manual;
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
  if (overlay.airbnbUserIdSource === "crm") return false;
  if (sheetAirbnbUserId.trim()) return false;
  return isNumericUserId(emailColumnValue);
}
