export interface TicketComposePrefs {
  ccMarketManager: boolean;
}

const STORAGE_KEY = "sheetscrm_compose_prefs";
const MAX_PREFS = 500;

function loadAll(): Record<string, TicketComposePrefs> {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, TicketComposePrefs>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function persistAll(prefs: Record<string, TicketComposePrefs>): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
}

export function loadComposePrefs(rowId: string): TicketComposePrefs {
  const stored = loadAll()[rowId];
  return {
    ccMarketManager: Boolean(stored?.ccMarketManager),
  };
}

export function saveComposePrefs(rowId: string, prefs: TicketComposePrefs): void {
  if (typeof window === "undefined") return;
  const all = loadAll();
  all[rowId] = { ccMarketManager: Boolean(prefs.ccMarketManager) };

  const entries = Object.entries(all);
  if (entries.length > MAX_PREFS) {
    persistAll(Object.fromEntries(entries.slice(-MAX_PREFS)));
    return;
  }

  persistAll(all);
}
