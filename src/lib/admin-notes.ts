export const RESOLVED_WITHOUT_EMAIL_NOTE = "Marked as resolved (no email sent)";

export const PENDING_WITHOUT_EMAIL_HOURS_OPTIONS = [4, 24, 72] as const;
export type PendingWithoutEmailHours = (typeof PENDING_WITHOUT_EMAIL_HOURS_OPTIONS)[number];

export function pendingWithoutEmailAdminNote(hours: PendingWithoutEmailHours): string {
  return `Set to pending ${hours}h (no email sent)`;
}

/** @deprecated Use pendingWithoutEmailAdminNote(hours) */
export const PENDING_WITHOUT_EMAIL_NOTE = "Set to pending (no email sent)";

/** Format: • MM/DD/YYYY - note text */
export function formatAdminNoteLine(note: string, date = new Date()): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const year = date.getFullYear();
  return `• ${month}/${day}/${year} - ${note.trim()}`;
}

export function appendAdminNoteToText(existing: string, newNote: string): string {
  const line = formatAdminNoteLine(newNote);
  const trimmed = existing.trim();
  return trimmed ? `${trimmed}\n${line}` : line;
}
