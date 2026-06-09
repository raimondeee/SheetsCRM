import { extractEmailFromField } from "./email-utils";

export interface MarketManager {
  name: string;
  email: string;
}

export interface MarketManagerDirectory {
  updatedAt: string;
  managers: MarketManager[];
}

export function normalizeManagerName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Resolve MM email from sheet cell text and/or the name→email directory. */
export function resolveMarketManagerEmail(
  sheetValue: string,
  directory: MarketManager[]
): string | null {
  const fromField = extractEmailFromField(sheetValue);
  if (fromField) return fromField;

  const normalized = normalizeManagerName(sheetValue);
  if (!normalized) return null;

  const exact = directory.find((m) => normalizeManagerName(m.name) === normalized);
  if (exact?.email) return exact.email.trim();

  const partial = directory.find((m) => {
    const dirName = normalizeManagerName(m.name);
    return dirName.includes(normalized) || normalized.includes(dirName);
  });
  return partial?.email.trim() ?? null;
}

export function sortMarketManagers(managers: MarketManager[]): MarketManager[] {
  return [...managers].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
  );
}

export function parseMarketManagerPaste(text: string): MarketManager[] {
  const rows: MarketManager[] = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || /^name\s+email/i.test(trimmed)) continue;

    const tab = trimmed.split("\t");
    if (tab.length >= 2 && tab[0]?.trim() && tab[1]?.trim()) {
      rows.push({ name: tab[0].trim(), email: tab[1].trim() });
      continue;
    }

    const comma = trimmed.match(/^(.+?),\s*([^\s,]+@[^\s,]+)$/);
    if (comma) {
      rows.push({ name: comma[1].trim(), email: comma[2].trim() });
    }
  }
  return rows;
}
