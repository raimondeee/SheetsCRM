import { isGmailApiThreadId } from "./gmail-urls";

/** Build Gmail API search queries to locate a legacy web conversation id. */
export function buildLegacySearchQueries(
  legacyWebId: string,
  searchHint?: string | null
): string[] {
  const legacy = legacyWebId.trim();
  const hint = searchHint?.trim();
  const queries = [
    legacy,
    `"${legacy}"`,
    legacy.replace(/^FMfcgz/, ""),
    `"${legacy.replace(/^FMfcgz/, "")}"`,
  ];

  if (hint) {
    queries.push(`${hint} ${legacy}`, `"${hint}" ${legacy}`, `${hint} "${legacy}"`);
  }

  return [...new Set(queries.filter(Boolean))];
}

/** Try to derive Gmail API thread ids embedded in a legacy web id (FMfcgz…). */
export function decodeGmailWebConversationIdCandidates(webId: string): string[] {
  const trimmed = webId.trim();
  const candidates = new Set<string>();

  const inputs = [trimmed, trimmed.replace(/^FMfcgz/, ""), trimmed.replace(/^msg-f:/, "")];

  for (const input of inputs) {
    if (!input) continue;

    if (isGmailApiThreadId(input)) {
      candidates.add(input.toLowerCase());
    }

    for (const encoding of ["base64url", "base64"] as const) {
      try {
        const normalized =
          encoding === "base64"
            ? input.replace(/-/g, "+").replace(/_/g, "/")
            : input;
        const buf = Buffer.from(normalized, encoding);
        collectHexCandidatesFromBuffer(buf, candidates);
      } catch {
        /* not valid base64 */
      }
    }
  }

  return [...candidates].slice(0, 12);
}

function collectHexCandidatesFromBuffer(buf: Buffer, candidates: Set<string>): void {
  const hex = buf.toString("hex");
  if (isGmailApiThreadId(hex)) {
    candidates.add(hex.toLowerCase());
  }

  for (const byteLen of [16]) {
    const hexLen = byteLen * 2;
    for (let offset = 0; offset + hexLen <= hex.length; offset += 4) {
      const slice = hex.slice(offset, offset + hexLen);
      if (isGmailApiThreadId(slice)) {
        candidates.add(slice.toLowerCase());
      }
    }
  }
}

export function isExplicitSearchThreadUrl(input: string): boolean {
  const trimmed = input.trim();
  if (!trimmed.includes("#search/")) return false;
  const segments = trimmed.match(GMAIL_HASH_LABEL)?.[1]?.split("/").filter(Boolean) ?? [];
  return segments.length >= 2;
}

const GMAIL_HASH_LABEL =
  /#(?:inbox|all|sent|starred|search|drafts|important|spam|trash)\/(.+)$/i;
