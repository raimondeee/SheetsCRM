export interface AdminNoteDraft {
  text: string;
  updatedAt: number;
}

const STORAGE_KEY = "sheetscrm_admin_note_drafts";
const MAX_DRAFTS = 200;

function loadAll(): Record<string, AdminNoteDraft> {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, AdminNoteDraft>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function persistAll(drafts: Record<string, AdminNoteDraft>): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(drafts));
}

export function loadAdminNoteDraft(rowId: string): string | null {
  const draft = loadAll()[rowId];
  if (!draft || typeof draft.text !== "string") return null;
  return draft.text.trim() ? draft.text : null;
}

export function saveAdminNoteDraft(rowId: string, text: string): void {
  if (typeof window === "undefined") return;

  if (!text.trim()) {
    clearAdminNoteDraft(rowId);
    return;
  }

  const all = loadAll();
  all[rowId] = { text, updatedAt: Date.now() };

  const entries = Object.entries(all).sort(([, a], [, b]) => b.updatedAt - a.updatedAt);
  if (entries.length > MAX_DRAFTS) {
    persistAll(Object.fromEntries(entries.slice(0, MAX_DRAFTS)));
    return;
  }

  persistAll(all);
}

export function clearAdminNoteDraft(rowId: string): void {
  if (typeof window === "undefined") return;
  const all = loadAll();
  if (!(rowId in all)) return;
  delete all[rowId];
  persistAll(all);
}
