/**
 * Short-lived unread-inbox cache + inflight coalesce.
 * Fresh hits return in 20s; overlapping opens share one Gmail fetch.
 */

import type { GmailUnreadThreadPreview } from "./types";
import { fetchUnreadGmailThreads } from "./gmail";
import { getSignedInUser } from "./google-auth";
import { coalesceInflight } from "./async-work";

export const UNREAD_GMAIL_FRESH_MS = 20_000;
export const UNREAD_GMAIL_STALE_MS = 5 * 60 * 1000;

type UnreadCacheEntry = {
  email: string;
  limit: number;
  threads: GmailUnreadThreadPreview[];
  fetchedAt: number;
};

const STORE = Symbol.for("sheetscrm.unreadGmailStore");

function store(): { entries: Map<string, UnreadCacheEntry> } {
  const holder = globalThis as typeof globalThis & {
    [STORE]?: { entries: Map<string, UnreadCacheEntry> };
  };
  if (!holder[STORE]) holder[STORE] = { entries: new Map() };
  return holder[STORE];
}

function cacheKey(email: string, limit: number): string {
  return `${email}:${limit}`;
}

export function invalidateUnreadGmailCache(): void {
  store().entries.clear();
}

export function removeUnreadGmailThreadFromCache(threadId: string): void {
  const id = threadId.trim();
  if (!id) return;
  for (const [key, entry] of store().entries) {
    const next = entry.threads.filter((thread) => thread.threadId !== id);
    if (next.length === entry.threads.length) continue;
    store().entries.set(key, { ...entry, threads: next });
  }
}

export async function loadUnreadGmailInbox(options: {
  limit: number;
  forceRefresh?: boolean;
}): Promise<{
  unread: GmailUnreadThreadPreview[];
  stale: boolean;
  fetchedAt: number | null;
}> {
  const { email } = await getSignedInUser();
  const owner = email?.trim() || "signed-in";
  const limit = Math.max(1, Math.min(options.limit, 100));
  const key = cacheKey(owner, limit);
  const cached = store().entries.get(key);
  const age = cached ? Date.now() - cached.fetchedAt : Number.POSITIVE_INFINITY;

  if (cached && !options.forceRefresh && age <= UNREAD_GMAIL_FRESH_MS) {
    return { unread: cached.threads, stale: false, fetchedAt: cached.fetchedAt };
  }

  try {
    const entry = await coalesceInflight(`gmail:unread:${key}`, async () => {
      const threads = await fetchUnreadGmailThreads(limit);
      const next: UnreadCacheEntry = {
        email: owner,
        limit,
        threads,
        fetchedAt: Date.now(),
      };
      store().entries.set(key, next);
      return next;
    });
    return { unread: entry.threads, stale: false, fetchedAt: entry.fetchedAt };
  } catch (error) {
    if (cached) {
      return { unread: cached.threads, stale: true, fetchedAt: cached.fetchedAt };
    }
    throw error;
  }
}
