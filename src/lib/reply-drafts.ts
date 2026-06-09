import { isRichTextEmpty } from "./html-utils";

export interface ReplyDraft {
  body: string;
  subject: string;
  updatedAt: number;
}

const STORAGE_KEY = "sheetscrm_reply_drafts";
const MAX_DRAFTS = 200;

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
  const draft = loadAll()[rowId];
  if (!draft || typeof draft.body !== "string") return null;
  return {
    body: draft.body,
    subject: typeof draft.subject === "string" ? draft.subject : "",
    updatedAt: typeof draft.updatedAt === "number" ? draft.updatedAt : 0,
  };
}

export function saveReplyDraft(
  rowId: string,
  draft: { body: string; subject: string }
): void {
  if (typeof window === "undefined") return;

  const body = draft.body;
  const subject = draft.subject.trim();
  if (isRichTextEmpty(body) && !subject) {
    clearReplyDraft(rowId);
    return;
  }

  const all = loadAll();
  all[rowId] = { body, subject, updatedAt: Date.now() };

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
  const all = loadAll();
  if (!(rowId in all)) return;
  delete all[rowId];
  persistAll(all);
}
