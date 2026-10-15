import type { MarketManager } from "./market-managers";
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

type ThreadRecipientMessage = Pick<ThreadMessage, "cc" | "to" | "from" | "direction">;

function normalizedAddress(raw: string): string | null {
  const email = extractEmailFromField(raw)?.trim().toLowerCase();
  if (!email || !email.includes("@")) return null;
  return email;
}

function headerAddresses(header: string | null | undefined): string[] {
  if (!header?.trim()) return [];
  return parseHeaderRecipientList(header);
}

/** Agent addresses are whoever sent outbound mail on this ticket. */
export function agentAddressesOnThread(
  messages: Pick<ThreadMessage, "from" | "direction">[]
): string[] {
  const agents: string[] = [];
  const seen = new Set<string>();
  for (const msg of messages) {
    if (msg.direction !== "outbound") continue;
    const email = normalizedAddress(msg.from);
    if (!email || seen.has(email)) continue;
    seen.add(email);
    agents.push(email);
  }
  return agents;
}

/**
 * Everyone who should stay on the next reply: Cc, extra To addresses, and
 * inbound senders. The ticket requester stays in To. The agent is omitted.
 */
export function deriveThreadCcRecipients(
  messages: ThreadRecipientMessage[],
  options: { requesterEmail: string }
): string {
  const exclude = new Set<string>();
  const requester = normalizedAddress(options.requesterEmail);
  if (requester) exclude.add(requester);
  for (const agent of agentAddressesOnThread(messages)) exclude.add(agent);

  const collected: string[] = [];
  const seen = new Set<string>();

  function add(raw: string) {
    const email = extractEmailFromField(raw)?.trim();
    if (!email) return;
    const normalized = email.toLowerCase();
    if (exclude.has(normalized) || seen.has(normalized)) return;
    seen.add(normalized);
    collected.push(email);
  }

  for (const msg of messages) {
    for (const email of headerAddresses(msg.cc)) add(email);
    for (const email of headerAddresses(msg.to)) add(email);
    if (msg.direction === "inbound") add(msg.from);
  }

  return joinRecipientList(collected);
}

/**
 * People on a message's To line who are not the requester, the agent, or
 * already listed in that message's Cc. Hosts often add someone on To.
 */
export function messageAddedToRecipients(
  msg: Pick<ThreadMessage, "to" | "cc">,
  options: { requesterEmail: string; agentEmails: string[] }
): string[] {
  const exclude = new Set<string>();
  const requester = normalizedAddress(options.requesterEmail);
  if (requester) exclude.add(requester);
  for (const agent of options.agentEmails) {
    const normalized = normalizedAddress(agent);
    if (normalized) exclude.add(normalized);
  }
  for (const email of headerAddresses(msg.cc)) {
    const normalized = normalizedAddress(email);
    if (normalized) exclude.add(normalized);
  }

  const added: string[] = [];
  const seen = new Set<string>();
  for (const email of headerAddresses(msg.to)) {
    const normalized = normalizedAddress(email);
    if (!normalized || exclude.has(normalized) || seen.has(normalized)) continue;
    seen.add(normalized);
    added.push(email);
  }
  return added;
}

/** Recipients on the thread who were not on the agent's most recent send. */
export function recipientsAddedSinceLastAgentSend(
  messages: ThreadRecipientMessage[],
  options: { requesterEmail: string }
): string[] {
  const lastOutbound = [...messages].reverse().find((msg) => msg.direction === "outbound");
  if (!lastOutbound) return [];

  const already = new Set<string>();
  for (const email of [
    ...headerAddresses(lastOutbound.to),
    ...headerAddresses(lastOutbound.cc),
  ]) {
    const normalized = normalizedAddress(email);
    if (normalized) already.add(normalized);
  }

  return parseRecipientList(
    deriveThreadCcRecipients(messages, options)
  ).filter((email) => {
    const normalized = normalizedAddress(email);
    return normalized && !already.has(normalized);
  });
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

/** Recipient token being edited at the text cursor (after the last comma/semicolon). */
export function currentRecipientFragment(value: string, cursorIndex = value.length): string {
  const before = value.slice(0, cursorIndex);
  const match = before.match(/(?:^|[,;]\s*)([^,;]*)$/);
  return (match?.[1] ?? "").trim();
}

/** Replace the in-progress recipient token with a chosen email address. */
export function commitRecipientSuggestion(
  value: string,
  cursorIndex: number,
  email: string
): string {
  const trimmedEmail = email.trim();
  if (!trimmedEmail) return value;

  const before = value.slice(0, cursorIndex);
  const after = value.slice(cursorIndex);
  const prefixMatch = before.match(/^(.*?)([,;]\s*)?[^,;]*$/);
  const base = (prefixMatch?.[1] ?? "").replace(/[,;]\s*$/, "").trim();
  const trailing = after.replace(/^[^,;]*/, "");
  const withoutPartial = [base, trailing.replace(/^[,;]\s*/, "")].filter(Boolean).join(", ");
  return appendRecipient(withoutPartial, trimmedEmail);
}

export function filterMarketManagerSuggestions(
  managers: MarketManager[],
  draft: string,
  cursorIndex: number,
  limit = 8
): MarketManager[] {
  const fragment = currentRecipientFragment(draft, cursorIndex).toLowerCase();
  const existing = new Set(parseRecipientList(draft).map((part) => part.toLowerCase()));

  return managers
    .filter((manager) => {
      const email = manager.email.trim().toLowerCase();
      if (!email || existing.has(email)) return false;
      if (!fragment) return true;
      const name = manager.name.trim().toLowerCase();
      return name.includes(fragment) || email.includes(fragment);
    })
    .slice(0, limit);
}
