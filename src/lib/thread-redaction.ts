export function buildRedactedMessagePlaceholderBody(sentAt: string): string {
  const when = new Date(sentAt).toLocaleString();
  return (
    `A message from ${when} was redacted from the CRM and will not be re-imported from Gmail.\n\n` +
    `If it contained sensitive information, delete the corresponding message in Gmail as well (Trash → Delete forever).`
  );
}

export function buildRedactAdminNote(params: {
  direction: "inbound" | "outbound";
  sentAt: string;
}): string {
  const when = new Date(params.sentAt).toLocaleString();
  const label = params.direction === "inbound" ? "inbound" : "outbound";
  return `Redacted CRM copy of ${label} email from ${when}. Delete the message in Gmail if it contained sensitive information.`;
}
