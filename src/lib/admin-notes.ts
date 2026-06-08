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
