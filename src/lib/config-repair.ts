import type { ColumnMapping, SheetConfig } from "./types";

function columnLabel(col: ColumnMapping | undefined): string {
  return (col?.sheetHeader ?? col?.header ?? "").trim();
}

function looksLikeTimestampColumn(col: ColumnMapping | undefined): boolean {
  const label = columnLabel(col).toLowerCase();
  return /timestamp|submitted|date\s*time|^date$/.test(label);
}

function looksLikeMisassignedRowKey(col: ColumnMapping | undefined): boolean {
  if (!col) return false;
  const label = columnLabel(col);
  return (
    /^mm$/i.test(label) ||
    /market\s*manager/i.test(label) ||
    col.role === "marketManager"
  );
}

export function rowKeyMappingWarning(config: SheetConfig): string | null {
  const rowKeyCol = config.columns.find((c) => c.role === "rowKey");
  if (!rowKeyCol) {
    return "No row key mapped — map Timestamp (column A) as Row key or tickets may not load.";
  }
  if (looksLikeMisassignedRowKey(rowKeyCol)) {
    return `Row key is on column ${rowKeyCol.letter} ("${columnLabel(rowKeyCol)}") — most tickets will be hidden. Use Timestamp (column A) instead.`;
  }
  return null;
}

/** Move row key off helper/MM columns back to the timestamp column (usually A). */
export function repairRowKeyMapping(config: SheetConfig): SheetConfig {
  const columns = config.columns.map((col) => ({ ...col }));
  const rowKeyCol = columns.find((c) => c.role === "rowKey");
  const timestampCol =
    columns.find((c) => c.role === "timestamp") ??
    columns.find((c) => c.index === 0);

  const needsRepair =
    !rowKeyCol ||
    looksLikeMisassignedRowKey(rowKeyCol) ||
    (rowKeyCol.index !== 0 && looksLikeTimestampColumn(timestampCol));

  if (!needsRepair) return config;

  if (rowKeyCol) rowKeyCol.role = "unknown";

  const target =
    (timestampCol && looksLikeTimestampColumn(timestampCol) ? timestampCol : null) ??
    columns.find((c) => c.index === 0) ??
    timestampCol;

  if (target) {
    const previousRole = target.role;
    target.role = "rowKey";
    if (previousRole === "timestamp") {
      /* timestamp reads still fall back to column A */
    }
  }

  return { ...config, columns };
}
