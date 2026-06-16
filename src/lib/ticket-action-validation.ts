export type TicketActionRequiredField = "airbnbUserId" | "subject" | "compose";

export const REQUIRED_FIELD_MISSING_MESSAGE = "A required field is missing.";

export interface TicketActionValidation {
  message: string;
  fields: TicketActionRequiredField[];
}

export function hasAirbnbUserIdForResolve(userId: string): boolean {
  return userId.trim().length > 0;
}
