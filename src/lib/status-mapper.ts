import { DEFAULT_STATUSES } from "./types";

const SHEET_STATUS_PATTERNS: { id: string; patterns: RegExp[] }[] = [
  { id: "new", patterns: [/^new$/i, /not\s*started/i, /unassigned/i, /submitted/i] },
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
  { id: "on_hold", patterns: [/^on\s*hold$/i, /paused/i, /deferred/i, /blocked/i] },
  {
    id: "solved",
    patterns: [/^solved$/i, /^closed$/i, /^resolved$/i, /^complete/i, /^done$/i, /archived/i],
  },
];

/** Map a Column N value to a CRM status id. Unknown values become a slug id for display. */
export function mapSheetStatusToCrmId(sheetStatus: string): string {
  const trimmed = sheetStatus.trim();
  if (!trimmed) return "new";

  const byId = DEFAULT_STATUSES.find((s) => s.id === trimmed.toLowerCase().replace(/\s+/g, "_"));
  if (byId) return byId.id;

  const byLabel = DEFAULT_STATUSES.find((s) => s.label.toLowerCase() === trimmed.toLowerCase());
  if (byLabel) return byLabel.id;

  for (const { id, patterns } of SHEET_STATUS_PATTERNS) {
    if (patterns.some((p) => p.test(trimmed))) return id;
  }

  return trimmed.toLowerCase().replace(/\s+/g, "_");
}

export function crmStatusLabel(statusId: string): string {
  return DEFAULT_STATUSES.find((s) => s.id === statusId)?.label ?? statusId.replace(/_/g, " ");
}
