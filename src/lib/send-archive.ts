/**
 * Recent-send archive — client facade over SQLite via /api/send-archive.
 * Migrates once from legacy localStorage key sheetscrm_send_archive.
 */
import { inferAttachmentMimeType, readFilesAsAttachmentPayload } from "./outbound-attachments";
import { normalizeDraftHtml } from "./html-utils";
import type { QueuedSendPayload } from "./queued-send";
import { SEND_ARCHIVE_LIMIT } from "./composer-persistence-constants";
import type { SendArchiveEntry } from "./send-archive-types";

export type {
  SendArchiveAttachment,
  SendArchiveEntry,
  SendArchiveStatus,
} from "./send-archive-types";
export { SEND_ARCHIVE_LIMIT } from "./composer-persistence-constants";

const LEGACY_STORAGE_KEY = "sheetscrm_send_archive";
/** Keep recent-send JSON small; compose restore uses in-memory File objects. */
const ARCHIVE_INLINE_ATTACHMENT_MAX_BYTES = 1024 * 1024;

type SendArchiveListener = () => void;
const listeners = new Set<SendArchiveListener>();
let memoryCache: SendArchiveEntry[] | null = null;
let hydratePromise: Promise<void> | null = null;

function notifyListeners() {
  for (const listener of listeners) listener();
}

export function subscribeSendArchive(listener: SendArchiveListener): () => void {
  listeners.add(listener);
  void ensureHydrated();
  return () => listeners.delete(listener);
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

function readLegacyLocalStorage(): SendArchiveEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(LEGACY_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isSendArchiveEntry);
  } catch {
    return [];
  }
}

function clearLegacyLocalStorage(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(LEGACY_STORAGE_KEY);
}

async function ensureHydrated(): Promise<void> {
  if (memoryCache) return;
  if (hydratePromise) return hydratePromise;
  hydratePromise = (async () => {
    try {
      const res = await fetch("/api/send-archive", {
        cache: "no-store",
        credentials: "same-origin",
      });
      const data = (await res.json()) as { entries?: SendArchiveEntry[] };
      let entries = Array.isArray(data.entries) ? data.entries : [];

      const legacy = readLegacyLocalStorage();
      if (legacy.length > 0) {
        for (const entry of legacy.slice().reverse()) {
          await fetch("/api/send-archive", {
            method: "PUT",
            credentials: "same-origin",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ entry }),
          }).catch(() => undefined);
        }
        clearLegacyLocalStorage();
        const refreshed = await fetch("/api/send-archive", {
          cache: "no-store",
          credentials: "same-origin",
        });
        const refreshedData = (await refreshed.json()) as { entries?: SendArchiveEntry[] };
        if (Array.isArray(refreshedData.entries)) entries = refreshedData.entries;
      }

      memoryCache = entries.slice(0, SEND_ARCHIVE_LIMIT);
      notifyListeners();
    } catch {
      memoryCache = readLegacyLocalStorage().slice(0, SEND_ARCHIVE_LIMIT);
      notifyListeners();
    }
  })();
  return hydratePromise;
}

export function loadSendArchive(): SendArchiveEntry[] {
  void ensureHydrated();
  return (memoryCache ?? readLegacyLocalStorage()).slice(0, SEND_ARCHIVE_LIMIT);
}

export async function clearSendArchive(): Promise<void> {
  memoryCache = [];
  notifyListeners();
  clearLegacyLocalStorage();
  await fetch("/api/send-archive", { method: "DELETE", credentials: "same-origin" }).catch(
    () => undefined
  );
}

export async function updateSendArchiveEntry(
  id: string,
  patch: Partial<Pick<SendArchiveEntry, "status" | "errorMessage" | "completedAt">>
): Promise<void> {
  await ensureHydrated();
  const entries = [...(memoryCache ?? [])];
  const index = entries.findIndex((entry) => entry.id === id);
  if (index >= 0) {
    entries[index] = { ...entries[index], ...patch };
    memoryCache = entries;
    notifyListeners();
  }
  await fetch("/api/send-archive", {
    method: "PATCH",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id, ...patch }),
  }).catch(() => undefined);
}

export function newSendArchiveId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `send-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

async function attachmentsForArchive(
  files: File[]
): Promise<SendArchiveEntry["attachments"]> {
  return Promise.all(
    files.map(async (file) => {
      if (file.size > ARCHIVE_INLINE_ATTACHMENT_MAX_BYTES) {
        return {
          filename: file.name,
          mimeType: inferAttachmentMimeType(file.name, file.type),
          data: "",
        };
      }
      const [payload] = await readFilesAsAttachmentPayload([file]);
      return payload;
    })
  );
}

export async function recordQueuedSend(
  payload: QueuedSendPayload,
  archiveId = newSendArchiveId()
): Promise<string> {
  const attachments = await attachmentsForArchive(payload.attachmentFiles);

  const entry: SendArchiveEntry = {
    id: archiveId,
    savedAt: new Date().toISOString(),
    status: "queued",
    ticketRowId: payload.ticketRowId,
    label: payload.label,
    to: payload.to,
    subject: payload.subject,
    message: normalizeDraftHtml(payload.message),
    cc: payload.cc,
    bcc: payload.bcc,
    statusAfterSend: payload.statusAfterSend,
    intakeTimestamp: payload.intakeTimestamp,
    attachments,
  };

  await ensureHydrated();
  memoryCache = [entry, ...(memoryCache ?? []).filter((e) => e.id !== entry.id)].slice(
    0,
    SEND_ARCHIVE_LIMIT
  );
  notifyListeners();

  await fetch("/api/send-archive", {
    method: "PUT",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ entry }),
  }).catch(() => undefined);

  return archiveId;
}

export function markSendArchiveSent(id: string): void {
  void updateSendArchiveEntry(id, {
    status: "sent",
    completedAt: new Date().toISOString(),
    errorMessage: undefined,
  });
}

export function markSendArchiveFailed(id: string, errorMessage: string): void {
  void updateSendArchiveEntry(id, {
    status: "failed",
    completedAt: new Date().toISOString(),
    errorMessage,
  });
}

export function markSendArchiveCancelled(id: string): void {
  void updateSendArchiveEntry(id, {
    status: "cancelled",
    completedAt: new Date().toISOString(),
  });
}
