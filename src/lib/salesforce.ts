const DEFAULT_BASE =
  "https://airbnbnimbus.my.salesforce.com/_ui/search/ui/UnifiedSearchResults";

export function getSalesforceSearchBaseUrl(): string {
  return (
    process.env.NEXT_PUBLIC_SALESFORCE_SEARCH_BASE_URL ??
    process.env.SALESFORCE_SEARCH_BASE_URL ??
    DEFAULT_BASE
  );
}

/** Mirrors Google Sheets ENCODEURL — handles +, @, and other special characters in emails. */
export function buildSalesforceUnifiedSearchUrl(email: string): string | null {
  const trimmed = email.trim();
  if (!trimmed) return null;

  const base = getSalesforceSearchBaseUrl().replace(/\?.*$/, "");
  return `${base}?str=${encodeURIComponent(trimmed)}`;
}
