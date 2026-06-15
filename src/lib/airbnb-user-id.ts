import { EXAMPLE_COLUMN_POSITIONS } from "./default-sheet-config";
import { isNumericUserId } from "./become-user-url";
import type { Ticket } from "./types";
import { indexToLetter } from "./types";

export type AirbnbUserIdSource = "sheet" | "crm" | "column_d";

export interface AirbnbUserIdOverlay {
  crmAirbnbUserId: string | null;
  airbnbUserIdSource: AirbnbUserIdSource;
}

/** CRM overlay wins, then Column AD, then numeric Column D. */
export function resolveTicketAirbnbUserId(
  sheetAirbnbUserId: string,
  columnD: string,
  overlay: AirbnbUserIdOverlay
): string {
  if (overlay.airbnbUserIdSource === "crm" && overlay.crmAirbnbUserId?.trim()) {
    return overlay.crmAirbnbUserId.trim();
  }

  const fromSheet = sheetAirbnbUserId.trim();
  if (fromSheet) return fromSheet;

  const fromColumnD = columnD.trim();
  if (isNumericUserId(fromColumnD)) return fromColumnD;

  return "";
}

/** Value currently stored in sheet Column AD (not CRM overlay or Column D fallback). */
export function getSheetColumnAirbnbUserId(ticket: Ticket): string {
  const adLetter = EXAMPLE_COLUMN_POSITIONS.airbnbUserId.letter;
  const adIndex = EXAMPLE_COLUMN_POSITIONS.airbnbUserId.index;
  const candidates = [
    `Column ${adLetter}`,
    adLetter,
    "Airbnb User ID",
    "Airbnb user ID",
  ];

  for (const key of candidates) {
    const value = ticket.raw[key]?.trim();
    if (value) return value;
  }

  for (const [key, value] of Object.entries(ticket.raw)) {
    if (/airbnb\s*user\s*id/i.test(key)) return value.trim();
  }

  return (ticket.raw[`Column ${indexToLetter(adIndex)}`] ?? "").trim();
}

export function shouldBackfillAirbnbUserIdFromColumnD(
  sheetAirbnbUserId: string,
  columnD: string,
  overlay: Pick<AirbnbUserIdOverlay, "airbnbUserIdSource">
): boolean {
  if (overlay.airbnbUserIdSource === "crm") return false;
  if (sheetAirbnbUserId.trim()) return false;
  return isNumericUserId(columnD);
}
