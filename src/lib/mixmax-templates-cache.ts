/** Browser-side Mixmax template list cache (survives TicketDetail remounts). */

import type { MixmaxSnippet } from "@/lib/mixmax";

/** Match the server TTL so client + server stay roughly aligned. */
export const MIXMAX_CLIENT_CACHE_TTL_MS = 5 * 60 * 1000;

export type MixmaxTemplatesCacheEntry = {
  enabled: boolean;
  templates: MixmaxSnippet[];
  error: string | null;
  fetchedAt: number;
};

const cache = new Map<string, MixmaxTemplatesCacheEntry>();

export function mixmaxTemplatesCacheKey(search?: string): string {
  return (search ?? "").trim().toLowerCase();
}

export function getCachedMixmaxTemplates(
  search?: string
): MixmaxTemplatesCacheEntry | null {
  const key = mixmaxTemplatesCacheKey(search);
  const entry = cache.get(key);
  if (!entry) return null;
  // Never treat error-only entries as a usable fresh hit.
  if (entry.error && entry.templates.length === 0) {
    cache.delete(key);
    return null;
  }
  if (Date.now() - entry.fetchedAt > MIXMAX_CLIENT_CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return entry;
}

/** Returns a stale entry if present (even past TTL) for instant UI while revalidating. */
export function getStaleCachedMixmaxTemplates(
  search?: string
): MixmaxTemplatesCacheEntry | null {
  return cache.get(mixmaxTemplatesCacheKey(search)) ?? null;
}

export function setCachedMixmaxTemplates(
  search: string | undefined,
  entry: Omit<MixmaxTemplatesCacheEntry, "fetchedAt">
): MixmaxTemplatesCacheEntry {
  const stored: MixmaxTemplatesCacheEntry = {
    ...entry,
    fetchedAt: Date.now(),
  };
  cache.set(mixmaxTemplatesCacheKey(search), stored);
  return stored;
}

export function isMixmaxTemplatesCacheFresh(entry: MixmaxTemplatesCacheEntry): boolean {
  return Date.now() - entry.fetchedAt <= MIXMAX_CLIENT_CACHE_TTL_MS;
}
