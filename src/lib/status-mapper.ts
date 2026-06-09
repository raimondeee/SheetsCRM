import { DEFAULT_STATUSES } from "./types";

const SHEET_STATUS_PATTERNS: { id: string; patterns: RegExp[] }[] = [
  {
    id: "resolved",
    patterns: [
      /^resolved$/i,
      /^solved$/i,
      /^closed$/i,
      /^complete/i,
      /^done$/i,
      /archived/i,
    ],
  },
  {
    id: "do_not_action",
    patterns: [/^do\s*not\s*action$/i, /no\s*action/i, /\bdna\b/i],
  },
  {
    id: "longterm_hold",
    patterns: [
      /longterm\s*hold/i,
      /long[\s-]?term\s*hold/i,
      /hold\s*\/\s*bugs/i,
      /^on\s*hold$/i,
      /paused/i,
      /deferred/i,
      /blocked/i,
    ],
  },
  {
    id: "open",
    patterns: [
      /^open$/i,
      /in\s*progress/i,
      /in\s*review/i,
      /working/i,
      /active/i,
      /assigned/i,
    ],
  },
  {
    id: "pending",
    patterns: [
      /^pending$/i,
      /awaiting/i,
      /waiting/i,
      /on\s*customer/i,
      /customer\s*response/i,
      /follow[\s-]?up/i,
    ],
  },
  {
    id: "new",
    patterns: [/^new$/i, /not\s*started/i, /unassigned/i, /submitted/i],
  },
];

const CRM_TO_SHEET_LABEL: Record<string, string> = {
  open: "Open",
  pending: "Pending",
  resolved: "Resolved",
  do_not_action: "Do Not Action",
  longterm_hold: "Longterm Hold/Bugs",
};

/** Normalize legacy overlay / API status ids. */
export function normalizeStatusId(statusId: string): string {
  const trimmed = statusId.trim().toLowerCase().replace(/\s+/g, "_");
  if (trimmed === "solved") return "resolved";
  if (trimmed === "on_hold") return "longterm_hold";
  return trimmed;
}

/** Map a Column N value to a CRM status id. Unknown values become a slug id for display. */
export function mapSheetStatusToCrmId(sheetStatus: string): string {
  const trimmed = sheetStatus.trim();
  if (!trimmed) return "new";

  const byId = DEFAULT_STATUSES.find(
    (s) => s.id === normalizeStatusId(trimmed)
  );
  if (byId) return byId.id;

  const byLabel = DEFAULT_STATUSES.find((s) => s.label.toLowerCase() === trimmed.toLowerCase());
  if (byLabel) return byLabel.id;

  for (const { id, patterns } of SHEET_STATUS_PATTERNS) {
    if (patterns.some((p) => p.test(trimmed))) return id;
  }

  return trimmed.toLowerCase().replace(/\s+/g, "_");
}

export function crmStatusLabel(statusId: string): string {
  const normalized = normalizeStatusId(statusId);
  return (
    DEFAULT_STATUSES.find((s) => s.id === normalized)?.label ??
    normalized.replace(/_/g, " ")
  );
}

/** Value written to sheet Column N when CRM status changes. Returns null for CRM-only New. */
export function mapCrmStatusToSheetValue(statusId: string): string | null {
  const normalized = normalizeStatusId(statusId);
  if (normalized === "new") return null;
  return CRM_TO_SHEET_LABEL[normalized] ?? crmStatusLabel(normalized);
}

export function isSheetSyncedStatus(statusId: string): boolean {
  return mapCrmStatusToSheetValue(statusId) !== null;
}
