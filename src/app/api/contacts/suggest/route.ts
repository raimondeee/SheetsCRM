import { NextResponse } from "next/server";
import {
  filterMarketManagerSuggestions,
  parseRecipientList,
} from "@/lib/email-recipients";
import { searchGoogleRecipientSuggestions } from "@/lib/google-people";
import { getSignedInUser, hasActiveGoogleAuth } from "@/lib/google-auth";
import {
  mergeRecipientSuggestions,
  type RecipientSuggestion,
} from "@/lib/recipient-suggestions";
import { loadMarketManagerDirectory } from "@/lib/market-managers-store";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function marketManagerSuggestions(query: string, limit: number): RecipientSuggestion[] {
  const directory = loadMarketManagerDirectory();
  return filterMarketManagerSuggestions(
    directory.managers,
    query,
    query.length,
    limit
  ).map((manager) => ({
    name: manager.name,
    email: manager.email,
    source: "market_manager" as const,
  }));
}

export async function GET(request: Request) {
  const user = await getSignedInUser();
  if (!user.email && !(await hasActiveGoogleAuth())) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const url = new URL(request.url);
  const query = url.searchParams.get("q")?.trim() ?? "";
  const exclude = parseRecipientList(url.searchParams.get("exclude") ?? "");
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? "10"), 1), 20);

  const localSuggestions = marketManagerSuggestions(query, limit);
  if (!query) {
    return NextResponse.json({
      suggestions: mergeRecipientSuggestions([localSuggestions], {
        excludeEmails: exclude,
        limit,
      }),
    });
  }

  const google = await searchGoogleRecipientSuggestions(query, limit);
  const suggestions = mergeRecipientSuggestions(
    [localSuggestions, google.suggestions],
    { excludeEmails: exclude, limit }
  );

  return NextResponse.json(
    {
      suggestions,
      warning: google.warnings[0] ?? null,
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
