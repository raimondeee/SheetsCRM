export interface MixmaxSnippet {
  id: string;
  name: string;
  title: string;
  source: string;
  customShortcut?: string;
}

interface MixmaxSnippetsResponse {
  results?: Array<{
    _id: string;
    name?: string;
    title?: string;
    source?: string;
    customShortcut?: string;
  }>;
  message?: string;
}

const MIXMAX_API_BASE = "https://api.mixmax.com/v1";

export function getMixmaxApiToken(): string | null {
  const token = process.env.MIXMAX_API_TOKEN?.trim();
  return token || null;
}

export function isMixmaxConfigured(): boolean {
  return Boolean(getMixmaxApiToken());
}

/** Mixmax search filter: only templates owned by the API token user. */
export function buildOwnedTemplatesSearch(userSearch?: string): string {
  const owned = "owner:myself";
  const q = userSearch?.trim();
  return q ? `${owned} ${q}` : owned;
}

export async function fetchMixmaxTemplates(search?: string): Promise<MixmaxSnippet[]> {
  const token = getMixmaxApiToken();
  if (!token) return [];

  const params = new URLSearchParams({
    limit: "100",
    isInline: "false",
    search: buildOwnedTemplatesSearch(search),
  });

  const res = await fetch(`${MIXMAX_API_BASE}/snippets?${params.toString()}`, {
    headers: { "X-API-Token": token },
    cache: "no-store",
  });

  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { message?: string };
    throw new Error(err.message ?? `Mixmax API error (${res.status})`);
  }

  const data = (await res.json()) as MixmaxSnippetsResponse;
  return (data.results ?? []).map((snippet) => ({
    id: snippet._id,
    name: snippet.name ?? snippet.title ?? "Untitled template",
    title: snippet.title ?? "",
    source: snippet.source ?? "",
    customShortcut: snippet.customShortcut,
  }));
}
