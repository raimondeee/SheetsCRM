import { repairRowKeyMapping } from "./config-repair";
import type { ColumnMapping, SheetConfig, Ticket, UiFieldSlot } from "./types";
import { getCellValue, getColumnByRole } from "./column-mapper";

export const DEFAULT_UI_FIELD_SLOT_COUNT = 4;

export function createDefaultUiFieldSlots(): UiFieldSlot[] {
  return Array.from({ length: DEFAULT_UI_FIELD_SLOT_COUNT }, (_, i) => ({
    id: `ui-${i + 1}`,
    label: `Header field ${i + 1}`,
    columnIndex: null,
  }));
}

/** Backfill sheetHeader, repair row key, and uiFieldSlots on load/save. */
export function prepareSheetConfig(config: SheetConfig): SheetConfig {
  const withHeaders = {
    ...config,
    columns: config.columns.map((col) => ({
      ...col,
      sheetHeader: col.sheetHeader ?? col.header,
    })),
  };
  const repaired = repairRowKeyMapping(withHeaders);
  const syncedSlots = syncUiSlotLabelsWithColumns(repaired);
  return {
    ...repaired,
    uiFieldSlots: syncedSlots,
  };
}

export function ensureUiFieldSlots(config: Pick<SheetConfig, "columns" | "uiFieldSlots">): UiFieldSlot[] {
  const slots = config.uiFieldSlots?.length
    ? config.uiFieldSlots.map((s) => ({ ...s }))
    : createDefaultUiFieldSlots();

  while (slots.length < DEFAULT_UI_FIELD_SLOT_COUNT) {
    slots.push({
      id: `ui-${slots.length + 1}`,
      label: `Header field ${slots.length + 1}`,
      columnIndex: null,
    });
  }

  for (const slot of slots) {
    if (slot.columnIndex == null) continue;
    const col = config.columns.find((c) => c.index === slot.columnIndex);
    if (col?.role === "marketManager") slot.columnIndex = null;
  }

  const headerCol = config.columns.find((c) => c.role === "ticketHeaderField");
  if (
    headerCol &&
    headerCol.role !== "marketManager" &&
    !slots.some((s) => s.columnIndex === headerCol.index)
  ) {
    const firstOpen = slots.find((s) => s.columnIndex == null);
    if (firstOpen) {
      firstOpen.columnIndex = headerCol.index;
      if (firstOpen.label.startsWith("Header field ")) {
        firstOpen.label = headerCol.header?.trim() || firstOpen.label;
      }
    }
  }

  return slots;
}

export function getMappedUiFieldSlots(config: SheetConfig): UiFieldSlot[] {
  return ensureUiFieldSlots(config).filter((slot) => {
    if (slot.columnIndex == null) return false;
    const col = config.columns.find((c) => c.index === slot.columnIndex);
    return col?.role !== "marketManager";
  });
}

export function getVisibleUiFieldSlots(
  config: SheetConfig,
  showUnused: boolean
): UiFieldSlot[] {
  const slots = ensureUiFieldSlots(config);
  if (showUnused) return slots;
  return slots.filter((slot) => slot.columnIndex != null);
}

export function buildUiFieldValues(
  config: SheetConfig,
  row: string[]
): Record<string, string> {
  const values: Record<string, string> = {};
  for (const slot of getMappedUiFieldSlots(config)) {
    const col = config.columns.find((c) => c.index === slot.columnIndex);
    if (col) values[slot.id] = getCellValue(row, col);
  }

  const legacyCol = getColumnByRole(config, "ticketHeaderField");
  if (
    legacyCol &&
    !Object.keys(values).some((slotId) => {
      const slot = ensureUiFieldSlots(config).find((s) => s.id === slotId);
      return slot?.columnIndex === legacyCol.index;
    })
  ) {
    values["legacy-header"] = getCellValue(row, legacyCol);
  }

  return values;
}

export function uiFieldValuesForSearch(ticket: Ticket): string[] {
  const fromMap = Object.values(ticket.uiFields ?? {});
  if (ticket.headerField?.trim()) fromMap.push(ticket.headerField);
  return fromMap;
}

export function resolveUiFieldColumn(
  config: SheetConfig,
  slotId: string
): ColumnMapping | null {
  const slot = ensureUiFieldSlots(config).find((s) => s.id === slotId);
  if (!slot || slot.columnIndex == null) return null;
  return config.columns.find((c) => c.index === slot.columnIndex) ?? null;
}

export function columnDisplayLabel(col: ColumnMapping | null | undefined, fallback = ""): string {
  const label = col?.header?.trim();
  if (label) return label;
  const sheet = col?.sheetHeader?.trim();
  if (sheet) return sheet;
  return fallback;
}

/** Label for a ticket-header UI slot — column display label wins unless slot was customized. */
export function uiFieldDisplayLabel(
  slot: UiFieldSlot,
  col: ColumnMapping | undefined
): string {
  const columnLabel = columnDisplayLabel(col);
  const sheetHeader = col?.sheetHeader?.trim() ?? "";
  const slotLabel = slot.label.trim();

  if (slotLabel && slotLabel !== sheetHeader) {
    return slotLabel;
  }
  return columnLabel || slotLabel || `Field ${slot.id}`;
}

function syncUiSlotLabelsWithColumns(
  config: Pick<SheetConfig, "columns" | "uiFieldSlots">
): UiFieldSlot[] {
  const slots = ensureUiFieldSlots(config);
  return slots.map((slot) => {
    if (slot.columnIndex == null) return slot;
    const col = config.columns.find((c) => c.index === slot.columnIndex);
    if (!col) return slot;

    const sheetHeader = col.sheetHeader?.trim() ?? "";
    const displayHeader = col.header?.trim() ?? "";
    if (
      slot.label.trim() === sheetHeader ||
      (slot.label.startsWith("Header field ") && displayHeader)
    ) {
      return { ...slot, label: displayHeader || slot.label };
    }
    return slot;
  });
}
