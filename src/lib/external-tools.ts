export interface ExternalToolLink {
  label: string;
  url: string;
}

export const EXTERNAL_TOOL_SLOT_COUNT = 6;

export function defaultExternalTools(): ExternalToolLink[] {
  return Array.from({ length: EXTERNAL_TOOL_SLOT_COUNT }, () => ({
    label: "",
    url: "",
  }));
}

export function normalizeExternalTools(value: unknown): ExternalToolLink[] {
  const slots = defaultExternalTools();
  if (!Array.isArray(value)) return slots;

  for (let i = 0; i < EXTERNAL_TOOL_SLOT_COUNT; i++) {
    const entry = value[i];
    if (!entry || typeof entry !== "object") continue;
    const row = entry as Partial<ExternalToolLink>;
    slots[i] = {
      label: typeof row.label === "string" ? row.label : "",
      url: typeof row.url === "string" ? row.url : "",
    };
  }
  return slots;
}

export function externalToolHref(url: string): string | null {
  const trimmed = url.trim();
  if (!trimmed) return null;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

export function activeExternalTools(tools: ExternalToolLink[]): Array<ExternalToolLink & { href: string }> {
  return tools
    .map((tool) => {
      const href = externalToolHref(tool.url);
      if (!href) return null;
      const label = tool.label.trim() || href.replace(/^https?:\/\//i, "");
      return { label, url: tool.url.trim(), href };
    })
    .filter((tool): tool is ExternalToolLink & { href: string } => tool !== null);
}
