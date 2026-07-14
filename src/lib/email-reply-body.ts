/**
 * Keep only the new reply text from a plain-text email body (drop quoted thread below).
 */
export function stripQuotedReplyPlainText(body: string): string {
  let text = body.replace(/\r\n/g, "\n").trim();
  if (!text) return text;

  const blockSeparators = [
    /\nOn .{10,800} wrote:\s*\n/i,
    /\n-{2,}\s*Original Message\s*-{2,}\s*\n/i,
    /\n_{5,}\s*\n/,
    /\nFrom:\s.+\nSent:\s.+\nTo:\s/im,
    /\n-{2,}\s*Forwarded message\s*-{2,}\s*\n/i,
  ];

  for (const pattern of blockSeparators) {
    const match = text.match(pattern);
    if (match?.index !== undefined && match.index > 0) {
      text = text.slice(0, match.index).trim();
    }
  }

  const lines = text.split("\n");
  const kept: string[] = [];
  for (const line of lines) {
    if (/^>/.test(line)) break;
    if (/^On .+ wrote:\s*$/i.test(line.trim())) break;
    kept.push(line);
  }

  const trimmed = kept.join("\n").trim();
  return trimmed || body.trim();
}

/**
 * Drop Gmail / client quoted history from HTML reply bodies.
 * Falls back to the original HTML if stripping would empty the message.
 */
export function stripQuotedReplyHtml(html: string): string {
  const original = html.trim();
  if (!original) return original;

  let result = original
    .replace(/<div[^>]*class="[^"]*\bgmail_quote\b[^"]*"[^>]*>[\s\S]*$/i, "")
    .replace(/<div[^>]*class='[^']*\bgmail_quote\b[^']*'[^>]*>[\s\S]*$/i, "")
    .replace(/<blockquote[^>]*type=["']?cite["']?[^>]*>[\s\S]*$/i, "")
    .replace(/<div[^>]*class="[^"]*\bgmail_extra\b[^"]*"[^>]*>[\s\S]*$/i, "")
    .replace(/<div[^>]*class='[^']*\bgmail_extra\b[^']*'[^>]*>[\s\S]*$/i, "")
    .replace(/<hr[^>]*(?:name|id)=["']?reply-marker["']?[^>]*>[\s\S]*$/i, "")
    .replace(
      /<(?:div|p)[^>]*>\s*(?:<br\s*\/?>\s*)*On [\s\S]{10,800}? wrote:\s*(?:<br\s*\/?>)?\s*<\/(?:div|p)>\s*$/i,
      ""
    )
    .trim();

  // If quote markers left trailing "On … wrote:" with nothing after, trim it.
  result = result
    .replace(
      /<(?:div|p)[^>]*>\s*(?:<br\s*\/?>\s*)*On [\s\S]{10,800}? wrote:\s*(?:<br\s*\/?>)?\s*<\/(?:div|p)>\s*$/i,
      ""
    )
    .trim();

  if (!result || !result.replace(/<[^>]+>/g, "").replace(/&nbsp;|\u00a0/gi, " ").trim()) {
    return original;
  }
  return result;
}
