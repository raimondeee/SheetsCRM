/** Ordered Mixmax starred template IDs (persisted in user preferences / overlay.db). */

const LEGACY_STORAGE_KEY = "sheetscrm_mixmax_starred_templates";
const LEGACY_MIGRATION_FLAG = "sheetscrm_mixmax_starred_migrated_v1";

export function normalizeMixmaxStarredTemplateIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") continue;
    const id = item.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

/** @deprecated Browser-only legacy store — migrated into overlay.db preferences. */
export function loadLegacyMixmaxStarredTemplateIds(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(LEGACY_STORAGE_KEY);
    if (!raw) return [];
    return normalizeMixmaxStarredTemplateIds(JSON.parse(raw));
  } catch {
    return [];
  }
}

export function clearLegacyMixmaxStarredTemplateIds(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(LEGACY_STORAGE_KEY);
  localStorage.setItem(LEGACY_MIGRATION_FLAG, "1");
}

export function hasLegacyMixmaxStarredTemplateIds(): boolean {
  if (typeof window === "undefined") return false;
  if (localStorage.getItem(LEGACY_MIGRATION_FLAG)) return false;
  return Boolean(localStorage.getItem(LEGACY_STORAGE_KEY));
}

export function sortMixmaxTemplatesWithStarred<T extends { id: string }>(
  templates: T[],
  starredIds: string[]
): T[] {
  const order = new Map(starredIds.map((id, index) => [id, index]));
  return [...templates].sort((a, b) => {
    const aOrder = order.get(a.id);
    const bOrder = order.get(b.id);
    const aStarred = aOrder !== undefined;
    const bStarred = bOrder !== undefined;
    if (aStarred && bStarred) return aOrder - bOrder;
    if (aStarred && !bStarred) return -1;
    if (!aStarred && bStarred) return 1;
    return 0;
  });
}

export function toggleMixmaxStarredTemplateId(
  starredIds: string[],
  templateId: string
): string[] {
  const id = templateId.trim();
  if (!id) return starredIds;
  if (starredIds.includes(id)) {
    return starredIds.filter((existing) => existing !== id);
  }
  return [...starredIds, id];
}

/** Move a starred id from one index to another within the starred list. */
export function reorderMixmaxStarredTemplateIds(
  starredIds: string[],
  fromId: string,
  toId: string
): string[] {
  if (fromId === toId) return starredIds;
  const fromIndex = starredIds.indexOf(fromId);
  const toIndex = starredIds.indexOf(toId);
  if (fromIndex < 0 || toIndex < 0) return starredIds;
  const next = [...starredIds];
  const [moved] = next.splice(fromIndex, 1);
  if (!moved) return starredIds;
  next.splice(toIndex, 0, moved);
  return next;
}
