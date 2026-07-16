import type { ColumnMapping, ColumnRole, SheetConfig } from "./types";
import { indexToLetter } from "./types";

const HEADER_PATTERNS: { role: ColumnRole; patterns: RegExp[] }[] = [
  { role: "timestamp", patterns: [/timestamp/i, /submitted/i, /date\s*time/i, /^date$/i] },
  { role: "email", patterns: [/email/i, /e-mail/i, /contact.*email/i] },
  { role: "name", patterns: [/^(full\s*)?name$/i, /your name/i, /contact name/i] },
  { role: "subject", patterns: [/subject/i, /title/i, /topic/i, /summary/i] },
  {
    role: "description",
    patterns: [/description/i, /message/i, /details/i, /issue/i, /request/i, /comment/i],
  },
  { role: "status", patterns: [/status/i, /state/i, /stage/i, /workflow/i] },
  { role: "contactReason", patterns: [/contact\s*reason/i, /^reason$/i, /inquiry\s*type/i] },
  { role: "userEmailed", patterns: [/user\s*emailed/i, /emailed\s*user/i, /email\s*sent/i] },
  {
    role: "marketManager",
    patterns: [
      /market\s*manager/i,
      /^mm$/i,
      /host\s*manager/i,
      /your\s*market\s*manager/i,
      /select.*market\s*manager/i,
    ],
  },
  { role: "caseSummary", patterns: [/case\s*summary/i, /admin\s*notes/i, /summary/i] },
  { role: "airbnbUserId", patterns: [/airbnb\s*user\s*id/i, /user\s*id/i, /host\s*id/i] },
  {
    role: "reservationCode",
    patterns: [/reservation\s*code/i, /^reso$/i, /confirmation\s*code/i, /booking\s*code/i],
  },
  {
    role: "claimNumber",
    patterns: [/claim\s*(number|no\.?|#|id)?/i, /^claims?$/i, /^clsf/i],
  },
  {
    role: "listingId",
    patterns: [/listing\s*id/i, /^listing$/i, /property\s*id/i, /space\s*id/i],
  },
  {
    role: "internalToolK",
    patterns: [/tool.*k/i, /internal.*k/i, /account.*id/i, /customer.*id/i, /portal/i],
  },
  {
    role: "internalToolM",
    patterns: [/tool.*m/i, /internal.*m/i, /dashboard/i, /admin.*link/i],
  },
  {
    role: "internalToolR",
    patterns: [/tool.*r/i, /internal.*r/i, /reference/i, /ticket.*ref/i, /order.*id/i],
  },
];

function roleMatchedByHeader(role: ColumnRole, header: string): boolean {
  const entry = HEADER_PATTERNS.find((p) => p.role === role);
  return entry?.patterns.some((p) => p.test(header.trim())) ?? false;
}

export function analyzeHeaders(headers: string[]): ColumnMapping[] {
  const assigned = new Set<ColumnRole>();
  const mappings: ColumnMapping[] = headers.map((header, index) => ({
    index,
    letter: indexToLetter(index),
    header: header.trim(),
    sheetHeader: header.trim(),
    role: "unknown" as ColumnRole,
  }));

  for (const mapping of mappings) {
    for (const { role, patterns } of HEADER_PATTERNS) {
      if (assigned.has(role)) continue;
      if (patterns.some((p) => p.test(mapping.header))) {
        mapping.role = role;
        assigned.add(role);
        break;
      }
    }
  }

  return mappings;
}

/** Re-apply header analysis to a saved config (fixes stale mappings). */
export function normalizeSheetConfig(config: SheetConfig): SheetConfig {
  const sorted = [...config.columns].sort((a, b) => a.index - b.index);
  const maxIndex = sorted.reduce((max, col) => Math.max(max, col.index), 0);
  const headers = Array.from({ length: maxIndex + 1 }, (_, index) => {
    const col = sorted.find((c) => c.index === index);
    return col?.sheetHeader?.trim() || col?.header?.trim() || `Column ${indexToLetter(index)}`;
  });

  const hasRealHeaders = headers.some((h) => h && !/^column [a-z]+$/i.test(h));
  const columns = hasRealHeaders ? analyzeHeaders(headers) : sorted;
  return { ...config, columns };
}

export function getColumnByRole(
  config: SheetConfig,
  role: ColumnRole
): ColumnMapping | undefined {
  return config.columns.find((c) => c.role === role);
}

export function requireColumnByRole(config: SheetConfig, role: ColumnRole): ColumnMapping {
  const col = getColumnByRole(config, role);
  if (!col?.letter) {
    throw new Error(
      `No sheet column mapped for "${role}" — assign it in Setup → Column mapping.`
    );
  }
  return col;
}

/** Read a mapped cell, with optional header-pattern match on unmapped columns. */
export function getCellValueByRole(
  row: string[],
  config: SheetConfig,
  role: ColumnRole
): string {
  const mapped = getColumnByRole(config, role);
  if (mapped) {
    const value = getCellValue(row, mapped);
    if (value) return value;
  }

  const headerMatch = config.columns.find(
    (c) => c.role === "unknown" && roleMatchedByHeader(role, c.header)
  );
  if (headerMatch) return getCellValue(row, headerMatch);

  return "";
}

export function getCellValue(row: string[], mapping: ColumnMapping | undefined): string {
  if (!mapping) return "";
  return (row[mapping.index] ?? "").trim();
}

export function isLikelyUrl(value: string): boolean {
  return /^https?:\/\//i.test(value) || /^www\./i.test(value);
}

export function formatInternalToolLink(value: string): string {
  if (!value) return "";
  if (isLikelyUrl(value)) return value.startsWith("http") ? value : `https://${value}`;
  return value;
}
