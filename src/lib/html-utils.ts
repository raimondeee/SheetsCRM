/** Convert Mixmax template HTML to plain text for the CRM reply box / Gmail compose body. */
export function stripHtmlToText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#39;/gi, "'")
    .replace(/&quot;/gi, '"')
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

/** Keep Mixmax template structure (lists, paragraphs, emphasis) for the rich-text editor. */
export function prepareMixmaxTemplateHtml(source: string): string {
  const trimmed = source.trim();
  if (!trimmed) return "";
  if (!looksLikeHtml(trimmed)) return plainTextToHtml(trimmed);

  return trimmed
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/\s(on\w+)=("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .trim();
}

export function normalizeDraftHtml(body: string): string {
  const trimmed = body.trim();
  if (!trimmed) return "";
  return looksLikeHtml(trimmed) ? trimmed : plainTextToHtml(trimmed);
}
