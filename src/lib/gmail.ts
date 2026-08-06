/**
 * Gmail send/import/link helpers for ticket conversations.
 *
 * Layer: domain / external I/O
 *
 * Uses the signed-in user's OAuth client. Thread messages are cached in SQLite
 * (overlay-db); Gmail remains the mailbox source of truth. Linking a thread to a
 * ticket is CRM-local — redaction clears CRM cache only, not Gmail itself.
 *
 * Related: background-gmail-sync (poll on ticket list refresh), ticket-gmail-threads
 * (multi-thread link table), gmail-thread-link / gmail-urls for ID formats.
 */
import { google } from "googleapis";
import type { gmail_v1 } from "googleapis";
import { v4 as uuidv4 } from "uuid";
import type { ThreadMessage } from "./types";
import type { GmailThreadCandidatePreview, GmailThreadLinkResolveResult } from "./types";
import {
  looksLikeHtml,
  plainTextToHtml,
  repairDoubleEncodedNbsp,
  sanitizeEmailHtml,
  stripHtmlToText,
} from "./html-utils";
import { encodeMimeHeaderValue } from "./mime-headers";
import { getGoogleAuthClient, getSignedInUser } from "./google-auth";
import { joinRecipientList, parseHeaderRecipientList } from "./email-recipients";
import { stripQuotedReplyHtml, stripQuotedReplyPlainText } from "./email-reply-body";
import { withOpsMetric } from "./ops-metrics";
import {
  addThreadMessage,
  claimGmailThreadForTicket,
  clearForceNewGmailThreadOnSend,
  dedupeThreadMessagesForTicket,
  getGmailThreadImportCutoff,
  getGmailThreadImportCutoffForThread,
  getGmailThreadOpenUrl,
  getLinkedGmailThreadIdsForTicket,
  getTicketRowIdForGmailThread,
  getThreadMessages,
  isGmailMessageRedactionBlocked,
  pruneMismatchedThreadMessages,
  refreshResponseSlaDueAt,
  reopenPendingOnCustomerReply,
  resolveTicketGmailThreadId,
  ticketForceNewGmailThreadOnSend,
  ticketHasExplicitGmailLink,
  upsertThreadMessageFromGmail,
  type MessageAttachmentInput,
} from "./overlay-db";
import {
  encodeBase64MimeLines,
  extractAttachmentsFromPayload,
  sanitizeAttachmentFilename,
  type OutboundEmailAttachment,
} from "./gmail-attachments";
import {
  buildLegacySearchQueries,
  decodeGmailWebConversationIdCandidates,
} from "./gmail-legacy-id";
import {
  normalizeGmailSearchQuery,
  parseGmailConversationId,
  parseGmailFolderFromInput,
  parseGmailSearchQueryFromInput,
  type GmailFolderHint,
} from "./gmail-thread-link";
import { isGmailApiThreadId, isGmailLegacyWebId } from "./gmail-urls";
import { buildGmailThreadUrl } from "./gmail-urls";

async function getGmailClient() {
  const auth = await getGoogleAuthClient();
  if (!auth) return null;

  return google.gmail({ version: "v1", auth });
}

export interface ResolveGmailThreadOptions {
  searchHint?: string | null;
  requesterEmail?: string | null;
  folderHint?: GmailFolderHint | null;
}

async function collectMessagesFromSearchPaginated(
  gmail: gmail_v1.Gmail,
  query: string,
  maxMessages = 200
): Promise<Array<{ id: string; threadId: string; internalDate: number }>> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const results: Array<{ id: string; threadId: string; internalDate: number }> = [];
  let pageToken: string | undefined;

  while (results.length < maxMessages) {
    const res = await gmail.users.messages.list({
      userId: "me",
      q: trimmed,
      maxResults: Math.min(100, maxMessages - results.length),
      pageToken,
      includeSpamTrash: true,
    });

    for (const ref of res.data.messages ?? []) {
      if (ref.id && ref.threadId) {
        results.push({
          id: ref.id,
          threadId: ref.threadId,
          internalDate: ref.internalDate ? Number.parseInt(ref.internalDate, 10) : 0,
        });
      }
    }

    pageToken = res.data.nextPageToken ?? undefined;
    if (!pageToken) break;
  }

  return results;
}

async function collectThreadIdsFromSearch(
  gmail: gmail_v1.Gmail,
  query: string,
  maxMessages = 50
): Promise<Set<string>> {
  const messages = await collectMessagesFromSearchPaginated(gmail, query, maxMessages);
  return new Set(messages.map((message) => message.threadId));
}

async function tryResolveApiThreadId(
  gmail: gmail_v1.Gmail,
  candidateId: string
): Promise<string | null> {
  const id = candidateId.trim();
  if (!id) return null;

  if (isGmailApiThreadId(id)) {
    try {
      const thread = await gmail.users.threads.get({
        userId: "me",
        id,
        format: "minimal",
      });
      if (thread.data.id) return thread.data.id;
    } catch {
      /* not a valid API thread id */
    }
  }

  try {
    const message = await gmail.users.messages.get({
      userId: "me",
      id,
      format: "minimal",
    });
    if (message.data.threadId) return message.data.threadId;
  } catch {
    /* not a valid API message id */
  }

  try {
    const thread = await gmail.users.threads.get({
      userId: "me",
      id,
      format: "minimal",
    });
    if (thread.data.id) return thread.data.id;
  } catch {
    /* not a valid thread id */
  }

  return null;
}

async function rankCandidateThreads(
  gmail: gmail_v1.Gmail,
  threadIds: string[],
  options?: {
    requesterEmail?: string | null;
    folderHint?: GmailFolderHint | null;
    preferSentThread?: boolean;
  }
): Promise<string | null> {
  if (threadIds.length === 0) return null;
  if (threadIds.length === 1) return threadIds[0];

  type Scored = { threadId: string; score: number };
  const scored: Scored[] = [];

  for (const threadId of threadIds) {
    let score = 0;
    try {
      const thread = await gmail.users.threads.get({
        userId: "me",
        id: threadId,
        format: "metadata",
        metadataHeaders: ["From", "To"],
      });
      const messages = thread.data.messages ?? [];
      const hasSent = messages.some((message) => message.labelIds?.includes("SENT"));
      const hasInbox = messages.some((message) => message.labelIds?.includes("INBOX"));

      if (options?.folderHint === "sent" && hasSent) score += 200;
      if (options?.folderHint === "inbox" && hasInbox) score += 200;
      if (!options?.folderHint && hasSent && !hasInbox) score += 120;
      if (!options?.folderHint && hasSent) score += 60;
      if (options?.preferSentThread && hasSent) score += 80;
      if (hasInbox && !hasSent) score += 10;
      score += Math.max(0, 20 - messages.length);

      const requester = options?.requesterEmail?.trim().toLowerCase();
      if (requester) {
        for (const message of messages) {
          const headers = message.payload?.headers ?? [];
          const from =
            headers.find((header) => header.name?.toLowerCase() === "from")?.value ?? "";
          const to =
            headers.find((header) => header.name?.toLowerCase() === "to")?.value ?? "";
          const haystack = `${from} ${to}`.toLowerCase();
          if (haystack.includes(requester)) score += 40;
        }
      }
    } catch {
      score -= 100;
    }

    scored.push({ threadId, score });
  }

  scored.sort((a, b) => b.score - a.score);
  const best = scored[0];
  const second = scored[1];
  if (!best) return null;
  if (!second || best.score - second.score >= 40) return best.threadId;
  return null;
}

async function pickThreadByFolderHint(
  gmail: gmail_v1.Gmail,
  threadIds: string[],
  folderHint?: GmailFolderHint | null
): Promise<string | null> {
  if (threadIds.length === 1) return threadIds[0];
  if (!folderHint) return null;

  const label = folderHint === "sent" ? "SENT" : "INBOX";
  const matches: string[] = [];

  for (const threadId of threadIds) {
    try {
      const thread = await gmail.users.threads.get({
        userId: "me",
        id: threadId,
        format: "metadata",
      });
      const hasLabel = thread.data.messages?.some((message) =>
        message.labelIds?.includes(label)
      );
      if (hasLabel) matches.push(threadId);
    } catch {
      /* skip invalid thread */
    }
  }

  if (matches.length === 1) return matches[0];
  return null;
}

/** Resolve a legacy Gmail web conversation id (FMfcgz…) to an API thread id. */
async function resolveExplicitLegacyConversation(
  gmail: gmail_v1.Gmail,
  legacyWebId: string,
  options?: {
    searchHint?: string | null;
    folderHint?: GmailFolderHint | null;
    requesterEmail?: string | null;
    preferSentThread?: boolean;
  }
): Promise<string | null> {
  const id = legacyWebId.trim();
  if (!id) return null;

  const direct = await tryResolveApiThreadId(gmail, id);
  if (direct) return direct;

  const searchHint = options?.searchHint?.trim();
  let searchThreadIds = new Set<string>();
  if (searchHint) {
    searchThreadIds = await collectThreadIdsFromSearch(gmail, searchHint);
  }

  for (const candidate of decodeGmailWebConversationIdCandidates(id)) {
    const resolved = await tryResolveApiThreadId(gmail, candidate);
    if (!resolved) continue;
    if (!searchHint || searchThreadIds.has(resolved)) return resolved;
  }

  const legacyThreadIds = new Set<string>();
  for (const query of buildLegacySearchQueries(id, options?.searchHint)) {
    const threads = await collectThreadIdsFromSearch(gmail, query);
    for (const threadId of threads) legacyThreadIds.add(threadId);
  }

  if (searchHint) {
    for (const folderQuery of [`${searchHint} in:sent`, `${searchHint} in:inbox`]) {
      const folderThreads = await collectThreadIdsFromSearch(gmail, folderQuery);
      if (folderThreads.size === 1) {
        const only = [...folderThreads][0];
        if (searchThreadIds.has(only)) return only;
      }
    }

    const intersection = [...legacyThreadIds].filter((threadId) => searchThreadIds.has(threadId));
    if (intersection.length === 1) return intersection[0];
    if (intersection.length > 1) {
      const picked = await pickThreadByFolderHint(gmail, intersection, options?.folderHint);
      if (picked) return picked;
      const ranked = await rankCandidateThreads(gmail, intersection, options);
      if (ranked) return ranked;
    }

    if (legacyThreadIds.size === 1) {
      const only = [...legacyThreadIds][0];
      if (searchThreadIds.has(only)) return only;
    }
  }

  if (legacyThreadIds.size === 1) return [...legacyThreadIds][0];
  if (legacyThreadIds.size > 1) {
    const picked = await pickThreadByFolderHint(gmail, [...legacyThreadIds], options?.folderHint);
    if (picked) return picked;
  }

  if (searchHint && searchThreadIds.size > 0) {
    const ranked = await rankCandidateThreads(gmail, [...searchThreadIds], {
      ...options,
      preferSentThread: true,
    });
    if (ranked) return ranked;
  }

  return null;
}

/** Resolve a pasted link id to the Gmail API thread id when possible. */
export async function resolveGmailApiThreadId(
  linkId: string,
  options?: ResolveGmailThreadOptions
): Promise<string | null> {
  const gmail = await getGmailClient();
  const id = linkId.trim();
  if (!gmail || !id) return null;

  if (isGmailApiThreadId(id)) {
    try {
      const thread = await gmail.users.threads.get({
        userId: "me",
        id,
        format: "minimal",
      });
      if (thread.data.id) return thread.data.id;
    } catch {
      /* invalid stored id */
    }
  }

  const direct = await tryResolveApiThreadId(gmail, id);
  if (direct) return direct;

  if (isGmailLegacyWebId(id)) {
    const fromLegacy = await resolveExplicitLegacyConversation(gmail, id, {
      searchHint: options?.searchHint,
      folderHint: options?.folderHint,
      requesterEmail: options?.requesterEmail,
    });
    if (fromLegacy) return fromLegacy;
    return null;
  }

  if (options?.searchHint) {
    const fromSearch = await resolveThreadIdByGmailSearch(
      gmail,
      options.searchHint,
      options.requesterEmail
    );
    if (fromSearch) return fromSearch;
  }

  return null;
}

/** Resolve a Gmail API thread id from a thread id, legacy id, or search query. */
export async function resolveGmailThreadLinkTarget(
  parsed: {
    conversationId: string | null;
    searchQuery: string | null;
    folderHint?: GmailFolderHint | null;
  },
  requesterEmail?: string | null
): Promise<string | null> {
  if (parsed.conversationId) {
    const resolved = await resolveGmailApiThreadId(parsed.conversationId, {
      searchHint: parsed.searchQuery,
      requesterEmail,
      folderHint: parsed.folderHint,
    });
    if (resolved) return resolved;

    if (isGmailLegacyWebId(parsed.conversationId)) {
      return null;
    }
  }

  if (parsed.searchQuery) {
    const gmail = await getGmailClient();
    if (!gmail) return null;
    return resolveThreadIdByGmailSearch(gmail, parsed.searchQuery, requesterEmail);
  }

  return null;
}

function buildGmailSearchQueries(hint: string, requesterEmail?: string | null): string[] {
  const normalizedHint = normalizeGmailSearchQuery(hint);
  const queries = [normalizedHint];
  const email = requesterEmail?.trim();

  if (email && !normalizedHint.toLowerCase().includes(email.toLowerCase())) {
    queries.unshift(`from:${email}`);
    queries.push(`from:${email} ${normalizedHint}`);
  }

  return [...new Set(queries.filter(Boolean))];
}

async function resolveThreadIdByGmailSearch(
  gmail: gmail_v1.Gmail,
  searchHint: string,
  requesterEmail?: string | null
): Promise<string | null> {
  const hint = normalizeGmailSearchQuery(searchHint);
  if (!hint) return null;

  const threadScores = new Map<string, { count: number; latest: number }>();

  for (const q of buildGmailSearchQueries(hint, requesterEmail)) {
    const messages = await collectMessagesFromSearchPaginated(gmail, q);
    for (const ref of messages) {
      const existing = threadScores.get(ref.threadId);
      if (existing) {
        existing.count += 1;
        existing.latest = Math.max(existing.latest, ref.internalDate);
      } else {
        threadScores.set(ref.threadId, { count: 1, latest: ref.internalDate });
      }
    }

    if (threadScores.size === 1) {
      return [...threadScores.keys()][0];
    }
  }

  if (threadScores.size === 0) return null;
  if (threadScores.size === 1) return [...threadScores.keys()][0];

  const ranked = await rankCandidateThreads(gmail, [...threadScores.keys()], {
    requesterEmail,
  });
  if (ranked) return ranked;

  const best = [...threadScores.entries()].sort((a, b) => {
    if (b[1].count !== a[1].count) return b[1].count - a[1].count;
    return b[1].latest - a[1].latest;
  })[0];

  return best?.[0] ?? null;
}

const MAX_LINK_CANDIDATES = 10;

async function scoreThreadCandidates(
  gmail: gmail_v1.Gmail,
  threadIds: string[],
  options?: {
    requesterEmail?: string | null;
    folderHint?: GmailFolderHint | null;
    preferSentThread?: boolean;
  }
): Promise<Array<{ threadId: string; score: number }>> {
  type Scored = { threadId: string; score: number };
  const scored: Scored[] = [];

  for (const threadId of threadIds) {
    let score = 0;
    try {
      const thread = await gmail.users.threads.get({
        userId: "me",
        id: threadId,
        format: "metadata",
        metadataHeaders: ["From", "To"],
      });
      const messages = thread.data.messages ?? [];
      const hasSent = messages.some((message) => message.labelIds?.includes("SENT"));
      const hasInbox = messages.some((message) => message.labelIds?.includes("INBOX"));

      if (options?.folderHint === "sent" && hasSent) score += 200;
      if (options?.folderHint === "inbox" && hasInbox) score += 200;
      if (!options?.folderHint && hasSent && !hasInbox) score += 120;
      if (!options?.folderHint && hasSent) score += 60;
      if (options?.preferSentThread && hasSent) score += 80;
      if (hasInbox && !hasSent) score += 10;
      score += Math.max(0, 20 - messages.length);

      const requester = options?.requesterEmail?.trim().toLowerCase();
      if (requester) {
        for (const message of messages) {
          const headers = message.payload?.headers ?? [];
          const from =
            headers.find((header) => header.name?.toLowerCase() === "from")?.value ?? "";
          const to =
            headers.find((header) => header.name?.toLowerCase() === "to")?.value ?? "";
          const haystack = `${from} ${to}`.toLowerCase();
          if (haystack.includes(requester)) score += 40;
        }
      }
    } catch {
      score -= 100;
    }

    scored.push({ threadId, score });
  }

  return scored.sort((a, b) => b.score - a.score);
}

async function sortThreadIdsByRelevance(
  gmail: gmail_v1.Gmail,
  threadIds: string[],
  options?: {
    requesterEmail?: string | null;
    folderHint?: GmailFolderHint | null;
    preferSentThread?: boolean;
  }
): Promise<string[]> {
  const scored = await scoreThreadCandidates(gmail, threadIds, options);
  return scored.map((entry) => entry.threadId);
}

function capCandidateThreadIds(threadIds: string[]): string[] {
  return [...new Set(threadIds)].slice(0, MAX_LINK_CANDIDATES);
}

async function resolveLegacyConversationForLink(
  gmail: gmail_v1.Gmail,
  legacyWebId: string,
  options?: {
    searchHint?: string | null;
    folderHint?: GmailFolderHint | null;
    requesterEmail?: string | null;
  }
): Promise<GmailThreadLinkResolveResult> {
  const id = legacyWebId.trim();
  if (!id) return { status: "not_found" };

  if (options?.folderHint) {
    const folderQuery =
      options.folderHint === "sent" ? `in:sent "${id}"` : `in:inbox "${id}"`;
    const folderThreads = await collectThreadIdsFromSearch(gmail, folderQuery, 25);
    if (folderThreads.size === 1) {
      return { status: "resolved", apiThreadId: [...folderThreads][0] };
    }
    if (folderThreads.size > 1) {
      const picked = await pickThreadByFolderHint(gmail, [...folderThreads], options.folderHint);
      if (picked) return { status: "resolved", apiThreadId: picked };
      const sorted = await sortThreadIdsByRelevance(gmail, [...folderThreads], {
        folderHint: options.folderHint,
        requesterEmail: options.requesterEmail,
      });
      return { status: "ambiguous", threadIds: capCandidateThreadIds(sorted) };
    }
  }

  const direct = await tryResolveApiThreadId(gmail, id);
  if (direct) return { status: "resolved", apiThreadId: direct };

  const searchHint = options?.searchHint?.trim();
  let searchThreadIds = new Set<string>();
  if (searchHint) {
    searchThreadIds = await collectThreadIdsFromSearch(gmail, searchHint);
  }

  for (const candidate of decodeGmailWebConversationIdCandidates(id).slice(0, 8)) {
    const resolved = await tryResolveApiThreadId(gmail, candidate);
    if (!resolved) continue;
    if (!searchHint || searchThreadIds.has(resolved)) {
      return { status: "resolved", apiThreadId: resolved };
    }
  }

  const legacyThreadIds = new Set<string>();
  for (const query of buildLegacySearchQueries(id, options?.searchHint)) {
    const threads = await collectThreadIdsFromSearch(gmail, query);
    for (const threadId of threads) legacyThreadIds.add(threadId);
  }

  if (searchHint) {
    for (const folderQuery of [`${searchHint} in:sent`, `${searchHint} in:inbox`]) {
      const folderThreads = await collectThreadIdsFromSearch(gmail, folderQuery);
      if (folderThreads.size === 1) {
        const only = [...folderThreads][0];
        if (searchThreadIds.has(only)) {
          return { status: "resolved", apiThreadId: only };
        }
      }
    }

    const intersection = [...legacyThreadIds].filter((threadId) => searchThreadIds.has(threadId));
    if (intersection.length === 1) {
      return { status: "resolved", apiThreadId: intersection[0] };
    }
    if (intersection.length > 1) {
      const sorted = await sortThreadIdsByRelevance(gmail, intersection, {
        ...options,
        preferSentThread: true,
      });
      return { status: "ambiguous", threadIds: capCandidateThreadIds(sorted) };
    }

    if (legacyThreadIds.size === 1) {
      const only = [...legacyThreadIds][0];
      if (searchThreadIds.has(only)) {
        return { status: "resolved", apiThreadId: only };
      }
    }
  }

  if (legacyThreadIds.size === 1) {
    return { status: "resolved", apiThreadId: [...legacyThreadIds][0] };
  }
  if (legacyThreadIds.size > 1) {
    const picked = await pickThreadByFolderHint(gmail, [...legacyThreadIds], options?.folderHint);
    if (picked) return { status: "resolved", apiThreadId: picked };
    const sorted = await sortThreadIdsByRelevance(gmail, [...legacyThreadIds], options);
    return { status: "ambiguous", threadIds: capCandidateThreadIds(sorted) };
  }

  if (searchHint && searchThreadIds.size === 1) {
    return { status: "resolved", apiThreadId: [...searchThreadIds][0] };
  }
  if (searchHint && searchThreadIds.size > 1) {
    const sorted = await sortThreadIdsByRelevance(gmail, [...searchThreadIds], {
      ...options,
      preferSentThread: true,
    });
    return { status: "ambiguous", threadIds: capCandidateThreadIds(sorted) };
  }

  return { status: "not_found" };
}

async function resolveSearchForLink(
  gmail: gmail_v1.Gmail,
  searchHint: string,
  requesterEmail?: string | null
): Promise<GmailThreadLinkResolveResult> {
  const hint = normalizeGmailSearchQuery(searchHint);
  if (!hint) return { status: "not_found" };

  const threadScores = new Map<string, { count: number; latest: number }>();

  for (const q of buildGmailSearchQueries(hint, requesterEmail)) {
    const messages = await collectMessagesFromSearchPaginated(gmail, q);
    for (const ref of messages) {
      const existing = threadScores.get(ref.threadId);
      if (existing) {
        existing.count += 1;
        existing.latest = Math.max(existing.latest, ref.internalDate);
      } else {
        threadScores.set(ref.threadId, { count: 1, latest: ref.internalDate });
      }
    }

    if (threadScores.size === 1) {
      return { status: "resolved", apiThreadId: [...threadScores.keys()][0] };
    }
  }

  if (threadScores.size === 0) return { status: "not_found" };
  if (threadScores.size === 1) {
    return { status: "resolved", apiThreadId: [...threadScores.keys()][0] };
  }

  const sorted = await sortThreadIdsByRelevance(gmail, [...threadScores.keys()], {
    requesterEmail,
  });
  return { status: "ambiguous", threadIds: capCandidateThreadIds(sorted) };
}

/** Resolve a link target for the UI; returns multiple candidates when ambiguous. */
export async function resolveGmailThreadLinkTargetDetailed(
  parsed: {
    conversationId: string | null;
    searchQuery: string | null;
    folderHint?: GmailFolderHint | null;
  },
  requesterEmail?: string | null
): Promise<GmailThreadLinkResolveResult> {
  const gmail = await getGmailClient();
  if (!gmail) return { status: "not_found" };

  if (parsed.conversationId) {
    if (isGmailApiThreadId(parsed.conversationId)) {
      const resolved = await tryResolveApiThreadId(gmail, parsed.conversationId);
      if (resolved) return { status: "resolved", apiThreadId: resolved };
    }

    const direct = await tryResolveApiThreadId(gmail, parsed.conversationId);
    if (direct) return { status: "resolved", apiThreadId: direct };

    if (isGmailLegacyWebId(parsed.conversationId)) {
      return resolveLegacyConversationForLink(gmail, parsed.conversationId, {
        searchHint: parsed.searchQuery,
        folderHint: parsed.folderHint,
        requesterEmail,
      });
    }
  }

  if (parsed.searchQuery) {
    return resolveSearchForLink(gmail, parsed.searchQuery, requesterEmail);
  }

  return { status: "not_found" };
}

function getHeaderValue(
  headers: gmail_v1.Schema$MessagePartHeader[] | undefined,
  name: string
): string {
  return (
    headers?.find((header) => header.name?.toLowerCase() === name.toLowerCase())?.value ?? ""
  );
}

/** Fetch subject/from/snippet previews for a thread picker. */
export async function fetchGmailThreadCandidatePreviews(
  threadIds: string[]
): Promise<GmailThreadCandidatePreview[]> {
  const gmail = await getGmailClient();
  if (!gmail || threadIds.length === 0) return [];

  const previews: GmailThreadCandidatePreview[] = [];

  for (const threadId of threadIds.slice(0, MAX_LINK_CANDIDATES)) {
    try {
      const thread = await gmail.users.threads.get({
        userId: "me",
        id: threadId,
        format: "metadata",
        metadataHeaders: ["Subject", "From", "To", "Date"],
      });
      const messages = thread.data.messages ?? [];
      if (messages.length === 0) continue;

      const sorted = [...messages].sort(
        (a, b) => Number(b.internalDate ?? 0) - Number(a.internalDate ?? 0)
      );
      const latest = sorted[0];
      const headers = latest.payload?.headers;
      const internalDate = Number(latest.internalDate ?? 0);
      const sentAt = getHeaderValue(headers, "Date")
        || (internalDate > 0 ? new Date(internalDate).toISOString() : new Date().toISOString());

      const folders = new Set<string>();
      for (const message of messages) {
        for (const label of message.labelIds ?? []) {
          if (label === "SENT" || label === "INBOX") folders.add(label);
        }
      }

      previews.push({
        apiThreadId: threadId,
        subject: getHeaderValue(headers, "Subject") || "(no subject)",
        from: getHeaderValue(headers, "From"),
        to: getHeaderValue(headers, "To"),
        sentAt,
        snippet: thread.data.snippet ?? "",
        messageCount: messages.length,
        folders: [...folders],
      });
    } catch {
      /* skip invalid thread */
    }
  }

  return previews.sort(
    (a, b) => new Date(b.sentAt).getTime() - new Date(a.sentAt).getTime()
  );
}

/** Fetch unread inbox threads with CRM link status. */
export async function fetchUnreadGmailThreads(limit = 40): Promise<import("./types").GmailUnreadThreadPreview[]> {
  return withOpsMetric("gmail", "threads.unread", async () => {
  const gmail = await getGmailClient();
  if (!gmail) return [];

  const listed = await gmail.users.threads.list({
    userId: "me",
    q: "in:inbox is:unread",
    maxResults: Math.max(1, Math.min(limit, 100)),
  });

  const refs = listed.data.threads ?? [];
  const previews = await Promise.all(
    refs.map(async (ref) => {
      if (!ref.id) return null;
      try {
        const thread = await gmail.users.threads.get({
          userId: "me",
          id: ref.id,
          format: "metadata",
          metadataHeaders: ["Subject", "From", "Date"],
        });
        const messages = thread.data.messages ?? [];
        if (messages.length === 0) return null;
        const latest = [...messages].sort(
          (a, b) => Number(b.internalDate ?? 0) - Number(a.internalDate ?? 0)
        )[0];
        const headers = latest.payload?.headers ?? [];
        const subject = getHeader(headers, "Subject").trim() || "(no subject)";
        const from = getHeader(headers, "From").trim();
        const fromEmail = extractEmailAddress(from);
        const dateHeader = getHeader(headers, "Date").trim();
        const latestAt =
          dateHeader ||
          (latest.internalDate
            ? new Date(Number(latest.internalDate)).toISOString()
            : new Date().toISOString());
        const unreadCount = messages.filter((message) => message.labelIds?.includes("UNREAD")).length;
        return {
          threadId: ref.id,
          subject,
          from,
          fromEmail,
          snippet: thread.data.snippet ?? "",
          latestAt,
          messageCount: messages.length,
          unreadCount,
          linkedTicketRowId: getTicketRowIdForGmailThread(ref.id),
          openUrl: buildGmailThreadUrl(ref.id),
        };
      } catch {
        return null;
      }
    })
  );

  return previews
    .filter((item): item is import("./types").GmailUnreadThreadPreview => Boolean(item))
    .sort((a, b) => new Date(b.latestAt).getTime() - new Date(a.latestAt).getTime());
  });
}

/** Resolve and persist a Gmail API thread id for a ticket when the stored id is missing or legacy. */
export async function ensureTicketGmailApiThreadId(params: {
  ticketRowId: string;
  requesterEmail?: string | null;
}): Promise<string | null> {
  if (ticketForceNewGmailThreadOnSend(params.ticketRowId)) return null;

  const stored = resolveTicketGmailThreadId(params.ticketRowId);
  const openUrl = getGmailThreadOpenUrl(params.ticketRowId);
  const conversationId =
    (openUrl ? parseGmailConversationId(openUrl) : null) ??
    (stored && !isGmailApiThreadId(stored) ? stored : null);
  const searchHint = openUrl ? parseGmailSearchQueryFromInput(openUrl) : null;
  const folderHint = openUrl ? parseGmailFolderFromInput(openUrl) : null;
  const shouldResolveFromOpenUrl = Boolean(
    openUrl &&
      conversationId &&
      (!stored ||
        !isGmailApiThreadId(stored) ||
        isGmailLegacyWebId(conversationId) ||
        Boolean(searchHint))
  );

  if (stored && isGmailApiThreadId(stored) && !shouldResolveFromOpenUrl) {
    return stored;
  }

  if (!conversationId && !searchHint) {
    return stored && isGmailApiThreadId(stored) ? stored : null;
  }

  const resolved = await resolveGmailApiThreadId(conversationId ?? "", {
    searchHint,
    requesterEmail: params.requesterEmail,
    folderHint,
  });

  if (resolved) {
    claimGmailThreadForTicket(params.ticketRowId, resolved, { replace: true });
    return resolved;
  }

  return stored && isGmailApiThreadId(stored) ? stored : null;
}

/** Subject header from the earliest message in a Gmail thread. */
export async function fetchFirstThreadSubject(threadId: string): Promise<string | null> {
  const gmail = await getGmailClient();
  const id = threadId.trim();
  if (!gmail || !id || !isGmailApiThreadId(id)) return null;

  try {
    const thread = await gmail.users.threads.get({
      userId: "me",
      id,
      format: "metadata",
      metadataHeaders: ["Subject"],
    });

    const messages = thread.data.messages ?? [];
    if (messages.length === 0) return null;

    const first = [...messages].sort(
      (a, b) => Number(a.internalDate ?? 0) - Number(b.internalDate ?? 0)
    )[0];

    const subject = getHeader(first.payload?.headers, "Subject").trim();
    return subject || null;
  } catch {
    return null;
  }
}

async function resolveSenderEmail(): Promise<string> {
  const user = await getSignedInUser();
  if (user.email) return user.email;
  return process.env.GMAIL_SENDER_EMAIL || "support@example.com";
}

const signatureCache = new Map<string, { html: string; fetchedAt: number }>();
const SIGNATURE_CACHE_MS = 5 * 60 * 1000;

/** Fetch the Gmail signature for the signed-in user's send-as address. */
export async function fetchGmailSignature(
  gmail: gmail_v1.Gmail,
  sendAsEmail: string
): Promise<string> {
  const cached = signatureCache.get(sendAsEmail);
  if (cached && Date.now() - cached.fetchedAt < SIGNATURE_CACHE_MS) {
    return cached.html;
  }

  try {
    const res = await gmail.users.settings.sendAs.get({
      userId: "me",
      sendAsEmail,
    });
    const html = res.data.signature?.trim() ?? "";
    signatureCache.set(sendAsEmail, { html, fetchedAt: Date.now() });
    return html;
  } catch {
    try {
      const list = await gmail.users.settings.sendAs.list({ userId: "me" });
      const primary =
        list.data.sendAs?.find((alias) => alias.isPrimary) ?? list.data.sendAs?.[0];
      const html = primary?.signature?.trim() ?? "";
      if (primary?.sendAsEmail) {
        signatureCache.set(primary.sendAsEmail, { html, fetchedAt: Date.now() });
      }
      return html;
    } catch {
      return "";
    }
  }
}

function appendSignatureToBody(
  userBody: string,
  signatureHtml: string
): { plain: string; html?: string } {
  const trimmed = userBody.trim();
  const isHtml = looksLikeHtml(trimmed);

  if (isHtml) {
    // Keep real `&nbsp;` entities; collapse any prior double-encoding before send.
    const htmlUserBody = repairDoubleEncodedNbsp(trimmed);
    const plain = stripHtmlToText(htmlUserBody);
    if (!signatureHtml) return { plain, html: htmlUserBody };

    const signaturePlain = stripHtmlToText(signatureHtml);
    const plainWithSig = signaturePlain ? `${plain}\n\n--\n${signaturePlain}` : plain;
    const htmlBody = [htmlUserBody, "<br><br>", signatureHtml].join("");
    return { plain: plainWithSig, html: htmlBody };
  }

  if (!signatureHtml) return { plain: trimmed };

  const signaturePlain = stripHtmlToText(signatureHtml);
  const plain = signaturePlain
    ? `${trimmed}\n\n--\n${signaturePlain}`
    : trimmed;

  const hasHtmlSignature = looksLikeHtml(signatureHtml);
  if (!hasHtmlSignature) return { plain };

  // Decode entities before escaping so contentEditable `&nbsp;` does not become
  // visible `&amp;nbsp;` in the outbound HTML part.
  const htmlBody = [`<div>${plainTextToHtml(trimmed)}</div>`, "<br>", signatureHtml].join("");

  return { plain, html: htmlBody };
}

function buildBodyMimePart(plain: string, htmlBody?: string): string {
  if (htmlBody) {
    const boundary = `alt_${Date.now().toString(36)}`;
    return [
      `Content-Type: multipart/alternative; boundary="${boundary}"`,
      "",
      `--${boundary}`,
      "Content-Type: text/plain; charset=utf-8",
      "Content-Transfer-Encoding: 7bit",
      "",
      plain,
      `--${boundary}`,
      "Content-Type: text/html; charset=utf-8",
      "Content-Transfer-Encoding: 7bit",
      "",
      htmlBody,
      `--${boundary}--`,
    ].join("\r\n");
  }

  return ["Content-Type: text/plain; charset=utf-8", "Content-Transfer-Encoding: 7bit", "", plain].join(
    "\r\n"
  );
}

function buildAttachmentMimePart(att: OutboundEmailAttachment): string {
  const filename = sanitizeAttachmentFilename(att.filename);
  const mimeType = att.mimeType?.trim() || "application/octet-stream";
  return [
    `Content-Type: ${mimeType}; name="${filename}"`,
    `Content-Disposition: attachment; filename="${filename}"`,
    "Content-Transfer-Encoding: base64",
    "",
    encodeBase64MimeLines(att.data),
  ].join("\r\n");
}

function encodeMessage(
  from: string,
  to: string,
  subject: string,
  body: string,
  cc?: string | null,
  htmlBody?: string,
  attachments: OutboundEmailAttachment[] = [],
  bcc?: string | null
): string {
  const headers = [`From: ${from}`, `To: ${to}`];
  if (cc?.trim()) headers.push(`Cc: ${cc.trim()}`);
  if (bcc?.trim()) headers.push(`Bcc: ${bcc.trim()}`);
  headers.push(`Subject: ${encodeMimeHeaderValue(subject)}`, "MIME-Version: 1.0");

  const bodyPart = buildBodyMimePart(body, htmlBody);
  let mimeBody: string;

  if (attachments.length > 0) {
    const mixedBoundary = `mixed_${Date.now().toString(36)}`;
    headers.push(`Content-Type: multipart/mixed; boundary="${mixedBoundary}"`);
    const parts = [
      ...headers,
      "",
      `--${mixedBoundary}`,
      bodyPart,
      ...attachments.flatMap((att) => [`--${mixedBoundary}`, buildAttachmentMimePart(att)]),
      `--${mixedBoundary}--`,
    ];
    mimeBody = parts.join("\r\n");
  } else if (htmlBody) {
    const boundary = `sheetscrm_${Date.now().toString(36)}`;
    headers.push(`Content-Type: multipart/alternative; boundary="${boundary}"`);
    mimeBody = [
      ...headers,
      "",
      `--${boundary}`,
      "Content-Type: text/plain; charset=utf-8",
      "Content-Transfer-Encoding: 7bit",
      "",
      body,
      `--${boundary}`,
      "Content-Type: text/html; charset=utf-8",
      "Content-Transfer-Encoding: 7bit",
      "",
      htmlBody,
      `--${boundary}--`,
    ].join("\r\n");
  } else {
    headers.push("Content-Type: text/plain; charset=utf-8", "", body);
    mimeBody = headers.join("\r\n");
  }

  return Buffer.from(mimeBody)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function getHeader(
  headers: gmail_v1.Schema$MessagePartHeader[] | undefined,
  name: string
): string {
  return headers?.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value ?? "";
}

function extractEmailAddress(headerValue: string): string {
  const match = headerValue.match(/<([^>]+)>/);
  return (match?.[1] ?? headerValue).trim().toLowerCase();
}

function decodeBodyData(data: string | null | undefined): string {
  if (!data) return "";
  return Buffer.from(data, "base64url").toString("utf-8");
}

function isAttachmentPart(part: gmail_v1.Schema$MessagePart): boolean {
  const disposition = part.headers
    ?.find((h) => h.name?.toLowerCase() === "content-disposition")
    ?.value?.toLowerCase();
  return Boolean(disposition?.includes("attachment") || part.filename);
}

/** Collect text/plain and text/html from a MIME tree (skip file attachments). */
function extractBodyParts(
  payload: gmail_v1.Schema$MessagePart | undefined
): { plain: string; html: string } {
  const result = { plain: "", html: "" };
  if (!payload) return result;

  function walk(part: gmail_v1.Schema$MessagePart): void {
    if (isAttachmentPart(part)) return;

    const mime = part.mimeType ?? "";
    if (mime === "text/plain" && part.body?.data && !result.plain) {
      result.plain = decodeBodyData(part.body.data);
    } else if (mime === "text/html" && part.body?.data && !result.html) {
      result.html = decodeBodyData(part.body.data);
    }

    for (const child of part.parts ?? []) {
      walk(child);
    }
  }

  walk(payload);
  return result;
}

/** Prefer sanitized HTML for CRM display; fall back to plain text. */
function resolveMessageBodyForCrm(parts: { plain: string; html: string }): string {
  const html = parts.html.trim();
  if (html) {
    const sanitized = sanitizeEmailHtml(html);
    if (sanitized) return sanitized;
  }
  return parts.plain.trim();
}

interface ParsedGmailMessage {
  message: ThreadMessage;
  attachments: MessageAttachmentInput[];
}

/** Classify Gmail thread messages for CRM display (inbound = white, outbound = blue). */
function classifyGmailMessageDirection(
  msg: gmail_v1.Schema$Message,
  agentEmail: string
): "inbound" | "outbound" {
  if (msg.labelIds?.includes("SENT")) {
    return "outbound";
  }

  const fromEmail = extractEmailAddress(getHeader(msg.payload?.headers, "From"));
  const agent = extractEmailAddress(agentEmail);
  if (fromEmail && agent && fromEmail === agent) {
    return "outbound";
  }

  return "inbound";
}

function parseGmailMessage(
  msg: gmail_v1.Schema$Message,
  ticketRowId: string,
  requesterEmail: string,
  agentEmail: string
): ParsedGmailMessage | null {
  if (!msg.id) return null;

  const headers = msg.payload?.headers;
  const from = getHeader(headers, "From");
  const to = getHeader(headers, "To");
  const ccHeader = getHeader(headers, "Cc");
  const ccParts = parseHeaderRecipientList(ccHeader);
  const cc = ccParts.length ? joinRecipientList(ccParts) : null;
  const subject = getHeader(headers, "Subject");
  const dateHeader = getHeader(headers, "Date");
  const bodyParts = extractBodyParts(msg.payload);
  let body = resolveMessageBodyForCrm(bodyParts);
  const attachments = extractAttachmentsFromPayload(msg.payload).map((att) => ({
    gmailAttachmentId: att.gmailAttachmentId,
    filename: att.filename,
    mimeType: att.mimeType,
    sizeBytes: att.sizeBytes,
  }));

  const direction = classifyGmailMessageDirection(msg, agentEmail);
  const isOutbound = direction === "outbound";

  if (!isOutbound && body) {
    body = looksLikeHtml(body)
      ? stripQuotedReplyHtml(body)
      : stripQuotedReplyPlainText(body);
  }

  const fallbackBody =
    attachments.length > 0 ? "(attachment only)" : "(empty message)";

  return {
    message: {
      id: uuidv4(),
      ticketRowId,
      direction,
      from: from || (isOutbound ? agentEmail : requesterEmail),
      to: to || (isOutbound ? requesterEmail : agentEmail),
      cc,
      subject: subject || "(no subject)",
      body: body || fallbackBody,
      gmailMessageId: msg.id,
      gmailThreadId: msg.threadId ?? null,
      sentAt: dateHeader ? new Date(dateHeader).toISOString() : new Date().toISOString(),
    },
    attachments,
  };
}

/** Fetch attachment bytes from Gmail on demand (not cached locally). */
export async function fetchGmailAttachment(params: {
  gmailMessageId: string;
  gmailAttachmentId: string;
}): Promise<{ data: Buffer; size: number }> {
  const gmail = await getGmailClient();
  if (!gmail) {
    throw new Error("Gmail is not connected");
  }

  const res = await gmail.users.messages.attachments.get({
    userId: "me",
    messageId: params.gmailMessageId,
    id: params.gmailAttachmentId,
  });

  const encoded = res.data.data;
  if (!encoded) {
    throw new Error("Attachment not found in Gmail");
  }

  return {
    data: Buffer.from(encoded, "base64url"),
    size: res.data.size ?? 0,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function headerValue(
  headers: gmail_v1.Schema$MessagePartHeader[] | undefined,
  name: string
): string {
  const match = headers?.find((header) => header.name?.toLowerCase() === name.toLowerCase());
  return match?.value?.trim() ?? "";
}

export interface ImportedGmailDraftAttachment {
  filename: string;
  mimeType: string;
  data: Buffer;
}

function escapeGmailQueryValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function recipientsIncludeEmail(
  headers: gmail_v1.Schema$MessagePartHeader[] | undefined,
  email: string
): boolean {
  const needle = email.trim().toLowerCase();
  if (!needle) return true;
  const to = headerValue(headers, "To").toLowerCase();
  const cc = headerValue(headers, "Cc").toLowerCase();
  const bcc = headerValue(headers, "Bcc").toLowerCase();
  return to.includes(needle) || cc.includes(needle) || bcc.includes(needle);
}

function messageBodyText(payload: gmail_v1.Schema$MessagePart | undefined): string {
  if (!payload) return "";
  const chunks: string[] = [];
  if (payload.body?.data) {
    chunks.push(Buffer.from(payload.body.data, "base64url").toString("utf8"));
  }
  for (const part of payload.parts ?? []) {
    chunks.push(messageBodyText(part));
  }
  return chunks.join("\n");
}

function filenamesMatch(expected: string, actual: string): boolean {
  return sanitizeAttachmentFilename(expected).toLowerCase() === sanitizeAttachmentFilename(actual).toLowerCase();
}

/** Reuse a file already present in the user's Gmail (sent mail, drafts, etc.). */
export async function findGmailAttachmentBytesByFilename(
  filename: string
): Promise<ImportedGmailDraftAttachment | null> {
  const gmail = await getGmailClient();
  if (!gmail) return null;

  const sanitized = sanitizeAttachmentFilename(filename);
  const basename = sanitized.split(/[/\\]/).pop() ?? sanitized;
  const queries = [
    `filename:"${escapeGmailQueryValue(sanitized)}" has:attachment`,
    `filename:"${escapeGmailQueryValue(basename)}" has:attachment`,
    `has:attachment "${escapeGmailQueryValue(basename)}"`,
  ];

  let best: ImportedGmailDraftAttachment | null = null;
  let bestDate = 0;

  for (const query of queries) {
    const list = await gmail.users.messages.list({
      userId: "me",
      q: query,
      maxResults: 10,
    });

    for (const ref of list.data.messages ?? []) {
      if (!ref.id) continue;
      const full = await gmail.users.messages.get({
        userId: "me",
        id: ref.id,
        format: "full",
      });
      const internalDate = Number(full.data.internalDate ?? 0);
      if (internalDate < bestDate) continue;

      const messageId = full.data.id;
      const payload = full.data.payload;
      if (!messageId || !payload) continue;

      const parts = extractAttachmentsFromPayload(payload);
      const match = parts.find((part) => filenamesMatch(sanitized, part.filename));
      if (!match) continue;

      const { data } = await fetchGmailAttachment({
        gmailMessageId: messageId,
        gmailAttachmentId: match.gmailAttachmentId,
      });
      best = {
        filename: sanitizeAttachmentFilename(match.filename),
        mimeType: match.mimeType || "application/octet-stream",
        data,
      };
      bestDate = internalDate;
    }

    if (best) break;
  }

  return best;
}

async function findMatchingMixmaxDraftId(
  gmail: gmail_v1.Gmail,
  params: {
    subjectMarker: string;
    bodyMarker: string;
    toEmail?: string;
    startedAt: number;
    expectedFilenames: string[];
  }
): Promise<string | null> {
  const expected = params.expectedFilenames.map((name) => sanitizeAttachmentFilename(name));
  const toEmail = params.toEmail?.trim().toLowerCase();

  const list = await gmail.users.drafts.list({ userId: "me", maxResults: 30 });
  for (const draft of list.data.drafts ?? []) {
    if (!draft.id) continue;
    const full = await gmail.users.drafts.get({
      userId: "me",
      id: draft.id,
      format: "full",
    });
    const message = full.data.message;
    const messageId = message?.id;
    const payload = message?.payload;
    if (!messageId || !payload) continue;

    const internalDate = Number(message.internalDate ?? 0);
    if (internalDate > 0 && internalDate < params.startedAt - 15_000) continue;

    const subject = headerValue(payload.headers, "Subject");
    const body = messageBodyText(payload);
    const markerHit =
      subject.includes(params.subjectMarker) || body.includes(params.bodyMarker);
    if (!markerHit) continue;
    if (toEmail && !recipientsIncludeEmail(payload.headers, toEmail)) continue;

    const parts = extractAttachmentsFromPayload(payload);
    const matchedNames = expected.filter((name) =>
      parts.some((part) => filenamesMatch(name, part.filename))
    );
    if (matchedNames.length === 0) continue;

    return draft.id;
  }

  return null;
}

/**
 * Poll Gmail drafts for a transient Mixmax-synced draft, read attachment bytes, then delete it.
 * Mixmax cloud files are not downloadable via the REST API; Gmail draft sync is the supported bridge.
 */
export async function importAttachmentsFromTransientGmailDraft(params: {
  subjectMarker: string;
  bodyMarker: string;
  toEmail?: string;
  startedAt?: number;
  expectedFilenames: string[];
  maxWaitMs?: number;
}): Promise<ImportedGmailDraftAttachment[]> {
  const gmail = await getGmailClient();
  if (!gmail) {
    throw new Error("Sign in with Google to import Mixmax template attachments");
  }

  const subjectMarker = params.subjectMarker.trim();
  const bodyMarker = params.bodyMarker.trim();
  if (!subjectMarker || !bodyMarker) throw new Error("Missing draft import markers");

  const startedAt = params.startedAt ?? Date.now();
  const deadline = Date.now() + (params.maxWaitMs ?? 45_000);
  let draftId: string | null = null;

  while (Date.now() < deadline) {
    draftId = await findMatchingMixmaxDraftId(gmail, {
      subjectMarker,
      bodyMarker,
      toEmail: params.toEmail,
      startedAt,
      expectedFilenames: params.expectedFilenames,
    });
    if (draftId) break;
    await sleep(1_000);
  }

  if (!draftId) {
    throw new Error(
      "Could not import Mixmax cloud attachments automatically. Try sending this template once from Gmail/Mixmax first, or re-save the file in Mixmax as a traditional paperclip attachment."
    );
  }

  try {
    const full = await gmail.users.drafts.get({
      userId: "me",
      id: draftId,
      format: "full",
    });
    const message = full.data.message;
    const messageId = message?.id;
    const payload = message?.payload;
    if (!messageId || !payload) {
      throw new Error("Gmail draft is missing attachment data");
    }

    const parts = extractAttachmentsFromPayload(payload);
    if (parts.length === 0) {
      throw new Error(
        "Mixmax did not sync template files as Gmail attachments. Re-save the template in Mixmax with a traditional (paperclip) attachment instead of cloud-only hosting."
      );
    }

    const expected = params.expectedFilenames.map((name) => sanitizeAttachmentFilename(name));
    const imported: ImportedGmailDraftAttachment[] = [];

    for (const part of parts) {
      const { data } = await fetchGmailAttachment({
        gmailMessageId: messageId,
        gmailAttachmentId: part.gmailAttachmentId,
      });
      const filename = sanitizeAttachmentFilename(part.filename);
      if (expected.length > 0 && !expected.some((name) => filenamesMatch(name, filename))) {
        continue;
      }
      imported.push({
        filename,
        mimeType: part.mimeType || "application/octet-stream",
        data,
      });
    }

    if (imported.length === 0) {
      throw new Error("Could not match template attachment files in the Gmail draft");
    }

    return imported;
  } finally {
    try {
      await gmail.users.drafts.delete({ userId: "me", id: draftId });
    } catch {
      /* best-effort cleanup */
    }
  }
}

async function importThreadMessages(
  gmail: gmail_v1.Gmail,
  threadId: string,
  ticketRowId: string,
  requesterEmail: string,
  agentEmail: string,
  knownIds: Set<string>,
  importCutoff: string | null
): Promise<void> {
  const owner = getTicketRowIdForGmailThread(threadId);
  if (owner && owner !== ticketRowId) return;

  const thread = await gmail.users.threads.get({
    userId: "me",
    id: threadId,
    format: "full",
  });

  for (const msg of thread.data.messages ?? []) {
    if (!msg.id) continue;
    if (isGmailMessageRedactionBlocked(ticketRowId, msg.id)) continue;
    if (msg.threadId && msg.threadId !== threadId) continue;

    const parsed = parseGmailMessage(msg, ticketRowId, requesterEmail, agentEmail);
    if (!parsed || parsed.message.gmailThreadId !== threadId) continue;

    const existsInDb = knownIds.has(msg.id);
    if (
      !existsInDb &&
      importCutoff &&
      new Date(parsed.message.sentAt).getTime() < new Date(importCutoff).getTime()
    ) {
      continue;
    }

    upsertThreadMessageFromGmail(parsed.message, parsed.attachments);
    knownIds.add(msg.id);
  }
}

/**
 * Sync Gmail messages for a ticket across all linked thread IDs.
 * Outbound replies still use the primary thread only.
 */
export async function syncGmailThreadForTicket(params: {
  ticketRowId: string;
  requesterEmail: string;
  intakeTimestamp?: string;
}): Promise<{ messages: ThreadMessage[]; statusReopened: boolean }> {
  return withOpsMetric("gmail", "thread.sync", async () => {
  const gmail = await getGmailClient();

  pruneMismatchedThreadMessages(params.ticketRowId);
  dedupeThreadMessagesForTicket(params.ticketRowId);

  if (!ticketHasExplicitGmailLink(params.ticketRowId)) {
    const statusReopened = reopenPendingOnCustomerReply(params.ticketRowId);
    if (params.intakeTimestamp) {
      refreshResponseSlaDueAt(params.ticketRowId, params.intakeTimestamp);
    }
    await markTicketGmailThreadAsRead({
      ticketRowId: params.ticketRowId,
      requesterEmail: params.requesterEmail,
    });
    return {
      messages: getThreadMessages(params.ticketRowId),
      statusReopened,
    };
  }

  let threadIds = getLinkedGmailThreadIdsForTicket(params.ticketRowId);
  if (threadIds.length === 0) {
    const primary = await ensureTicketGmailApiThreadId({
      ticketRowId: params.ticketRowId,
      requesterEmail: params.requesterEmail,
    });
    if (primary) threadIds = [primary];
  }

  if (!gmail || threadIds.length === 0 || !params.requesterEmail.trim()) {
    const statusReopened = reopenPendingOnCustomerReply(params.ticketRowId);
    if (params.intakeTimestamp) {
      refreshResponseSlaDueAt(params.ticketRowId, params.intakeTimestamp);
    }
    await markTicketGmailThreadAsRead({
      ticketRowId: params.ticketRowId,
      requesterEmail: params.requesterEmail,
    });
    return {
      messages: getThreadMessages(params.ticketRowId),
      statusReopened,
    };
  }

  const agentEmail = await resolveSenderEmail();
  const existing = getThreadMessages(params.ticketRowId);
  const knownIds = new Set(
    existing.map((m) => m.gmailMessageId).filter((id): id is string => Boolean(id))
  );

  for (const threadId of threadIds) {
    const resolved =
      isGmailApiThreadId(threadId)
        ? threadId
        : await ensureTicketGmailApiThreadId({
            ticketRowId: params.ticketRowId,
            requesterEmail: params.requesterEmail,
          });
    if (!resolved) continue;

    const importCutoff = getGmailThreadImportCutoffForThread(params.ticketRowId, threadId);
    await importThreadMessages(
      gmail,
      resolved,
      params.ticketRowId,
      params.requesterEmail,
      agentEmail,
      knownIds,
      importCutoff
    );
  }

  pruneMismatchedThreadMessages(params.ticketRowId);
  dedupeThreadMessagesForTicket(params.ticketRowId);

  const statusReopened = reopenPendingOnCustomerReply(params.ticketRowId);
  if (params.intakeTimestamp) {
    refreshResponseSlaDueAt(params.ticketRowId, params.intakeTimestamp);
  }
  await markTicketGmailThreadAsRead({
    ticketRowId: params.ticketRowId,
    requesterEmail: params.requesterEmail,
  });
  const messages = getThreadMessages(params.ticketRowId).sort(
    (a, b) => new Date(a.sentAt).getTime() - new Date(b.sentAt).getTime()
  );

  return { messages, statusReopened };
  });
}

/** Import messages for one linked Gmail thread (e.g. immediately after append). */
export async function importGmailThreadMessagesForTicket(params: {
  ticketRowId: string;
  threadId: string;
  requesterEmail: string;
  /** When true, import the entire thread — not only messages at/after link time. */
  importFullHistory?: boolean;
}): Promise<void> {
  const gmail = await getGmailClient();
  if (!gmail || !params.requesterEmail.trim()) return;

  const threadId = params.threadId.trim();
  if (!threadId) return;

  const agentEmail = await resolveSenderEmail();
  const existing = getThreadMessages(params.ticketRowId);
  const knownIds = new Set(
    existing.map((m) => m.gmailMessageId).filter((id): id is string => Boolean(id))
  );
  const importCutoff = params.importFullHistory
    ? null
    : getGmailThreadImportCutoffForThread(params.ticketRowId, threadId);

  await importThreadMessages(
    gmail,
    threadId,
    params.ticketRowId,
    params.requesterEmail,
    agentEmail,
    knownIds,
    importCutoff
  );
  pruneMismatchedThreadMessages(params.ticketRowId);
  dedupeThreadMessagesForTicket(params.ticketRowId);
}

export async function sendReplyEmail(params: {
  ticketRowId: string;
  to: string;
  subject: string;
  body: string;
  cc?: string | null;
  bcc?: string | null;
  attachments?: OutboundEmailAttachment[];
}): Promise<ThreadMessage> {
  return withOpsMetric("gmail", "messages.send", async () => {
  const from = await resolveSenderEmail();
  const forceNewThread = ticketForceNewGmailThreadOnSend(params.ticketRowId);
  let boundThreadId: string | null = null;
  if (!forceNewThread) {
    boundThreadId = resolveTicketGmailThreadId(params.ticketRowId);
    if (!boundThreadId || !isGmailApiThreadId(boundThreadId)) {
      boundThreadId = await ensureTicketGmailApiThreadId({
        ticketRowId: params.ticketRowId,
        requesterEmail: params.to,
      });
    }
  }

  const message: ThreadMessage = {
    id: uuidv4(),
    ticketRowId: params.ticketRowId,
    direction: "outbound",
    from,
    to: params.to,
    cc: params.cc?.trim() || null,
    subject: params.subject,
    body: params.body,
    gmailMessageId: null,
    gmailThreadId: boundThreadId,
    sentAt: new Date().toISOString(),
  };

  const gmail = await getGmailClient();
  if (gmail) {
    const signatureHtml = await fetchGmailSignature(gmail, from);
    const bodyForSend =
      params.body.trim() ||
      ((params.attachments?.length ?? 0) > 0 ? "(see attachments)" : params.body);
    const { plain, html } = appendSignatureToBody(bodyForSend, signatureHtml);
    // Store HTML in the CRM thread so conversation matches draft/Gmail formatting.
    message.body = html ? sanitizeEmailHtml(html) : plain;

    const encoded = encodeMessage(
      from,
      params.to,
      params.subject,
      plain,
      params.cc,
      html,
      params.attachments ?? [],
      params.bcc
    );
    const res = await gmail.users.messages.send({
      userId: "me",
      requestBody: {
        raw: encoded,
        threadId: boundThreadId ?? undefined,
      },
    });
    message.gmailMessageId = res.data.id ?? null;
    message.gmailThreadId = res.data.threadId ?? boundThreadId;

    if (message.gmailMessageId && !message.gmailThreadId) {
      const meta = await gmail.users.messages.get({
        userId: "me",
        id: message.gmailMessageId,
        format: "metadata",
      });
      message.gmailThreadId = meta.data.threadId ?? null;
    }

    if (message.gmailThreadId) {
      if (forceNewThread) {
        clearForceNewGmailThreadOnSend(params.ticketRowId);
      }
      claimGmailThreadForTicket(params.ticketRowId, message.gmailThreadId);
    }
  }

  addThreadMessage(message);

  if (message.gmailThreadId) {
    void markGmailThreadAsRead(message.gmailThreadId);
  } else {
    void markTicketGmailThreadAsRead({
      ticketRowId: params.ticketRowId,
      requesterEmail: params.to,
    });
  }

  return message;
  });
}

/** Send a one-off email (dashboard reports, etc.) without binding to a ticket thread. */
export async function sendStandaloneEmail(params: {
  to: string;
  subject: string;
  body: string;
  attachments?: OutboundEmailAttachment[];
}): Promise<{ messageId: string | null }> {
  return withOpsMetric("gmail", "messages.send", async () => {
    const to = params.to.trim();
    if (!to) throw new Error("Recipient email is required");

    const from = await resolveSenderEmail();
    const gmail = await getGmailClient();
    if (!gmail) {
      throw new Error("Gmail is not connected — sign in with Google to send reports");
    }

    const signatureHtml = await fetchGmailSignature(gmail, from);
    const bodyForSend = params.body.trim() || "(empty report)";
    const { plain, html } = appendSignatureToBody(bodyForSend, signatureHtml);

    const encoded = encodeMessage(
      from,
      to,
      params.subject,
      plain,
      null,
      html,
      params.attachments ?? [],
      null
    );
    const res = await gmail.users.messages.send({
      userId: "me",
      requestBody: { raw: encoded },
    });
    return { messageId: res.data.id ?? null };
  });
}

/** Remove UNREAD from a Gmail API thread id. */
export async function markGmailThreadAsRead(threadId: string): Promise<boolean> {
  const gmail = await getGmailClient();
  const id = threadId.trim();
  if (!gmail || !id || !isGmailApiThreadId(id)) return false;

  try {
    await gmail.users.threads.modify({
      userId: "me",
      id,
      requestBody: { removeLabelIds: ["UNREAD"] },
    });
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/insufficient.*scope|403|permission/i.test(message)) {
      console.warn(
        "[SheetsCRM Gmail] Mark-as-read needs gmail.modify — sign out and sign in again to grant it."
      );
    } else {
      console.warn(`[SheetsCRM Gmail] Mark-as-read failed for thread ${id}:`, message);
    }
    return false;
  }
}

/** Mark all Gmail threads linked to a CRM ticket as read in the inbox. */
export async function markTicketGmailThreadAsRead(params: {
  ticketRowId: string;
  requesterEmail?: string | null;
}): Promise<boolean> {
  if (process.env.USE_MOCK_DATA === "true") return false;
  if (ticketForceNewGmailThreadOnSend(params.ticketRowId)) return false;

  const linked = getLinkedGmailThreadIdsForTicket(params.ticketRowId);
  if (linked.length > 0) {
    let anyMarked = false;
    for (const threadId of linked) {
      if (await markGmailThreadAsRead(threadId)) anyMarked = true;
    }
    return anyMarked;
  }

  let threadId = await ensureTicketGmailApiThreadId({
    ticketRowId: params.ticketRowId,
    requesterEmail: params.requesterEmail,
  });

  if (!threadId && params.requesterEmail?.trim()) {
    const gmail = await getGmailClient();
    if (gmail) {
      const resolved = await resolveThreadIdByGmailSearch(
        gmail,
        `from:${params.requesterEmail.trim()}`,
        params.requesterEmail
      );
      if (resolved) {
        claimGmailThreadForTicket(params.ticketRowId, resolved);
        threadId = resolved;
      }
    }
  }

  if (!threadId) return false;

  return markGmailThreadAsRead(threadId);
}

export async function hasGmailCredentials(): Promise<boolean> {
  return Boolean(await getGmailClient());
}
