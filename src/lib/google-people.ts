import { google } from "googleapis";
import type { people_v1 } from "googleapis";
import { getGoogleAuthClient } from "./google-auth";
import type { RecipientSuggestion, RecipientSuggestionSource } from "./recipient-suggestions";

const READ_MASK = "names,emailAddresses";
const DIRECTORY_SOURCES = [
  "DIRECTORY_SOURCE_TYPE_DOMAIN_PROFILE",
  "DIRECTORY_SOURCE_TYPE_DOMAIN_CONTACT",
] as const;

function peopleApiError(message: string): string {
  if (/insufficient.*scope|invalid.*scope|auth.*scope|ACCESS_TOKEN_SCOPE_INSUFFICIENT/i.test(message)) {
    return "contacts_scope_required";
  }
  if (/accessNotConfigured|has not been used|enable.*API|people\.googleapis\.com/i.test(message)) {
    return "people_api_disabled";
  }
  if (/403|permission|forbidden|not authorized|domain.*directory/i.test(message)) {
    return "contacts_permission_denied";
  }
  return message;
}

function personToSuggestion(
  person: people_v1.Schema$Person | null | undefined,
  source: RecipientSuggestionSource
): RecipientSuggestion | null {
  if (!person) return null;

  const email = person.emailAddresses
    ?.map((entry) => entry.value?.trim())
    .find((value): value is string => Boolean(value));
  if (!email) return null;

  const name =
    person.names
      ?.map((entry) => entry.displayName?.trim() || entry.unstructuredName?.trim())
      .find((value): value is string => Boolean(value)) ?? email;

  return { name, email, source };
}

function dedupeSuggestions(suggestions: RecipientSuggestion[]): RecipientSuggestion[] {
  const seen = new Set<string>();
  const results: RecipientSuggestion[] = [];
  for (const suggestion of suggestions) {
    const normalized = suggestion.email.toLowerCase();
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    results.push(suggestion);
  }
  return results;
}

export async function searchGoogleRecipientSuggestions(
  query: string,
  limit = 10
): Promise<{
  suggestions: RecipientSuggestion[];
  warnings: string[];
}> {
  const trimmed = query.trim();
  if (!trimmed) {
    return { suggestions: [], warnings: [] };
  }

  const auth = await getGoogleAuthClient();
  if (!auth) {
    return { suggestions: [], warnings: ["contacts_auth_required"] };
  }

  const people = google.people({ version: "v1", auth });
  const pageSize = Math.min(Math.max(limit, 1), 30);
  const warnings: string[] = [];
  const collected: RecipientSuggestion[] = [];

  const tasks: Array<{
    source: RecipientSuggestionSource;
    run: () => Promise<RecipientSuggestion[]>;
  }> = [
    {
      source: "directory",
      run: async () => {
        const res = await people.people.searchDirectoryPeople({
          query: trimmed,
          readMask: READ_MASK,
          sources: [...DIRECTORY_SOURCES],
          pageSize,
        });
        return (res.data.people ?? [])
          .map((person) => personToSuggestion(person, "directory"))
          .filter((item): item is RecipientSuggestion => item !== null);
      },
    },
    {
      source: "contact",
      run: async () => {
        const res = await people.people.searchContacts({
          query: trimmed,
          readMask: READ_MASK,
          pageSize,
        });
        return (res.data.results ?? [])
          .map((result) => personToSuggestion(result.person, "contact"))
          .filter((item): item is RecipientSuggestion => item !== null);
      },
    },
    {
      source: "other_contact",
      run: async () => {
        const res = await people.otherContacts.search({
          query: trimmed,
          readMask: READ_MASK,
          pageSize,
        });
        return (res.data.results ?? [])
          .map((result) => personToSuggestion(result.person, "other_contact"))
          .filter((item): item is RecipientSuggestion => item !== null);
      },
    },
  ];

  for (const task of tasks) {
    try {
      const results = await task.run();
      collected.push(...results);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      warnings.push(peopleApiError(message));
    }
  }

  const priority: Record<RecipientSuggestionSource, number> = {
    directory: 0,
    contact: 1,
    other_contact: 2,
    market_manager: 3,
  };

  const suggestions = dedupeSuggestions(collected)
    .sort((a, b) => priority[a.source] - priority[b.source])
    .slice(0, limit);

  return { suggestions, warnings: [...new Set(warnings)] };
}
