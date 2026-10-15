/** Browser-side unread inbox cache so reopening the modal is instant. */

import type { GmailUnreadThreadPreview } from "@/lib/types";

export const UNREAD_GMAIL_CLIENT_TTL_MS = 20_000;

export type UnreadGmailCacheEntry = {
  threads: GmailUnreadThreadPreview[];
  fetchedAt: number;
};

let cached: UnreadGmailCacheEntry | null = null;

export function getCachedUnreadGmail(): UnreadGmailCacheEntry | null {
  if (!cached) return null;
  if (Date.now() - cached.fetchedAt > UNREAD_GMAIL_CLIENT_TTL_MS) return null;
  return cached;
}

export function getStaleCachedUnreadGmail(): UnreadGmailCacheEntry | null {
  return cached;
}

export function setCachedUnreadGmail(threads: GmailUnreadThreadPreview[]): UnreadGmailCacheEntry {
  cached = { threads, fetchedAt: Date.now() };
  return cached;
}

export function removeCachedUnreadGmailThread(threadId: string): void {
  if (!cached) return;
  cached = {
    ...cached,
    threads: cached.threads.filter((thread) => thread.threadId !== threadId),
  };
}
