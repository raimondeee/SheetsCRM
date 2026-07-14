import { withOpsMetric } from "./ops-metrics";

export interface MixmaxSnippet {
  id: string;
  name: string;
  title: string;
  source: string;
  customShortcut?: string;
  attachments: MixmaxAttachmentMeta[];
}

export interface MixmaxAttachmentMeta {
  name: string;
  type: string;
  size: number;
  key: string;
  location?: string;
}

interface MixmaxSnippetRaw {
  _id: string;
  name?: string;
  title?: string;
  source?: string;
  customShortcut?: string;
  attachments?: MixmaxAttachmentRaw[];
}

interface MixmaxAttachmentRaw {
  name?: string;
  type?: string;
  size?: number;
  key?: string;
  location?: string;
}

interface MixmaxSnippetsResponse {
  results?: MixmaxSnippetRaw[];
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

function mapMixmaxAttachment(raw: MixmaxAttachmentRaw): MixmaxAttachmentMeta | null {
  const name = raw.name?.trim();
  const key = raw.key?.trim();
  if (!name || !key) return null;
  return {
    name,
    key,
    type: raw.type?.trim() || "application/octet-stream",
    size: typeof raw.size === "number" && Number.isFinite(raw.size) ? raw.size : 0,
    location: raw.location?.trim() || undefined,
  };
}

function mapMixmaxSnippet(snippet: MixmaxSnippetRaw): MixmaxSnippet {
  return {
    id: snippet._id,
    name: snippet.name ?? snippet.title ?? "Untitled template",
    title: snippet.title ?? "",
    source: snippet.source ?? "",
    customShortcut: snippet.customShortcut,
    attachments: (snippet.attachments ?? [])
      .map(mapMixmaxAttachment)
      .filter((item): item is MixmaxAttachmentMeta => item !== null),
  };
}

async function fetchMixmaxSnippetRaw(id: string): Promise<MixmaxSnippetRaw> {
  const token = getMixmaxApiToken();
  if (!token) throw new Error("Mixmax is not configured");

  const res = await withOpsMetric("mixmax", "snippets.get", () =>
    fetch(`${MIXMAX_API_BASE}/snippets/${encodeURIComponent(id)}`, {
      headers: { "X-API-Token": token },
      cache: "no-store",
    })
  );

  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { message?: string };
    throw new Error(err.message ?? `Mixmax API error (${res.status})`);
  }

  return (await res.json()) as MixmaxSnippetRaw;
}

export async function fetchMixmaxTemplateById(id: string): Promise<MixmaxSnippet> {
  return mapMixmaxSnippet(await fetchMixmaxSnippetRaw(id));
}

export async function fetchMixmaxTemplates(search?: string): Promise<MixmaxSnippet[]> {
  const token = getMixmaxApiToken();
  if (!token) return [];

  const params = new URLSearchParams({
    limit: "100",
    isInline: "false",
    search: buildOwnedTemplatesSearch(search),
  });

  const res = await withOpsMetric("mixmax", "snippets.list", () =>
    fetch(`${MIXMAX_API_BASE}/snippets?${params.toString()}`, {
      headers: { "X-API-Token": token },
      cache: "no-store",
    })
  );

  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { message?: string };
    throw new Error(err.message ?? `Mixmax API error (${res.status})`);
  }

  const data = (await res.json()) as MixmaxSnippetsResponse;
  return (data.results ?? []).map(mapMixmaxSnippet);
}

/** Ask Mixmax to sync a Gmail draft (used to resolve cloud attachment bytes via Gmail). */
export async function createMixmaxGmailSyncDraft(params: {
  to: string;
  subject: string;
  body: string;
  attachments: MixmaxAttachmentMeta[];
}): Promise<{ messageId: string }> {
  const token = getMixmaxApiToken();
  if (!token) throw new Error("Mixmax is not configured");

  const to = params.to.trim();
  if (!to) throw new Error("Recipient email is required to import Mixmax attachments");

  const res = await withOpsMetric("mixmax", "messages.create", () =>
    fetch(`${MIXMAX_API_BASE}/messages`, {
      method: "POST",
      headers: {
        "X-API-Token": token,
        "Content-Type": "application/json",
      },
      cache: "no-store",
      body: JSON.stringify({
        to: [{ email: to }],
        subject: params.subject,
        body: params.body.trim() || "<p></p>",
        attachments: params.attachments,
        userHasModified: true,
        trackingEnabled: false,
        linkTrackingEnabled: false,
        fileTrackingEnabled: false,
        notificationsEnabled: false,
      }),
    })
  );

  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { message?: string };
    throw new Error(err.message ?? `Mixmax draft create failed (${res.status})`);
  }

  const data = (await res.json()) as { _id?: string };
  if (!data._id) {
    throw new Error("Mixmax did not return a draft message id");
  }
  return { messageId: data._id };
}
