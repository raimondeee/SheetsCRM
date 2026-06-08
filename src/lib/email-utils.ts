/** Pull an email address from a sheet cell (plain email or "Name <email>"). */
export function extractEmailFromField(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  const angle = trimmed.match(/<([^>]+)>/);
  if (angle?.[1]) return angle[1].trim();

  const plain = trimmed.match(/[^\s<>]+@[^\s<>]+\.[^\s<>]+/);
  return plain?.[0] ?? null;
}
