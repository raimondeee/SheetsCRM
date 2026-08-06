/**
 * Admin note drafts — SQLite via /api/admin-note-drafts (migrates off localStorage).
 */
const LEGACY_STORAGE_KEY = "sheetscrm_admin_note_drafts";
const memory = new Map<string, string>();

function readLegacy(rowId: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(LEGACY_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Record<string, { text?: string }>;
    const text = parsed?.[rowId]?.text;
    return typeof text === "string" && text.trim() ? text : null;
  } catch {
    return null;
  }
}

function removeLegacy(rowId: string): void {
  if (typeof window === "undefined") return;
  try {
    const raw = localStorage.getItem(LEGACY_STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!(rowId in parsed)) return;
    delete parsed[rowId];
    if (Object.keys(parsed).length === 0) localStorage.removeItem(LEGACY_STORAGE_KEY);
    else localStorage.setItem(LEGACY_STORAGE_KEY, JSON.stringify(parsed));
  } catch {
    /* ignore */
  }
}

export async function loadAdminNoteDraft(rowId: string): Promise<string | null> {
  if (memory.has(rowId)) {
    const text = memory.get(rowId) ?? "";
    return text.trim() ? text : null;
  }
  try {
    const res = await fetch(`/api/admin-note-drafts/${encodeURIComponent(rowId)}`, {
      cache: "no-store",
      credentials: "same-origin",
    });
    const data = (await res.json()) as { text?: string | null };
    if (res.ok && typeof data.text === "string" && data.text.trim()) {
      memory.set(rowId, data.text);
      removeLegacy(rowId);
      return data.text;
    }
  } catch {
    /* fall through */
  }
  const legacy = readLegacy(rowId);
  if (legacy) {
    memory.set(rowId, legacy);
    void saveAdminNoteDraft(rowId, legacy).then(() => removeLegacy(rowId));
    return legacy;
  }
  return null;
}

export async function saveAdminNoteDraft(rowId: string, text: string): Promise<void> {
  if (typeof window === "undefined") return;
  if (!text.trim()) {
    await clearAdminNoteDraft(rowId);
    return;
  }
  memory.set(rowId, text);
  await fetch(`/api/admin-note-drafts/${encodeURIComponent(rowId)}`, {
    method: "PUT",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  }).catch(() => undefined);
}

export async function clearAdminNoteDraft(rowId: string): Promise<void> {
  if (typeof window === "undefined") return;
  memory.delete(rowId);
  removeLegacy(rowId);
  await fetch(`/api/admin-note-drafts/${encodeURIComponent(rowId)}`, {
    method: "DELETE",
    credentials: "same-origin",
  }).catch(() => undefined);
}
