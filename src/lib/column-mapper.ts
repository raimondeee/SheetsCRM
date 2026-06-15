import type { ColumnMapping, ColumnRole, SheetConfig } from "./types";
import { indexToLetter } from "./types";
import { EXAMPLE_COLUMN_POSITIONS } from "./default-sheet-config";

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

  applyFixedPositions(mappings);
  return mappings;
}

function roleMatchedByHeader(role: ColumnRole, header: string): boolean {
  const entry = HEADER_PATTERNS.find((p) => p.role === role);
  return entry?.patterns.some((p) => p.test(header.trim())) ?? false;
}

/** Re-apply header analysis to a saved config (fixes stale mappings). */
export function normalizeSheetConfig(config: SheetConfig): SheetConfig {
  const sorted = [...config.columns].sort((a, b) => a.index - b.index);
  const maxIndex = sorted.reduce((max, col) => Math.max(max, col.index), 0);
  const headers = Array.from({ length: maxIndex + 1 }, (_, index) => {
    const col = sorted.find((c) => c.index === index);
    return col?.sheetHeader?.trim() || col?.header?.trim() || `Column ${indexToLetter(index)}`;
  });

  const hasRealHeaders = headers.some(
    (h) => h && !/^column [a-z]+$/i.test(h)
  );

  const columns = hasRealHeaders ? analyzeHeaders(headers) : ensureDefaultColumnRoles(sorted);
  return { ...config, columns };
}

function ensureDefaultColumnRoles(columns: ColumnMapping[]): ColumnMapping[] {
  const mappings = columns.map((c) => ({ ...c }));
  applyFixedPositions(mappings);
  return mappings;
}

/** Prefer known K/M/R/N positions when headers are ambiguous */
function applyFixedPositions(mappings: ColumnMapping[]): void {
  const fixed: { role: ColumnRole; index: number }[] = [
    { role: "rowKey", index: EXAMPLE_COLUMN_POSITIONS.rowKey.index },
    { role: "email", index: EXAMPLE_COLUMN_POSITIONS.email.index },
    { role: "reservationCode", index: EXAMPLE_COLUMN_POSITIONS.reservationCode.index },
    { role: "listingId", index: EXAMPLE_COLUMN_POSITIONS.listingId.index },
    { role: "marketManager", index: EXAMPLE_COLUMN_POSITIONS.marketManager.index },
    { role: "contactReason", index: EXAMPLE_COLUMN_POSITIONS.contactReason.index },
    { role: "userEmailed", index: EXAMPLE_COLUMN_POSITIONS.userEmailed.index },
    { role: "internalToolK", index: EXAMPLE_COLUMN_POSITIONS.internalToolK.index },
    { role: "internalToolM", index: EXAMPLE_COLUMN_POSITIONS.internalToolM.index },
    { role: "status", index: EXAMPLE_COLUMN_POSITIONS.status.index },
    { role: "internalToolR", index: EXAMPLE_COLUMN_POSITIONS.internalToolR.index },
    { role: "caseSummary", index: EXAMPLE_COLUMN_POSITIONS.caseSummary.index },
    { role: "airbnbUserId", index: EXAMPLE_COLUMN_POSITIONS.airbnbUserId.index },
  ];

  for (const { role, index } of fixed) {
    const existing = mappings.find((m) => m.role === role);
    if (existing && existing.index === index) continue;

    // Keep header-detected Market Manager / contact reason even if not at H / I.
    // Airbnb User ID is always Column AD — do not keep ambiguous "user id" headers elsewhere.
    if (
      role !== "airbnbUserId" &&
      existing &&
      existing.index !== index &&
      roleMatchedByHeader(role, existing.header)
    ) {
      continue;
    }

    if (existing) existing.role = "unknown";

    let target = mappings.find((m) => m.index === index);
    if (!target) {
      target = {
        index,
        letter: indexToLetter(index),
        header: `Column ${indexToLetter(index)}`,
        role,
      };
      mappings.push(target);
    } else {
      target.role = role;
    }
  }

  mappings.sort((a, b) => a.index - b.index);
}

export function getColumnByRole(
  config: SheetConfig,
  role: ColumnRole
): ColumnMapping | undefined {
  if (role === "airbnbUserId") return getAirbnbUserIdColumn(config);
  return config.columns.find((c) => c.role === role);
}

/** Airbnb User ID always lives in Column AD on the intake sheet. */
export function getAirbnbUserIdColumn(config: SheetConfig): ColumnMapping {
  const atAd = config.columns.find(
    (c) => c.index === EXAMPLE_COLUMN_POSITIONS.airbnbUserId.index
  );
  return {
    index: EXAMPLE_COLUMN_POSITIONS.airbnbUserId.index,
    letter: EXAMPLE_COLUMN_POSITIONS.airbnbUserId.letter,
    header: atAd?.header?.trim() || "Airbnb User ID",
    role: "airbnbUserId",
  };
}

/** Read a cell by role, with a direct header-pattern fallback for marketManager. */
export function getCellValueByRole(
  row: string[],
  config: SheetConfig,
  role: ColumnRole
): string {
  const mapped = getCellValue(row, getColumnByRole(config, role));
  if (mapped || role !== "marketManager") return mapped;

  const headerMatch = config.columns.find(
    (c) => c.role === "unknown" && roleMatchedByHeader("marketManager", c.header)
  );
  if (headerMatch) return getCellValue(row, headerMatch);

  return getCellValue(row, {
    index: EXAMPLE_COLUMN_POSITIONS.marketManager.index,
    letter: EXAMPLE_COLUMN_POSITIONS.marketManager.letter,
    header: "Market Manager",
    role: "marketManager",
  });
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
