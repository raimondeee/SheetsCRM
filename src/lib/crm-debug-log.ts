export type CrmLogLevel = "info" | "warn" | "error";

export interface CrmLogEntry {
  id: string;
  at: string;
  level: CrmLogLevel;
  message: string;
  detail?: string;
  durationMs?: number;
}

const MAX_ENTRIES = 100;
let enabled = false;
const entries: CrmLogEntry[] = [];
const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((listener) => listener());
}

export function setCrmErrorLoggingEnabled(value: boolean): void {
  enabled = value;
}

export function isCrmErrorLoggingEnabled(): boolean {
  return enabled;
}

export function subscribeCrmDebugLog(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getCrmDebugLogEntries(): CrmLogEntry[] {
  return [...entries];
}

export function clearCrmDebugLog(): void {
  entries.length = 0;
  notify();
}

function pushEntry(entry: Omit<CrmLogEntry, "id" | "at">): void {
  if (!enabled) return;

  const full: CrmLogEntry = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    at: new Date().toISOString(),
    ...entry,
  };
  entries.unshift(full);
  if (entries.length > MAX_ENTRIES) entries.length = MAX_ENTRIES;
  notify();

  const prefix = `[SheetsCRM ${full.level}]`;
  const payload = full.detail ? `${full.message} — ${full.detail}` : full.message;
  if (full.level === "error") console.error(prefix, payload, full.durationMs ?? "");
  else if (full.level === "warn") console.warn(prefix, payload, full.durationMs ?? "");
  else console.info(prefix, payload, full.durationMs ?? "");
}

export function logCrmInfo(message: string, detail?: string): void {
  pushEntry({ level: "info", message, detail });
}

export function logCrmWarn(message: string, detail?: string): void {
  pushEntry({ level: "warn", message, detail });
}

export function logCrmError(message: string, error?: unknown): void {
  const detail =
    error instanceof Error ? error.message : error != null ? String(error) : undefined;
  pushEntry({ level: "error", message, detail });
}

export function logCrmTiming(label: string, durationMs: number, detail?: string): void {
  pushEntry({
    level: durationMs > 2000 ? "warn" : "info",
    message: label,
    detail,
    durationMs: Math.round(durationMs),
  });
}

export type TicketListRefreshReason =
  | "initial"
  | "auto-refresh"
  | "after-edit"
  | "visibility"
  | "manual"
  | "setup";

export function formatCrmRowRef(
  rowNumber?: number | null,
  rowId?: string | null
): string {
  if (rowNumber != null) return `row ${rowNumber}`;
  if (rowId) {
    const tail = rowId.split(":").pop();
    return tail ? `row ${tail}` : rowId;
  }
  return "unknown row";
}

export function formatTicketListRefreshDetail(options: {
  reason: TicketListRefreshReason;
  ticketCount: number;
  source: string;
  sheetSyncQueued?: boolean;
}): string {
  const parts = [
    options.reason,
    `${options.ticketCount} tickets`,
    options.source,
  ];
  if (options.sheetSyncQueued) parts.push("sheet sync queued");
  return parts.join(" · ");
}
