import type { ThreadMessage } from "./types";
import { extractEmailFromField } from "./email-utils";

/** Split comma/semicolon-separated recipient lists. */
export function parseRecipientList(value: string): string[] {
  return value
    .split(/[,;]/)
    .map((part) => part.trim())
    .filter(Boolean);
}

export function joinRecipientList(parts: string[]): string {
  return parts.join(", ");
}

/** Parse RFC 5322-style To/Cc header values into unique email addresses. */
export function parseHeaderRecipientList(headerValue: string): string[] {
  const trimmed = headerValue.trim();
  if (!trimmed) return [];

  const results: string[] = [];
  const seen = new Set<string>();

  for (const match of trimmed.matchAll(/<?([^\s<>,;"]+@[^\s<>,;"]+)>?/g)) {
    const email = match[1]!.trim();
    const normalized = email.toLowerCase();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    results.push(email);
  }

  return results;
}

export function mergeRecipientLists(base: string, extra: string): string {
  let merged = base;
  for (const recipient of parseRecipientList(extra)) {
    merged = appendRecipient(merged, recipient);
  }
  return merged;
}

/** Collect CC parties from synced thread messages, excluding requester and agents. */
export function deriveThreadCcRecipients(
  messages: Pick<ThreadMessage, "cc" | "from" | "direction">[],
  options: { requesterEmail: string }
): string {
  const exclude = new Set<string>();
  const requester = extractEmailFromField(options.requesterEmail)?.toLowerCase();
  if (requester) exclude.add(requester);

  for (const msg of messages) {
    if (msg.direction !== "outbound") continue;
    const from = extractEmailFromField(msg.from)?.toLowerCase();
    if (from) exclude.add(from);
  }

  const collected: string[] = [];
  const seen = new Set<string>();

  for (const msg of messages) {
    if (!msg.cc?.trim()) continue;
    for (const raw of parseRecipientList(msg.cc)) {
      const email = (extractEmailFromField(raw) ?? raw).trim();
      const normalized = email.toLowerCase();
      if (!normalized || exclude.has(normalized) || seen.has(normalized)) continue;
      seen.add(normalized);
      collected.push(email);
    }
  }

  return joinRecipientList(collected);
}

export function appendRecipient(value: string, email: string): string {
  const normalized = email.trim().toLowerCase();
  if (!normalized) return value;
  const parts = parseRecipientList(value);
  if (parts.some((part) => part.toLowerCase() === normalized)) return value;
  return joinRecipientList([...parts, email.trim()]);
}

export function removeRecipient(value: string, email: string): string {
  const normalized = email.trim().toLowerCase();
  if (!normalized) return value;
  return joinRecipientList(
    parseRecipientList(value).filter((part) => part.toLowerCase() !== normalized)
  );
}

export function buildOutboundCc(
  ccDraft: string,
  options?: { extra?: string | null }
): string | null {
  const parts = parseRecipientList(ccDraft);
  const extra = options?.extra?.trim();
  if (extra && !parts.some((part) => part.toLowerCase() === extra.toLowerCase())) {
    parts.push(extra);
  }
  return parts.length ? joinRecipientList(parts) : null;
}

export function buildOutboundBcc(bccDraft: string): string | null {
  const parts = parseRecipientList(bccDraft);
  return parts.length ? joinRecipientList(parts) : null;
}
