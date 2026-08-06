import { isNumericUserId } from "./become-user-url";

export type TicketActionRequiredField = "airbnbUserId" | "subject" | "compose";

export const REQUIRED_FIELD_MISSING_MESSAGE = "A required field is missing.";

export const AIRBNB_USER_ID_REQUIRED_MESSAGE =
  "Enter a numeric Airbnb User ID in Internal tools before resolving, or confirm No user ID.";

export interface TicketActionValidation {
  message: string;
  fields: TicketActionRequiredField[];
}

/** Resolve/close requires a manually entered numeric Internal Tools User ID (field B). */
export function hasAirbnbUserIdForResolve(userId: string): boolean {
  return isNumericUserId(userId);
}

/** Resolve/close is allowed with a numeric Manual User ID, or an explicit No user ID exemption. */
export function canResolveWithoutAirbnbUserId(exempt: boolean): boolean {
  return exempt === true;
}

export function passesAirbnbUserIdResolveGate(params: {
  manualUserId: string;
  exempt: boolean;
}): boolean {
  if (params.exempt) return true;
  return hasAirbnbUserIdForResolve(params.manualUserId);
}
