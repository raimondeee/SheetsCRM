/** Common intake contact reasons (from team dashboard). */
export const COMMON_CONTACT_REASONS = [
  "Quality Appeals",
  "Reviews",
  "CBA",
  "Claims",
  "Issue with Refund",
  "Other",
  "Tax/Regulations",
  "Address Update",
  "Host Education",
  "Payments/Payout",
  "Safety",
  "API",
  "Trust",
  "Cancellation Policies",
  "POI Change",
  "KYC",
];

export function buildContactReasonOptions(tickets: { contactReason: string }[]): string[] {
  const fromTickets = tickets
    .map((t) => t.contactReason.trim())
    .filter(Boolean);
  return [...new Set([...COMMON_CONTACT_REASONS, ...fromTickets])].sort((a, b) =>
    a.localeCompare(b, undefined, { sensitivity: "base" })
  );
}
