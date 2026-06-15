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
