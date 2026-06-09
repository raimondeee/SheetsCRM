const STORAGE_KEY = "sheetscrm_mixmax_starred_templates";

export function loadMixmaxStarredTemplateIds(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((id): id is string => typeof id === "string"));
  } catch {
    return new Set();
  }
}

export function saveMixmaxStarredTemplateIds(ids: Set<string>): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify([...ids]));
}

export function sortMixmaxTemplatesWithStarred<T extends { id: string }>(
  templates: T[],
  starredIds: Set<string>
): T[] {
  return [...templates].sort((a, b) => {
    const aStarred = starredIds.has(a.id);
    const bStarred = starredIds.has(b.id);
    if (aStarred && !bStarred) return -1;
    if (!aStarred && bStarred) return 1;
    return 0;
  });
}
