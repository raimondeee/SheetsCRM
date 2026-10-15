/**
 * Reply drafts — SQLite via /api/reply-drafts (migrates off localStorage).
 */
import { isCompleteEmailSubject } from "./email-subject";
import { isRichTextEmpty } from "./html-utils";
import type { ReplyDraft } from "./reply-draft-types";

export type { ReplyDraft } from "./reply-draft-types";

const LEGACY_STORAGE_KEY = "sheetscrm_reply_drafts";
const skipSaveRowIds = new Set<string>();
const memory = new Map<string, ReplyDraft>();
const pendingLoads = new Map<string, Promise<ReplyDraft | null>>();

function readLegacy(rowId: string): ReplyDraft | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(LEGACY_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Record<string, ReplyDraft>;
    const draft = parsed?.[rowId];
    if (!draft || typeof draft.body !== "string") return null;
    return {
      body: draft.body,
      subject: typeof draft.subject === "string" ? draft.subject : "",
      cc: typeof draft.cc === "string" ? draft.cc : "",
      bcc: typeof draft.bcc === "string" ? draft.bcc : "",
      updatedAt: typeof draft.updatedAt === "number" ? draft.updatedAt : 0,
    };
  } catch {
    return null;
  }
}

function removeLegacy(rowId: string): void {
  if (typeof window === "undefined") return;
  try {
    const raw = localStorage.getItem(LEGACY_STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as Record<string, ReplyDraft>;
    if (!(rowId in parsed)) return;
    delete parsed[rowId];
    if (Object.keys(parsed).length === 0) localStorage.removeItem(LEGACY_STORAGE_KEY);
    else localStorage.setItem(LEGACY_STORAGE_KEY, JSON.stringify(parsed));
  } catch {
    /* ignore */
  }
}

export async function loadReplyDraft(rowId: string): Promise<ReplyDraft | null> {
  if (skipSaveRowIds.has(rowId)) return null;
  if (memory.has(rowId)) return memory.get(rowId) ?? null;

  const existing = pendingLoads.get(rowId);
  if (existing) return existing;

  const load = (async () => {
    try {
      const res = await fetch(`/api/reply-drafts/${encodeURIComponent(rowId)}`, {
        cache: "no-store",
        credentials: "same-origin",
      });
      const data = (await res.json()) as { draft?: ReplyDraft | null };
      if (res.ok && data.draft) {
        memory.set(rowId, data.draft);
        removeLegacy(rowId);
        return data.draft;
      }
    } catch {
      /* fall through to legacy */
    }

    const legacy = readLegacy(rowId);
    if (legacy) {
      memory.set(rowId, legacy);
      void saveReplyDraft(rowId, legacy).then(() => removeLegacy(rowId));
      return legacy;
    }
    return null;
  })();

  pendingLoads.set(rowId, load);
  try {
    return await load;
  } finally {
    pendingLoads.delete(rowId);
  }
}

export async function saveReplyDraft(
  rowId: string,
  draft: { body: string; subject: string; cc?: string; bcc?: string }
): Promise<void> {
  if (typeof window === "undefined") return;

  const body = draft.body;
  const subject = draft.subject.trim();
  const cc = draft.cc?.trim() ?? "";
  const bcc = draft.bcc?.trim() ?? "";
  const hasSubject = isCompleteEmailSubject(subject);
  if (isRichTextEmpty(body) && !hasSubject && !cc && !bcc) {
    // After an intentional clear (successful send), ignore empty autosaves so they
    // cannot race a restore. Non-empty saves below re-enable persistence.
    if (skipSaveRowIds.has(rowId)) return;
    await clearReplyDraft(rowId);
    return;
  }

  skipSaveRowIds.delete(rowId);
  const payload: ReplyDraft = {
    body,
    subject: hasSubject ? subject : "",
    cc,
    bcc,
    updatedAt: Date.now(),
  };
  memory.set(rowId, payload);

  await fetch(`/api/reply-drafts/${encodeURIComponent(rowId)}`, {
    method: "PUT",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }).catch(() => undefined);
}

export async function clearReplyDraft(rowId: string): Promise<void> {
  if (typeof window === "undefined") return;
  skipSaveRowIds.add(rowId);
  memory.delete(rowId);
  removeLegacy(rowId);
  await fetch(`/api/reply-drafts/${encodeURIComponent(rowId)}`, {
    method: "DELETE",
    credentials: "same-origin",
  }).catch(() => undefined);
}
