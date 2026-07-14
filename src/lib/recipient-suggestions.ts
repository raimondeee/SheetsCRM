export type RecipientSuggestionSource =
  | "market_manager"
  | "directory"
  | "contact"
  | "other_contact";

export interface RecipientSuggestion {
  name: string;
  email: string;
  source: RecipientSuggestionSource;
}

export function recipientSuggestionSourceLabel(
  source: RecipientSuggestionSource
): string | null {
  switch (source) {
    case "market_manager":
      return "MM";
    case "directory":
      return "Workspace";
    case "contact":
      return "Contact";
    case "other_contact":
      return "Other";
    default:
      return null;
  }
}

export function mergeRecipientSuggestions(
  groups: RecipientSuggestion[][],
  options: { excludeEmails?: Iterable<string>; limit?: number } = {}
): RecipientSuggestion[] {
  const limit = options.limit ?? 10;
  const excluded = new Set<string>();
  for (const email of options.excludeEmails ?? []) {
    const normalized = email.trim().toLowerCase();
    if (normalized) excluded.add(normalized);
  }

  const merged: RecipientSuggestion[] = [];
  const seen = new Set<string>();

  for (const group of groups) {
    for (const suggestion of group) {
      const email = suggestion.email.trim();
      const normalized = email.toLowerCase();
      if (!normalized || excluded.has(normalized) || seen.has(normalized)) continue;
      seen.add(normalized);
      merged.push({
        name: suggestion.name.trim() || email,
        email,
        source: suggestion.source,
      });
      if (merged.length >= limit) return merged;
    }
  }

  return merged;
}
