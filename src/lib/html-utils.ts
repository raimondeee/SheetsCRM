/** Convert Mixmax / draft HTML to plain text for MIME text/plain and clipboard export. */
export function stripHtmlToText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/h[1-6]>/gi, "\n\n")
    .replace(/<\/p>/gi, "\n\n")
    // Draft spacing is CSS margin between blocks; treat block ends as paragraph breaks.
    .replace(/<\/div>/gi, "\n\n")
    .replace(/<li[^>]*>/gi, "• ")
    .replace(/<\/li>/gi, "\n")
    .replace(/<\/(ul|ol)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#39;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function plainTextToHtml(text: string): string {
  return escapeHtml(text).replace(/\n/g, "<br>");
}

export function isRichTextEmpty(html: string): boolean {
  return stripHtmlToText(html).trim().length === 0;
}

export function looksLikeHtml(text: string): boolean {
  return /<[a-z][\s\S]*>/i.test(text.trim());
}

const EMPTY_BLOCK =
  /<(p|div)(\s[^>]*)?>(?:\s|&nbsp;|\u00a0|<br\s*\/?>)*<\/\1>/gi;

function blockInnerIsEmpty(inner: string): boolean {
  const text = inner
    .replace(/<br\s*\/?>/gi, "")
    .replace(/&nbsp;|\u00a0/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<[^>]+>/g, "")
    .trim();
  return text.length === 0;
}

function normalizeDraftBlock(
  _match: string,
  open: string,
  tag: string,
  attrs: string,
  inner: string,
  close: string
): string {
  const trimmed = inner.replace(/(<br\s*\/?>\s*)+$/gi, "");
  if (blockInnerIsEmpty(trimmed)) return "";
  return `${open}${trimmed}${close}`;
}

/** Mixmax and paste often insert empty block spacers; block margins already separate paragraphs. */
export function compactDraftBlockSpacing(html: string): string {
  let result = html.trim();
  if (!result) return "";

  const blockPattern = /(<(p|div)(\s[^>]*)?>)([\s\S]*?)(<\/\2>)/gi;

  let prev = "";
  while (result !== prev) {
    prev = result;
    result = result
      .replace(blockPattern, normalizeDraftBlock)
      .replace(EMPTY_BLOCK, "");
  }

  return result;
}

function stripBlockMarginStyles(html: string): string {
  return html.replace(/\sstyle="([^"]*)"/gi, (_match, styles: string) => {
    const cleaned = styles
      .replace(/(?:^|;\s*)margin(?:-top|-bottom|-left|-right)?\s*:[^;]*/gi, "")
      .replace(/^[\s;]+|[\s;]+$/g, "")
      .replace(/;\s*;/g, ";");
    return cleaned ? ` style="${cleaned}"` : "";
  });
}

function stripDangerousHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<head[\s\S]*?<\/head>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(
      /<\/?(?:html|body|meta|link|iframe|object|embed|form|input|button|textarea|select|base)(?:\s[^>]*)?>/gi,
      ""
    )
    .replace(/\s(on\w+)=("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/\shref\s*=\s*(["'])\s*javascript:[^"']*\1/gi, ' href="#"')
    .replace(/\ssrc\s*=\s*(["'])\s*javascript:[^"']*\1/gi, "");
}

/** Keep Mixmax template structure (lists, paragraphs, emphasis) for the rich-text editor. */
export function prepareMixmaxTemplateHtml(source: string): string {
  const trimmed = source.trim();
  if (!trimmed) return "";
  if (!looksLikeHtml(trimmed)) return plainTextToHtml(trimmed);

  return compactDraftBlockSpacing(stripBlockMarginStyles(stripDangerousHtml(trimmed).trim()));
}

/**
 * Sanitize email HTML for CRM thread storage/display.
 * Preserves lists, emphasis, links, and headings; drops scripts and chrome.
 */
export function sanitizeEmailHtml(html: string): string {
  let result = html.trim();
  if (!result) return "";
  if (!looksLikeHtml(result)) return plainTextToHtml(result);

  const bodyMatch = result.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  if (bodyMatch) result = bodyMatch[1];

  return compactDraftBlockSpacing(stripBlockMarginStyles(stripDangerousHtml(result).trim()));
}

export function normalizeDraftHtml(body: string): string {
  const trimmed = body.trim();
  if (!trimmed) return "";
  const html = looksLikeHtml(trimmed) ? trimmed : plainTextToHtml(trimmed);
  return compactDraftBlockSpacing(stripBlockMarginStyles(html));
}

/** Body text for clipboard / plain export (HTML → readable plain). */
export function threadBodyToPlainText(body: string): string {
  const trimmed = body.trim();
  if (!trimmed) return "";
  return looksLikeHtml(trimmed) ? stripHtmlToText(trimmed) : trimmed;
}
