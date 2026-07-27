/**
 * Resolve Team Dashboard columns from sheet headers (with letter fallbacks)
 * and produce health warnings when mappings or sampled values look wrong.
 */
import { mapSheetStatusToCrmId, normalizeStatusId } from "./status-mapper";
import type { SheetTabData } from "./sheet-tabs";
import type {
  TeamTabColumnLetters,
  TeamTabColumnMap,
  TeamTabSource,
} from "./team-dashboard-sources";
import { indexToLetter, letterToIndex } from "./types";
import { parseSheetTimestamp } from "./ticket-activity";

export type TeamColumnField = keyof TeamTabColumnLetters;

export type TeamColumnMatchSource = "header" | "fallback";

export interface TeamColumnResolution {
  columns: TeamTabColumnMap;
  letters: TeamTabColumnLetters;
  matchedBy: Record<TeamColumnField, TeamColumnMatchSource>;
  matchedHeaders: Partial<Record<TeamColumnField, string>>;
  /** Header found at a different letter than the saved config. */
  letterDrift: Partial<Record<TeamColumnField, { from: string; to: string; header: string }>>;
  warnings: string[];
}

export interface TeamSourceMappingHealth {
  sourceId: string;
  region: string;
  sheetName: string;
  warnings: string[];
  resolution: TeamColumnResolution;
}

const FIELD_PATTERNS: Record<TeamColumnField, RegExp[]> = {
  timestamp: [/timestamp/i, /submitted/i, /date\s*time/i, /^date$/i, /submission\s*time/i],
  status: [/^status$/i, /case\s*status/i, /ticket\s*status/i, /^state$/i, /^stage$/i],
  owner: [
    /market\s*manager/i,
    /^mm$/i,
    /host\s*manager/i,
    /^owner$/i,
    /assigned\s*to/i,
    /coordinator/i,
  ],
  category: [
    /contact\s*reason/i,
    /^reason$/i,
    /inquiry\s*type/i,
    /^category$/i,
    /issue\s*type/i,
  ],
};

const FIELD_LABELS: Record<TeamColumnField, string> = {
  timestamp: "Timestamp",
  status: "Status",
  owner: "MM",
  category: "Contact Reason",
};

const KNOWN_STATUS_IDS = new Set([
  "new",
  "open",
  "pending",
  "resolved",
  "solved",
  "do_not_action",
  "longterm_hold",
]);

function lettersToMap(letters: TeamTabColumnLetters): TeamTabColumnMap {
  return {
    timestamp: letterToIndex(letters.timestamp),
    status: letterToIndex(letters.status),
    owner: letterToIndex(letters.owner),
    category: letterToIndex(letters.category),
  };
}

function findHeaderIndex(headers: string[], patterns: RegExp[]): number {
  for (let i = 0; i < headers.length; i += 1) {
    const header = (headers[i] ?? "").trim();
    if (!header) continue;
    if (patterns.some((pattern) => pattern.test(header))) return i;
  }
  return -1;
}

/** Map Team Dashboard fields from header text; fall back to configured letters. */
export function resolveTeamColumnsFromHeaders(
  headers: string[],
  fallbackLetters: TeamTabColumnLetters,
  options?: { region?: string }
): TeamColumnResolution {
  const region = options?.region?.trim() || "Source";
  const fields = Object.keys(FIELD_PATTERNS) as TeamColumnField[];
  const letters: TeamTabColumnLetters = { ...fallbackLetters };
  const matchedBy = {} as Record<TeamColumnField, TeamColumnMatchSource>;
  const matchedHeaders: Partial<Record<TeamColumnField, string>> = {};
  const letterDrift: TeamColumnResolution["letterDrift"] = {};
  const warnings: string[] = [];
  const usedIndexes = new Set<number>();

  for (const field of fields) {
    const fallbackLetter = (fallbackLetters[field] || "A").toUpperCase();
    const headerIndex = findHeaderIndex(headers, FIELD_PATTERNS[field]);

    if (headerIndex >= 0 && !usedIndexes.has(headerIndex)) {
      const headerLetter = indexToLetter(headerIndex);
      const headerText = (headers[headerIndex] ?? "").trim();
      letters[field] = headerLetter;
      matchedBy[field] = "header";
      matchedHeaders[field] = headerText;
      usedIndexes.add(headerIndex);
      if (headerLetter !== fallbackLetter) {
        letterDrift[field] = {
          from: fallbackLetter,
          to: headerLetter,
          header: headerText,
        };
        warnings.push(
          `${region}: ${FIELD_LABELS[field]} header "${headerText}" is column ${headerLetter} (saved mapping was ${fallbackLetter}). Using header.`
        );
      }
      continue;
    }

    letters[field] = fallbackLetter;
    matchedBy[field] = "fallback";
    if (headers.length > 0) {
      warnings.push(
        `${region}: could not find a ${FIELD_LABELS[field]} header — using saved column ${fallbackLetter}.`
      );
    }
  }

  // Duplicate letter check
  const letterOwners = new Map<string, TeamColumnField[]>();
  for (const field of fields) {
    const list = letterOwners.get(letters[field]) ?? [];
    list.push(field);
    letterOwners.set(letters[field], list);
  }
  for (const [letter, owners] of letterOwners) {
    if (owners.length > 1) {
      warnings.push(
        `${region}: columns ${owners.map((f) => FIELD_LABELS[f]).join(" / ")} all map to ${letter}.`
      );
    }
  }

  return {
    columns: lettersToMap(letters),
    letters,
    matchedBy,
    matchedHeaders,
    letterDrift,
    warnings,
  };
}

function cell(row: string[], index: number): string {
  if (index < 0) return "";
  return String(row[index] ?? "").trim();
}

function looksLikeKnownStatus(value: string): boolean {
  const id = normalizeStatusId(mapSheetStatusToCrmId(value));
  return KNOWN_STATUS_IDS.has(id);
}

/** Sample parsed rows for empty/wrong-looking Status and Timestamp values. */
export function assessTeamTabDataHealth(
  source: TeamTabSource,
  tab: SheetTabData,
  columns: TeamTabColumnMap,
  sampleLimit = 80
): string[] {
  const warnings: string[] = [];
  const region = source.region || source.sheetName;
  const sample = tab.rows.slice(0, sampleLimit);
  if (sample.length === 0) {
    warnings.push(`${region}: sheet tab has no data rows.`);
    return warnings;
  }

  let withSignal = 0;
  let statusFilled = 0;
  let statusKnown = 0;
  let timestampFilled = 0;
  let timestampParsed = 0;

  for (const row of sample) {
    const timestamp = cell(row, columns.timestamp);
    const status = cell(row, columns.status);
    const owner = cell(row, columns.owner);
    const category = cell(row, columns.category);
    if (!timestamp && !status && !owner && !category) continue;
    withSignal += 1;
    if (status) {
      statusFilled += 1;
      if (looksLikeKnownStatus(status)) statusKnown += 1;
    }
    if (timestamp) {
      timestampFilled += 1;
      if (parseSheetTimestamp(timestamp)) timestampParsed += 1;
    }
  }

  if (withSignal === 0) {
    warnings.push(`${region}: no usable rows found with the current column mapping.`);
    return warnings;
  }

  if (statusFilled / withSignal < 0.35) {
    warnings.push(
      `${region}: Status column looks mostly empty (${statusFilled}/${withSignal} sampled rows). The Status column may have moved.`
    );
  } else if (statusKnown / Math.max(statusFilled, 1) < 0.35) {
    warnings.push(
      `${region}: Status values rarely look like CRM statuses (${statusKnown}/${statusFilled} known). Confirm the Status column mapping.`
    );
  }

  if (timestampFilled / withSignal < 0.35) {
    warnings.push(
      `${region}: Timestamp column looks mostly empty (${timestampFilled}/${withSignal} sampled rows).`
    );
  } else if (timestampParsed / Math.max(timestampFilled, 1) < 0.5) {
    warnings.push(
      `${region}: Timestamp values often fail to parse (${timestampParsed}/${timestampFilled}). Confirm the Timestamp column.`
    );
  }

  return warnings;
}

export function resolveAndAssessTeamTab(
  source: TeamTabSource,
  tab: SheetTabData,
  fallbackLetters: TeamTabColumnLetters
): TeamSourceMappingHealth {
  const resolution = resolveTeamColumnsFromHeaders(tab.headers, fallbackLetters, {
    region: source.region,
  });
  const dataWarnings = assessTeamTabDataHealth(source, tab, resolution.columns);
  return {
    sourceId: source.id,
    region: source.region,
    sheetName: source.sheetName,
    warnings: [...resolution.warnings, ...dataWarnings],
    resolution,
  };
}

export { FIELD_LABELS as TEAM_COLUMN_FIELD_LABELS };
