export interface TicketComposePrefs {
  ccMarketManager: boolean;
}

export const DEFAULT_COMPOSE_PREFS: TicketComposePrefs = {
  ccMarketManager: false,
};

export async function fetchComposePrefs(ticketRowId: string): Promise<TicketComposePrefs> {
  try {
    const res = await fetch(
      `/api/compose-prefs/${encodeURIComponent(ticketRowId)}`,
      { cache: "no-store", credentials: "same-origin" }
    );
    const data = await res.json();
    if (!res.ok) return DEFAULT_COMPOSE_PREFS;
    return {
      ccMarketManager: Boolean(data.prefs?.ccMarketManager),
    };
  } catch {
    return DEFAULT_COMPOSE_PREFS;
  }
}

export async function saveComposePrefs(
  ticketRowId: string,
  prefs: TicketComposePrefs
): Promise<void> {
  await fetch(`/api/compose-prefs/${encodeURIComponent(ticketRowId)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(prefs),
  });
}
