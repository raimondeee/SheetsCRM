export function parseGmailThreadId(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  const hashMatch = trimmed.match(/#(?:inbox|all|sent|starred|search)\/([a-zA-Z0-9]+)/);
  if (hashMatch?.[1]) return hashMatch[1];

  if (/^[a-f0-9]+$/i.test(trimmed)) return trimmed;

  return null;
}

export function buildThreadLinkNoticeBody(linkedAt: Date): string {
  const dateLabel = linkedAt.toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  return (
    `Gmail thread linked on ${dateLabel}. ` +
    "Messages sent before this date are not shown here — view the full history in Gmail."
  );
}
