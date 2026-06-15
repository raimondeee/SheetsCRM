export interface ParsedLinkedCase {
  label: string;
  url: string | null;
}

export function resolveExternalHref(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (/^www\./i.test(trimmed)) return `https://${trimmed}`;
  return null;
}

function shortLabelForUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.hostname.replace(/^www\./, "") || url;
  } catch {
    return url.length > 48 ? `${url.slice(0, 48)}…` : url;
  }
}

/** Parse stored linked case value (label\\nurl or legacy URL-only). */
export function parseLinkedCase(stored: string): ParsedLinkedCase {
  const trimmed = stored.trim();
  if (!trimmed) return { label: "", url: null };

  const newlineMatch = trimmed.match(/\r?\n/);
  if (newlineMatch && newlineMatch.index != null) {
    const label = trimmed.slice(0, newlineMatch.index).trim();
    const urlText = trimmed.slice(newlineMatch.index + newlineMatch[0].length).trim();
    const url = resolveExternalHref(urlText);
    return {
      label: label || (url ? shortLabelForUrl(url) : urlText),
      url,
    };
  }

  const url = resolveExternalHref(trimmed);
  if (url) {
    return { label: shortLabelForUrl(url), url };
  }

  return { label: trimmed, url: null };
}

/** Text shown in the edit textarea. */
export function formatLinkedCaseForEdit(stored: string): string {
  const trimmed = stored.trim();
  if (!trimmed) return "";

  const parsed = parseLinkedCase(trimmed);
  if (!parsed.url) return parsed.label;
  if (!parsed.label || parsed.label === shortLabelForUrl(parsed.url)) {
    return parsed.url;
  }
  return `${parsed.label}\n${parsed.url}`;
}

/** Serialize textarea draft for overlay storage. */
export function serializeLinkedCaseFromDraft(draft: string): string {
  const lines = draft
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length === 0) return "";
  if (lines.length === 1) {
    const only = lines[0];
    return resolveExternalHref(only) ? only : only;
  }

  const label = lines[0];
  const urlText = lines.slice(1).join(" ").trim();
  const url = resolveExternalHref(urlText);
  if (!url) return draft.trim();
  return `${label}\n${url}`;
}
