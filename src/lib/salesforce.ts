const DEFAULT_BASE =
  "https://airbnbnimbus.my.salesforce.com/_ui/search/ui/UnifiedSearchResults";

const DEFAULT_CLAIM_SEARCH_BASE =
  "https://airbnbcare.my.salesforce.com/_ui/search/ui/UnifiedSearchResults";

export function getSalesforceSearchBaseUrl(): string {
  return (
    process.env.NEXT_PUBLIC_SALESFORCE_SEARCH_BASE_URL ??
    process.env.SALESFORCE_SEARCH_BASE_URL ??
    DEFAULT_BASE
  );
}

export function getClaimSalesforceSearchBaseUrl(): string {
  return (
    process.env.NEXT_PUBLIC_CLAIM_SALESFORCE_SEARCH_BASE_URL ??
    process.env.CLAIM_SALESFORCE_SEARCH_BASE_URL ??
    DEFAULT_CLAIM_SEARCH_BASE
  );
}

/** Unified search URL — manual sidebar User ID, else intake form header field. */
export function buildSalesforceUnifiedSearchUrl(query: string): string | null {
  const trimmed = query.trim();
  if (!trimmed) return null;

  const base = getSalesforceSearchBaseUrl().replace(/\?.*$/, "").replace(/#!.*$/, "");
  return `${base}?str=${encodeURIComponent(trimmed)}`;
}

/** Airbnb Care Salesforce search for a claim number (e.g. CLSF-06100223). */
export function buildClaimSalesforceSearchUrl(claimNumber: string): string | null {
  const trimmed = claimNumber.trim();
  if (!trimmed) return null;

  const base = getClaimSalesforceSearchBaseUrl().replace(/\?.*$/, "").replace(/#!.*$/, "");
  return `${base}#!/str=${encodeURIComponent(trimmed)}&initialViewMode=summary`;
}
