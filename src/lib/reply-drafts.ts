import { isCompleteEmailSubject } from "./email-subject";
import { isRichTextEmpty } from "./html-utils";

export interface ReplyDraft {
  body: string;
  subject: string;
  cc?: string;
  bcc?: string;
  updatedAt: number;
}

const STORAGE_KEY = "sheetscrm_reply_drafts";
const MAX_DRAFTS = 200;

/** Prevents unmount auto-save from restoring a draft right after send. */
const skipSaveRowIds = new Set<string>();

function loadAll(): Record<string, ReplyDraft> {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, ReplyDraft>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function persistAll(drafts: Record<string, ReplyDraft>): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(drafts));
}

export function loadReplyDraft(rowId: string): ReplyDraft | null {
  if (skipSaveRowIds.has(rowId)) return null;
  const draft = loadAll()[rowId];
  if (!draft || typeof draft.body !== "string") return null;
  return {
    body: draft.body,
    subject: typeof draft.subject === "string" ? draft.subject : "",
    cc: typeof draft.cc === "string" ? draft.cc : "",
    bcc: typeof draft.bcc === "string" ? draft.bcc : "",
    updatedAt: typeof draft.updatedAt === "number" ? draft.updatedAt : 0,
  };
}

export function saveReplyDraft(
  rowId: string,
  draft: { body: string; subject: string; cc?: string; bcc?: string }
): void {
  if (typeof window === "undefined") return;
  if (skipSaveRowIds.has(rowId)) return;

  const body = draft.body;
  const subject = draft.subject.trim();
  const cc = draft.cc?.trim() ?? "";
  const bcc = draft.bcc?.trim() ?? "";
  const hasSubject = isCompleteEmailSubject(subject);
  if (isRichTextEmpty(body) && !hasSubject && !cc && !bcc) {
    clearReplyDraft(rowId);
    return;
  }

  skipSaveRowIds.delete(rowId);

  const all = loadAll();
  all[rowId] = {
    body,
    subject: hasSubject ? subject : "",
    cc,
    bcc,
    updatedAt: Date.now(),
  };

  const entries = Object.entries(all).sort(([, a], [, b]) => b.updatedAt - a.updatedAt);
  if (entries.length > MAX_DRAFTS) {
    const pruned = Object.fromEntries(entries.slice(0, MAX_DRAFTS));
    persistAll(pruned);
    return;
  }

  persistAll(all);
}

export function clearReplyDraft(rowId: string): void {
  if (typeof window === "undefined") return;
  skipSaveRowIds.add(rowId);
  const all = loadAll();
  if (!(rowId in all)) return;
  delete all[rowId];
  persistAll(all);
}
