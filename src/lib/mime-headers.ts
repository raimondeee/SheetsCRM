const UTF8_BASE64_PREFIX = "=?UTF-8?B?";
const UTF8_BASE64_SUFFIX = "?=";
/** Max length of an encoded-word line per RFC 2047. */
const MAX_ENCODED_LINE = 75;

function isAsciiOnly(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    if (value.charCodeAt(i) > 127) return false;
  }
  return true;
}

/**
 * RFC 2047 encoded-word for non-ASCII email header values (Subject, etc.).
 * ASCII-only values are returned unchanged.
 */
export function encodeMimeHeaderValue(value: string): string {
  const trimmed = value.trim();
  if (!trimmed || isAsciiOnly(trimmed)) return trimmed;

  const base64 = Buffer.from(trimmed, "utf8").toString("base64");
  const maxChunk =
    MAX_ENCODED_LINE - UTF8_BASE64_PREFIX.length - UTF8_BASE64_SUFFIX.length;

  if (base64.length <= maxChunk) {
    return `${UTF8_BASE64_PREFIX}${base64}${UTF8_BASE64_SUFFIX}`;
  }

  const words: string[] = [];
  for (let i = 0; i < base64.length; i += maxChunk) {
    words.push(
      `${UTF8_BASE64_PREFIX}${base64.slice(i, i + maxChunk)}${UTF8_BASE64_SUFFIX}`
    );
  }
  return words.join("\r\n ");
}
