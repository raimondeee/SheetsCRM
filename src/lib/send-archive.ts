import { readFilesAsAttachmentPayload } from "./outbound-attachments";
import type { QueuedSendPayload } from "./queued-send";

export const SEND_ARCHIVE_LIMIT = 10;

export type SendArchiveStatus = "queued" | "sent" | "failed" | "cancelled";

export interface SendArchiveAttachment {
  filename: string;
  mimeType: string;
  data: string;
}

export interface SendArchiveEntry {
  id: string;
  savedAt: string;
  status: SendArchiveStatus;
  ticketRowId: string;
  label: string;
  to: string;
  subject: string;
  message: string;
  cc: string | null;
  bcc: string | null;
  statusAfterSend: "pending" | "resolved";
  intakeTimestamp?: string;
  attachments: SendArchiveAttachment[];
  errorMessage?: string;
  completedAt?: string;
}

const STORAGE_KEY = "sheetscrm_send_archive";

type SendArchiveListener = () => void;
const listeners = new Set<SendArchiveListener>();

function notifyListeners() {
  for (const listener of listeners) {
    listener();
  }
}

export function subscribeSendArchive(listener: SendArchiveListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function loadRaw(): SendArchiveEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isSendArchiveEntry);
  } catch {
    return [];
  }
}

function isSendArchiveEntry(value: unknown): value is SendArchiveEntry {
  if (!value || typeof value !== "object") return false;
  const row = value as Partial<SendArchiveEntry>;
  return (
    typeof row.id === "string" &&
    typeof row.savedAt === "string" &&
    typeof row.status === "string" &&
    typeof row.ticketRowId === "string" &&
    typeof row.to === "string" &&
    typeof row.subject === "string" &&
    typeof row.message === "string"
  );
}

function persist(entries: SendArchiveEntry[]): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(entries.slice(0, SEND_ARCHIVE_LIMIT)));
  notifyListeners();
}

export function loadSendArchive(): SendArchiveEntry[] {
  return loadRaw().slice(0, SEND_ARCHIVE_LIMIT);
}

export function clearSendArchive(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(STORAGE_KEY);
  notifyListeners();
}

export function updateSendArchiveEntry(
  id: string,
  patch: Partial<Pick<SendArchiveEntry, "status" | "errorMessage" | "completedAt">>
): void {
  const entries = loadRaw();
  const index = entries.findIndex((entry) => entry.id === id);
  if (index < 0) return;
  entries[index] = { ...entries[index], ...patch };
  persist(entries);
}

export function newSendArchiveId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `send-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/** Snapshot a queued send (full body + attachment payloads). Returns archive id. */
export async function recordQueuedSend(
  payload: QueuedSendPayload,
  archiveId = newSendArchiveId()
): Promise<string> {
  const attachments =
    payload.attachmentFiles.length > 0
      ? await readFilesAsAttachmentPayload(payload.attachmentFiles)
      : [];

  const entry: SendArchiveEntry = {
    id: archiveId,
    savedAt: new Date().toISOString(),
    status: "queued",
    ticketRowId: payload.ticketRowId,
    label: payload.label,
    to: payload.to,
    subject: payload.subject,
    message: payload.message,
    cc: payload.cc,
    bcc: payload.bcc,
    statusAfterSend: payload.statusAfterSend,
    intakeTimestamp: payload.intakeTimestamp,
    attachments,
  };

  const entries = loadRaw();
  entries.unshift(entry);
  persist(entries);
  return archiveId;
}

export function markSendArchiveSent(id: string): void {
  updateSendArchiveEntry(id, {
    status: "sent",
    completedAt: new Date().toISOString(),
    errorMessage: undefined,
  });
}

export function markSendArchiveFailed(id: string, errorMessage: string): void {
  updateSendArchiveEntry(id, {
    status: "failed",
    completedAt: new Date().toISOString(),
    errorMessage,
  });
}

export function markSendArchiveCancelled(id: string): void {
  updateSendArchiveEntry(id, {
    status: "cancelled",
    completedAt: new Date().toISOString(),
  });
}
