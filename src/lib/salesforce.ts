const DEFAULT_BASE =
  "https://airbnbnimbus.my.salesforce.com/_ui/search/ui/UnifiedSearchResults";

export function getSalesforceSearchBaseUrl(): string {
  return (
    process.env.NEXT_PUBLIC_SALESFORCE_SEARCH_BASE_URL ??
    process.env.SALESFORCE_SEARCH_BASE_URL ??
    DEFAULT_BASE
  );
}

/** Unified search URL — query is typically the value from sheet Column D. */
export function buildSalesforceUnifiedSearchUrl(query: string): string | null {
  const trimmed = query.trim();
  if (!trimmed) return null;

  const base = getSalesforceSearchBaseUrl().replace(/\?.*$/, "");
  return `${base}?str=${encodeURIComponent(trimmed)}`;
}
