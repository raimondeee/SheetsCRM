import { parseSheetUrl } from "./types";

/** Opens the intake sheet focused on a specific cell (default column C). */
export function buildSheetCellUrl(
  sheetUrl: string,
  rowNumber: number,
  columnLetter = "C"
): string | null {
  const parsed = parseSheetUrl(sheetUrl.trim());
  if (!parsed || rowNumber < 1) return null;

  const range = `${columnLetter}${rowNumber}`;
  const gid = parsed.gid ?? "0";
  const base = `https://docs.google.com/spreadsheets/d/${parsed.spreadsheetId}/edit`;
  return `${base}?gid=${gid}#gid=${gid}&range=${encodeURIComponent(range)}`;
}
