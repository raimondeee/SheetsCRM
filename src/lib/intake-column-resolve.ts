/**
 * Resolve personal intake column roles from live sheet headers (letter fallback)
 * and sample-check Status / Timestamp health after column deletes or reorders.
 */
import { roleLabel } from "./column-roles";
import { mapSheetStatusToCrmId, normalizeStatusId } from "./status-mapper";
import { parseSheetTimestamp } from "./ticket-activity";
import type { ColumnMapping, ColumnRole, SheetConfig } from "./types";
import { indexToLetter, letterToIndex } from "./types";
import { prepareSheetConfig } from "./ui-field-slots";

export type IntakeColumnMatchSource = "header" | "fallback" | "unmapped";

export interface IntakeColumnFieldResolution {
  role: ColumnRole;
  letter: string | null;
  index: number | null;
  matchedBy: IntakeColumnMatchSource;
  matchedHeader?: string;
  letterDrift?: { from: string; to: string; header: string };
}

export interface IntakeColumnResolution {
  config: SheetConfig;
  fields: IntakeColumnFieldResolution[];
  letterDrift: Partial<
    Record<ColumnRole, { from: string; to: string; header: string }>
  >;
  warnings: string[];
}

/** Roles rematched from header text when agents delete/reorder columns. */
const RESOLVE_ROLES: ColumnRole[] = [
  "timestamp",
  "email",
  "name",
  "status",
  "marketManager",
  "contactReason",
  "caseSummary",
  "airbnbUserId",
  "reservationCode",
  "claimNumber",
  "listingId",
  "userEmailed",
  "subject",
  "description",
  "ticketHeaderField",
  "inFavorOfHost",
  "csInTheWrong",
  "remediationSuccessful",
  "internalToolK",
  "internalToolM",
  "internalToolR",
  "rowKey",
];

/** Slightly stricter than Setup analyze for status (avoid matching "Stage of stay"). */
const ROLE_PATTERNS: Partial<Record<ColumnRole, RegExp[]>> = {
  timestamp: [/timestamp/i, /submitted/i, /date\s*time/i, /^date$/i, /submission\s*time/i],
  email: [/email/i, /e-mail/i, /contact.*email/i],
  name: [/^(full\s*)?name$/i, /your name/i, /contact name/i, /requester/i],
  subject: [/subject/i, /^title$/i, /^topic$/i],
  description: [/description/i, /^message$/i, /details/i, /^issue$/i, /request/i, /comment/i],
  status: [/^status$/i, /case\s*status/i, /ticket\s*status/i, /^state$/i, /^stage$/i],
  contactReason: [/contact\s*reason/i, /^reason$/i, /inquiry\s*type/i, /^category$/i],
  userEmailed: [/user\s*emailed/i, /emailed\s*user/i, /email\s*sent/i],
  marketManager: [
    /market\s*manager/i,
    /^mm$/i,
    /host\s*manager/i,
    /your\s*market\s*manager/i,
    /select.*market\s*manager/i,
  ],
  caseSummary: [/case\s*summary/i, /admin\s*notes/i],
  airbnbUserId: [/airbnb\s*user\s*id/i, /^user\s*id$/i, /host\s*id/i],
  reservationCode: [/reservation\s*code/i, /^reso$/i, /confirmation\s*code/i, /booking\s*code/i],
  claimNumber: [/claim\s*(number|no\.?|#|id)?/i, /^claims?$/i, /^clsf/i],
  listingId: [/listing\s*id/i, /^listing$/i, /property\s*id/i, /space\s*id/i],
  ticketHeaderField: [/header\s*field/i, /form\s*id/i, /ticket\s*header/i],
  inFavorOfHost: [/in\s*favor\s*of\s*host/i, /favour\s*of\s*host/i],
  csInTheWrong: [/cs\s*in\s*the\s*wrong/i, /original\s*decision\s*wrong/i],
  remediationSuccessful: [/remediation\s*successful/i, /overturn.*decision/i],
  internalToolK: [/tool.*k/i, /internal.*k/i],
  internalToolM: [/tool.*m/i, /internal.*m/i],
  internalToolR: [/tool.*r/i, /internal.*r/i],
  rowKey: [/timestamp/i, /submitted/i, /row\s*key/i],
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

function findHeaderIndex(
  headers: string[],
  patterns: RegExp[],
  usedIndexes: Set<number>
): number {
  for (let i = 0; i < headers.length; i += 1) {
    if (usedIndexes.has(i)) continue;
    const header = (headers[i] ?? "").trim();
    if (!header) continue;
    if (patterns.some((pattern) => pattern.test(header))) return i;
  }
  return -1;
}

function savedRoleLetter(config: SheetConfig, role: ColumnRole): string | null {
  const col = config.columns.find((c) => c.role === role);
  return col?.letter?.toUpperCase() ?? null;
}

function savedRoleIndex(config: SheetConfig, role: ColumnRole): number | null {
  const col = config.columns.find((c) => c.role === role);
  if (!col) return null;
  if (typeof col.index === "number" && col.index >= 0) return col.index;
  if (col.letter) return letterToIndex(col.letter);
  return null;
}

function buildColumnsFromHeaders(
  headers: string[],
  roleByIndex: Map<number, ColumnRole>,
  previous: SheetConfig
): ColumnMapping[] {
  const previousByIndex = new Map(previous.columns.map((c) => [c.index, c]));
  const previousByHeader = new Map(
    previous.columns
      .map((c) => [(c.sheetHeader || c.header || "").trim().toLowerCase(), c] as const)
      .filter(([h]) => Boolean(h))
  );

  return headers.map((rawHeader, index) => {
    const header = (rawHeader ?? "").trim();
    const prev =
      previousByIndex.get(index) ??
      (header ? previousByHeader.get(header.toLowerCase()) : undefined);
    return {
      index,
      letter: indexToLetter(index),
      header: header || prev?.header || `Column ${indexToLetter(index)}`,
      sheetHeader: header || prev?.sheetHeader || "",
      role: roleByIndex.get(index) ?? "unknown",
      hidden: prev?.hidden && !roleByIndex.has(index) ? true : false,
    };
  });
}

function remapUiFieldSlots(config: SheetConfig, previous: SheetConfig): SheetConfig {
  const prepared = prepareSheetConfig(config);
  const prevByIndex = new Map(previous.columns.map((c) => [c.index, c]));
  const nextByHeader = new Map(
    prepared.columns
      .map((c) => [(c.sheetHeader || c.header || "").trim().toLowerCase(), c] as const)
      .filter(([h]) => Boolean(h))
  );

  const uiFieldSlots = (prepared.uiFieldSlots ?? []).map((slot) => {
    if (slot.columnIndex == null) return slot;
    const prevCol = prevByIndex.get(slot.columnIndex);
    const header = (prevCol?.sheetHeader || prevCol?.header || "").trim().toLowerCase();
    if (!header) return slot;
    const nextCol = nextByHeader.get(header);
    if (!nextCol || nextCol.index === slot.columnIndex) return slot;
    return { ...slot, columnIndex: nextCol.index };
  });

  return { ...prepared, uiFieldSlots };
}

/**
 * Remap intake roles from live headers; fall back to saved letters when no header matches.
 * Does not persist — callers apply Detect + Save to keep letters durable.
 *
 * When `config.manuallyMapped` is true, saved role letters win (needed for duplicate /
 * near-duplicate headers). Detect can still propose changes for review.
 */
export function resolveIntakeColumnsFromHeaders(
  config: SheetConfig,
  headers: string[],
  options?: { label?: string }
): IntakeColumnResolution {
  const label = options?.label?.trim() || config.sheetName || "Intake sheet";
  const warnings: string[] = [];
  const letterDrift: IntakeColumnResolution["letterDrift"] = {};
  const fields: IntakeColumnFieldResolution[] = [];
  const usedIndexes = new Set<number>();
  const roleByIndex = new Map<number, ColumnRole>();

  if (headers.length === 0) {
    warnings.push(`${label}: could not read sheet headers — using saved column letters.`);
    return {
      config,
      fields: [],
      letterDrift: {},
      warnings,
    };
  }

  const lockedManual = config.manuallyMapped === true;

  for (const role of RESOLVE_ROLES) {
    const patterns = ROLE_PATTERNS[role];
    const savedLetter = savedRoleLetter(config, role);
    const savedIndex = savedRoleIndex(config, role);
    let index = -1;
    let matchedBy: IntakeColumnMatchSource = "unmapped";
    let matchedHeader: string | undefined;
    let drift: IntakeColumnFieldResolution["letterDrift"];

    if (lockedManual) {
      // Operator-locked mapping: never steal a role because another column has a similar header.
      if (savedIndex != null && savedIndex >= 0 && savedIndex < headers.length) {
        index = savedIndex;
        matchedBy = "fallback";
        matchedHeader = (headers[index] ?? "").trim() || undefined;
      } else if (savedLetter) {
        warnings.push(
          `${label}: saved ${roleLabel(role)} column ${savedLetter} is outside the current header row.`
        );
      }
    } else {
      index = patterns ? findHeaderIndex(headers, patterns, usedIndexes) : -1;

      if (index >= 0) {
        matchedBy = "header";
        matchedHeader = (headers[index] ?? "").trim();
        const toLetter = indexToLetter(index);
        if (savedLetter && savedLetter !== toLetter) {
          drift = { from: savedLetter, to: toLetter, header: matchedHeader };
          letterDrift[role] = drift;
          warnings.push(
            `${label}: ${roleLabel(role)} header "${matchedHeader}" is column ${toLetter} (saved mapping was ${savedLetter}). Using header.`
          );
        }
      } else if (savedIndex != null && savedIndex >= 0 && savedIndex < headers.length) {
        index = savedIndex;
        matchedBy = "fallback";
        matchedHeader = (headers[index] ?? "").trim() || undefined;
        if (patterns && matchedHeader) {
          const liveHeader = matchedHeader;
          const stillLooksLikeRole = patterns.some((pattern) => pattern.test(liveHeader));
          if (!stillLooksLikeRole) {
            const stolenBy = RESOLVE_ROLES.find((other) => {
              if (other === role) return false;
              const otherPatterns = ROLE_PATTERNS[other];
              return otherPatterns?.some((pattern) => pattern.test(liveHeader)) ?? false;
            });
            if (stolenBy) {
              warnings.push(
                `${label}: saved ${roleLabel(role)} column ${savedLetter ?? indexToLetter(index)} now has header "${liveHeader}" (looks like ${roleLabel(stolenBy)}). Remap with Detect columns.`
              );
            }
          }
        }
      } else if (savedLetter) {
        warnings.push(
          `${label}: saved ${roleLabel(role)} column ${savedLetter} is outside the current header row.`
        );
      }
    }

    if (index >= 0 && !usedIndexes.has(index)) {
      usedIndexes.add(index);
      roleByIndex.set(index, role);
      fields.push({
        role,
        letter: indexToLetter(index),
        index,
        matchedBy,
        matchedHeader,
        letterDrift: drift,
      });
    } else if (index >= 0 && usedIndexes.has(index) && lockedManual) {
      // Duplicate saved role indexes shouldn't happen; skip quietly when locked.
      fields.push({
        role,
        letter: null,
        index: null,
        matchedBy: "unmapped",
      });
    } else {
      fields.push({
        role,
        letter: null,
        index: null,
        matchedBy: "unmapped",
      });
    }
  }

  // Preserve any extra mapped roles not in RESOLVE_ROLES (legacy / custom).
  for (const col of config.columns) {
    if (col.role === "unknown") continue;
    if (roleByIndex.has(col.index)) continue;
    if (col.index < 0 || col.index >= headers.length) continue;
    if (usedIndexes.has(col.index)) continue;
    usedIndexes.add(col.index);
    roleByIndex.set(col.index, col.role);
  }

  // Ensure rowKey exists — prefer timestamp column when rowKey stayed unmapped.
  if (![...roleByIndex.values()].includes("rowKey")) {
    const timestampIndex = [...roleByIndex.entries()].find(([, role]) => role === "timestamp")?.[0];
    if (timestampIndex != null) {
      // rowKey aliases timestamp; keep timestamp role on the column.
    } else if (!roleByIndex.has(0) && !lockedManual) {
      roleByIndex.set(0, "rowKey");
    }
  }

  let nextConfig: SheetConfig = {
    ...config,
    columns: buildColumnsFromHeaders(headers, roleByIndex, config),
    updatedAt: new Date().toISOString(),
  };
  nextConfig = remapUiFieldSlots(nextConfig, config);

  return {
    config: nextConfig,
    fields,
    letterDrift,
    warnings,
  };
}

function cell(row: string[], index: number | null | undefined): string {
  if (index == null || index < 0) return "";
  return String(row[index] ?? "").trim();
}

function looksLikeKnownStatus(value: string): boolean {
  const id = normalizeStatusId(mapSheetStatusToCrmId(value));
  return KNOWN_STATUS_IDS.has(id) || id === "new";
}

/** Sample parsed rows for empty/wrong-looking Status and Timestamp values. */
export function assessIntakeSheetDataHealth(
  config: SheetConfig,
  rows: string[][],
  options?: { label?: string; sampleLimit?: number }
): string[] {
  const label = options?.label?.trim() || config.sheetName || "Intake sheet";
  const sampleLimit = options?.sampleLimit ?? 80;
  const warnings: string[] = [];
  const sample = rows.slice(0, sampleLimit);
  if (sample.length === 0) {
    warnings.push(`${label}: sheet tab has no data rows.`);
    return warnings;
  }

  const statusCol = config.columns.find((c) => c.role === "status");
  const timestampCol =
    config.columns.find((c) => c.role === "timestamp") ??
    config.columns.find((c) => c.role === "rowKey");
  const emailCol = config.columns.find((c) => c.role === "email");

  let withSignal = 0;
  let statusFilled = 0;
  let statusKnown = 0;
  let timestampFilled = 0;
  let timestampParsed = 0;
  let emailFilled = 0;

  for (const row of sample) {
    const timestamp = cell(row, timestampCol?.index);
    const status = cell(row, statusCol?.index);
    const email = cell(row, emailCol?.index);
    if (!timestamp && !status && !email) continue;
    withSignal += 1;
    if (status) {
      statusFilled += 1;
      if (looksLikeKnownStatus(status)) statusKnown += 1;
    }
    if (timestamp) {
      timestampFilled += 1;
      if (parseSheetTimestamp(timestamp)) timestampParsed += 1;
    }
    if (email) emailFilled += 1;
  }

  if (withSignal === 0) {
    warnings.push(`${label}: no usable rows found with the current column mapping.`);
    return warnings;
  }

  if (emailCol && emailFilled / withSignal < 0.35) {
    warnings.push(
      `${label}: Email column looks mostly empty (${emailFilled}/${withSignal} sampled rows). The Email column may have moved.`
    );
  }

  if (statusCol) {
    // Empty status is normal for brand-new intakes; only warn when values look like the wrong column.
    if (statusFilled / withSignal >= 0.35 && statusKnown / Math.max(statusFilled, 1) < 0.35) {
      warnings.push(
        `${label}: Status values rarely look like CRM statuses (${statusKnown}/${statusFilled} known). Confirm the Status column mapping.`
      );
    }
  } else {
    warnings.push(`${label}: Status column is not mapped.`);
  }

  if (timestampCol) {
    if (timestampFilled / withSignal < 0.35) {
      warnings.push(
        `${label}: Timestamp column looks mostly empty (${timestampFilled}/${withSignal} sampled rows).`
      );
    } else if (timestampParsed / Math.max(timestampFilled, 1) < 0.5) {
      warnings.push(
        `${label}: Timestamp values often fail to parse (${timestampParsed}/${timestampFilled}). Confirm the Timestamp column.`
      );
    }
  }

  return warnings;
}

export function resolveAndAssessIntakeSheet(
  config: SheetConfig,
  headers: string[],
  dataRows: string[][] = [],
  options?: { label?: string }
): IntakeColumnResolution {
  const resolution = resolveIntakeColumnsFromHeaders(config, headers, options);
  // Locked manual maps (e.g. intentional duplicate headers) skip sample health noise.
  const dataWarnings =
    dataRows.length > 0 && config.manuallyMapped !== true
      ? assessIntakeSheetDataHealth(resolution.config, dataRows, options)
      : [];
  return {
    ...resolution,
    warnings: [...resolution.warnings, ...dataWarnings],
  };
}
