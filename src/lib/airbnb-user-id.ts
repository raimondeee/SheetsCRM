import { isNumericUserId } from "./become-user-url";

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

export function shouldBackfillAirbnbUserIdFromColumnD(
  sheetAirbnbUserId: string,
  columnD: string,
  overlay: Pick<AirbnbUserIdOverlay, "airbnbUserIdSource">
): boolean {
  if (overlay.airbnbUserIdSource === "crm") return false;
  if (sheetAirbnbUserId.trim()) return false;
  return isNumericUserId(columnD);
}
