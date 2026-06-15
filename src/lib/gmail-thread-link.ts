import { buildGmailConversationUrl, getGmailBaseUrl } from "./gmail-urls";

const GMAIL_HASH_LABEL =
  /#(?:inbox|all|sent|starred|search|drafts|important|spam|trash)\/(.+)$/i;

export type GmailFolderHint = "sent" | "inbox";

export interface GmailLinkParsed {
  conversationId: string | null;
  openUrl: string;
  searchQuery: string | null;
  folderHint: GmailFolderHint | null;
}

/** Gmail label folder from a pasted URL (#sent/…, #inbox/…). */
export function parseGmailFolderFromInput(input: string): GmailFolderHint | null {
  const match = input.trim().match(/#(sent|inbox)\//i);
  if (!match?.[1]) return null;
  return match[1].toLowerCase() as GmailFolderHint;
}

/** Extract the Gmail conversation id (thread or legacy web id) from a URL or raw id. */
export function parseGmailConversationId(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  const hashMatch = trimmed.match(GMAIL_HASH_LABEL);
  if (hashMatch?.[1]) {
    const segments = hashMatch[1].split("/").filter(Boolean);
    if (segments.length >= 2) {
      return segments[segments.length - 1];
    }
    if (segments.length === 1) {
      const segment = segments[0];
      if (trimmed.includes("#search/") && looksLikeSearchQueryOnly(segment)) {
        return null;
      }
      return segment;
    }
  }

  if (/^[a-zA-Z0-9_-]+$/.test(trimmed) && trimmed.length >= 10) {
    return trimmed;
  }

  return null;
}

/** @deprecated Use parseGmailConversationId */
export function parseGmailThreadId(input: string): string | null {
  return parseGmailConversationId(input);
}

/** Search term from a Gmail search URL, e.g. HMEXKBDQM3 in #search/HMEXKBDQM3/… */
export function parseGmailSearchQueryFromInput(input: string): string | null {
  const hashMatch = input.trim().match(/#search\/([^/]+)/i);
  if (!hashMatch?.[1]) return null;
  const decoded = tryDecodeURIComponent(hashMatch[1]).trim();
  return decoded || null;
}

export function buildGmailSearchOpenUrl(query: string): string {
  return `${getGmailBaseUrl()}/#search/${encodeURIComponent(query)}`;
}

export function isEmailAddress(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

/** Turn a host email or raw search into a Gmail API-friendly query. */
export function normalizeGmailSearchQuery(query: string): string {
  const trimmed = tryDecodeURIComponent(query.trim());
  if (isEmailAddress(trimmed)) return `from:${trimmed}`;
  return trimmed;
}

function looksLikeGmailSearchQuery(value: string): boolean {
  const decoded = tryDecodeURIComponent(value.trim());
  if (isEmailAddress(decoded)) return true;
  return /^(from|to|subject|label|in|is):/i.test(decoded);
}

export function parseGmailLinkInput(input: string): GmailLinkParsed | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const folderHint = parseGmailFolderFromInput(trimmed);

  const searchQueryFromUrl = parseGmailSearchQueryFromInput(trimmed);
  if (trimmed.includes("#search/") && searchQueryFromUrl) {
    const conversationId = parseGmailConversationId(trimmed);
    if (!conversationId || looksLikeSearchQueryOnly(conversationId)) {
      const searchQuery = normalizeGmailSearchQuery(searchQueryFromUrl);
      return {
        conversationId: null,
        openUrl: /^https?:\/\/mail\.google\.com/i.test(trimmed)
          ? trimmed
          : buildGmailSearchOpenUrl(searchQuery),
        searchQuery,
        folderHint,
      };
    }

    return {
      conversationId,
      openUrl: /^https?:\/\/mail\.google\.com/i.test(trimmed)
        ? trimmed
        : buildGmailSearchOpenUrl(normalizeGmailSearchQuery(searchQueryFromUrl)),
      searchQuery: normalizeGmailSearchQuery(searchQueryFromUrl),
      folderHint,
    };
  }

  if (isEmailAddress(trimmed)) {
    const searchQuery = normalizeGmailSearchQuery(trimmed);
    return {
      conversationId: null,
      openUrl: buildGmailSearchOpenUrl(searchQuery),
      searchQuery,
      folderHint,
    };
  }

  if (looksLikeGmailSearchQuery(trimmed)) {
    const searchQuery = normalizeGmailSearchQuery(trimmed);
    return {
      conversationId: null,
      openUrl: buildGmailSearchOpenUrl(searchQuery),
      searchQuery,
      folderHint,
    };
  }

  const conversationId = parseGmailConversationId(trimmed);
  if (!conversationId) return null;

  const openUrl = /^https?:\/\/mail\.google\.com/i.test(trimmed)
    ? trimmed
    : buildGmailConversationUrl(conversationId);

  return {
    conversationId,
    openUrl,
    searchQuery: searchQueryFromUrl ? normalizeGmailSearchQuery(searchQueryFromUrl) : null,
    folderHint,
  };
}

function looksLikeSearchQueryOnly(segment: string): boolean {
  const decoded = tryDecodeURIComponent(segment);
  if (decoded.includes("@")) return true;
  if (/%40/i.test(segment)) return true;
  if (/^(from|to|subject|label):/i.test(decoded)) return true;
  return false;
}

function tryDecodeURIComponent(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function buildThreadLinkNoticeBody(linkedAt: Date): string {
  const dateLabel = formatLinkDateLabel(linkedAt);
  return (
    `Gmail thread linked on ${dateLabel}. ` +
    "Messages sent before this date are not shown here — view the full history in Gmail."
  );
}

export function buildThreadLinkUpdatedBody(linkedAt: Date): string {
  const dateLabel = formatLinkDateLabel(linkedAt);
  return (
    `Gmail thread link updated on ${dateLabel}. ` +
    "Earlier messages in this CRM thread are unchanged — view the full history in Gmail."
  );
}

function formatLinkDateLabel(linkedAt: Date): string {
  return linkedAt.toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}
