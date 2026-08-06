/**
 * Decode common HTML entities to characters.
 * Ampersand entities are expanded first so double-encoded values like
 * `&amp;nbsp;` become a real non-breaking space instead of surviving as text.
 */
export function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/gi, "&")
    .replace(/&nbsp;/gi, "\u00a0")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#(\d+);/g, (match, code: string) => {
      const n = Number(code);
      if (!Number.isFinite(n) || n < 0 || n > 0x10ffff) return match;
      try {
        return String.fromCodePoint(n);
      } catch {
        return match;
      }
    })
    .replace(/&#x([0-9a-f]+);/gi, (match, hex: string) => {
      const n = Number.parseInt(hex, 16);
      if (!Number.isFinite(n) || n < 0 || n > 0x10ffff) return match;
      try {
        return String.fromCodePoint(n);
      } catch {
        return match;
      }
    });
}

/** Convert Mixmax / draft HTML to plain text for MIME text/plain and clipboard export. */
export function stripHtmlToText(html: string): string {
  return decodeHtmlEntities(
    html
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/h[1-6]>/gi, "\n\n")
      .replace(/<\/p>/gi, "\n\n")
      // Draft spacing is CSS margin between blocks; treat block ends as paragraph breaks.
      .replace(/<\/div>/gi, "\n\n")
      .replace(/<li[^>]*>/gi, "• ")
      .replace(/<\/li>/gi, "\n")
      .replace(/<\/(ul|ol)>/gi, "\n")
      .replace(/<[^>]+>/g, "")
  )
    .replace(/\u00a0/g, " ")
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
  // contentEditable often serializes spaces as `&nbsp;` with no tags; decode first
  // so escapeHtml does not turn them into visible `&amp;nbsp;`.
  return escapeHtml(decodeHtmlEntities(text)).replace(/\n/g, "<br>");
}

export function isRichTextEmpty(html: string): boolean {
  return stripHtmlToText(html).trim().length === 0;
}

export function looksLikeHtml(text: string): boolean {
  const trimmed = text.trim();
  // Tags, or entity-only fragments from contentEditable (`text.&nbsp;` with no tags).
  return /<[a-z][\s\S]*>/i.test(trimmed) || /&(?:[a-z]+|#\d+|#x[0-9a-f]+);/i.test(trimmed);
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

/**
 * Collapse only truly empty blocks. Keep `<div><br></div>` / `<p><br></p>` so Gmail/Docs
 * blank lines survive into the editor (compactDraftBlockSpacing would remove them).
 */
function compactEmptyChromeBlocks(html: string): string {
  return html
    .replace(/<(p|div)(\s[^>]*)?>(?:\s|&nbsp;|\u00a0)*<\/\1>/gi, "")
    .replace(/(<(?:p|div)(?:\s[^>]*)?>(?:\s|&nbsp;|\u00a0|<br\s*\/?>)*<\/(?:p|div)>\s*){3,}/gi, (m) => {
      const block = m.match(/<(p|div)\b/i)?.[1]?.toLowerCase() === "p" ? "p" : "div";
      return `<${block}><br></${block}><${block}><br></${block}>`;
    });
}

type StyleCleanMode = "background" | "background-and-margins";

const BACKGROUND_STYLE_PROPS =
  /(?:^|;\s*)(?:background(?:-color|-image|-repeat|-position|-size|-attachment|-clip|-origin)?|bgcolor)\s*:[^;]*/gi;

const MARGIN_STYLE_PROPS =
  /(?:^|;\s*)margin(?:-top|-bottom|-left|-right)?\s*:[^;]*/gi;

function cleanInlineStyleAttribute(styles: string, mode: StyleCleanMode): string {
  let cleaned = styles.replace(BACKGROUND_STYLE_PROPS, "");
  if (mode === "background-and-margins") {
    cleaned = cleaned.replace(MARGIN_STYLE_PROPS, "");
  }
  return cleaned.replace(/^[\s;]+|[\s;]+$/g, "").replace(/;\s*;/g, ";");
}

function stripEditorChromeStyles(html: string, mode: StyleCleanMode = "background"): string {
  return html
    .replace(/\sstyle=("([^"]*)"|'([^']*)')/gi, (_match, _quoted: string, doubleStyles?: string, singleStyles?: string) => {
      // Drop explicit normal weight so it cannot override parent <strong>/<b>.
      const withoutNormalWeight = (doubleStyles ?? singleStyles ?? "").replace(
        /(?:^|;\s*)font-weight\s*:\s*(normal|400)\b[^;]*/gi,
        ""
      );
      const cleaned = cleanInlineStyleAttribute(withoutNormalWeight, mode);
      return cleaned ? ` style="${cleaned}"` : "";
    })
    .replace(/\sbgcolor\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "");
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

/** Force anchors in email HTML to open in a new tab (CRM thread display). */
export function forceLinksOpenInNewTab(html: string): string {
  return html.replace(/<a\b([^>]*)>/gi, (_match, attrs: string) => {
    const cleaned = attrs
      .replace(/\starget\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
      .replace(/\srel\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "");
    return `<a${cleaned} target="_blank" rel="noopener noreferrer">`;
  });
}

/** Google Docs wraps the clipboard payload in `<b style="font-weight:normal">…</b>`. */
function unwrapDocsClipboardRoot(html: string): string {
  return html
    .replace(
      /^(\s*)<b\b([^>]*)style=("([^"]*)"|'([^']*)')([^>]*)>([\s\S]*)<\/b>(\s*)$/i,
      (full, lead: string, before: string, _q: string, doubleStyles: string | undefined, singleStyles: string | undefined, after: string, inner: string, trail: string) => {
        const styles = doubleStyles ?? singleStyles ?? "";
        const isNormalWeight = /font-weight\s*:\s*(normal|400)\b/i.test(styles);
        const isDocsGuid = /\bid\s*=\s*["']docs-internal-guid-/i.test(`${before}${after}`);
        if (!isNormalWeight && !isDocsGuid) return full;
        return `${lead}${inner}${trail}`;
      }
    )
    .replace(
      /^(\s*)<b\b([^>]*)\bid\s*=\s*["']docs-internal-guid-[^"']*["']([^>]*)>([\s\S]*)<\/b>(\s*)$/i,
      "$1$4$5"
    );
}

function styleHasBold(styles: string): boolean {
  return /font-weight\s*:\s*(bold|[6-9]00)\b/i.test(styles);
}

function styleHasItalic(styles: string): boolean {
  return /font-style\s*:\s*italic\b/i.test(styles);
}

function styleHasUnderline(styles: string): boolean {
  return /text-decoration(?:-line)?\s*:\s*[^;]*underline/i.test(styles);
}

function stripEmphasisFromStyles(styles: string): string {
  return styles
    .replace(/(?:^|;\s*)font-weight\s*:[^;]*/gi, "")
    .replace(/(?:^|;\s*)font-style\s*:[^;]*/gi, "")
    .replace(/(?:^|;\s*)text-decoration(?:-line)?\s*:[^;]*/gi, "")
    .replace(/^[\s;]+|[\s;]+$/g, "")
    .replace(/;\s*;/g, ";");
}

/**
 * Promote inline emphasis styles to semantic tags so contentEditable/Chrome
 * reliably shows bold/italic/underline after Docs/Gmail paste.
 * Only rewrites leaf spans/fonts (no nested tags), repeated until stable.
 */
function promoteInlineEmphasisStyles(html: string): string {
  let result = html;
  for (let i = 0; i < 8; i++) {
    const next = result.replace(
      /<(span|font)(\s[^>]*?)style=("([^"]*)"|'([^']*)')([^>]*)>([^<]*)<\/\1>/gi,
      (full, tag: string, before: string, _q: string, doubleStyles: string | undefined, singleStyles: string | undefined, after: string, inner: string) => {
        const styles = doubleStyles ?? singleStyles ?? "";
        const bold = styleHasBold(styles);
        const italic = styleHasItalic(styles);
        const underline = styleHasUnderline(styles);
        if (!bold && !italic && !underline) return full;

        const remaining = stripEmphasisFromStyles(styles);
        const attrs = `${before}${remaining ? ` style="${remaining}"` : ""}${after}`.replace(
          /\s+/g,
          " "
        );
        let wrapped = remaining || before.trim() || after.trim() ? `<${tag}${attrs}>${inner}</${tag}>` : inner;
        if (underline) wrapped = `<u>${wrapped}</u>`;
        if (italic) wrapped = `<em>${wrapped}</em>`;
        if (bold) wrapped = `<strong>${wrapped}</strong>`;
        return wrapped;
      }
    );
    if (next === result) break;
    result = next;
  }
  return result;
}

function extractBodyHtml(html: string): string {
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  return bodyMatch ? bodyMatch[1] : html;
}

/** Keep Mixmax template structure (lists, paragraphs, emphasis) for the rich-text editor. */
export function prepareMixmaxTemplateHtml(source: string): string {
  const trimmed = source.trim();
  if (!trimmed) return "";
  if (!looksLikeHtml(trimmed)) return plainTextToHtml(trimmed);

  return compactDraftBlockSpacing(
    stripEditorChromeStyles(stripDangerousHtml(trimmed).trim(), "background-and-margins")
  );
}

/**
 * Collapse double-encoded non-breaking spaces (`&amp;nbsp;`, `&amp;amp;nbsp;`, …)
 * that can appear after plain-text escaping of contentEditable entity output.
 */
export function repairDoubleEncodedNbsp(html: string): string {
  return html.replace(/&amp;(?:amp;)*nbsp;/gi, "&nbsp;");
}

/**
 * Sanitize email HTML for CRM thread storage/display.
 * Preserves lists, emphasis, links, and headings; drops scripts and chrome.
 */
export function sanitizeEmailHtml(html: string): string {
  let result = html.trim();
  if (!result) return "";
  if (!looksLikeHtml(result)) return plainTextToHtml(result);

  result = repairDoubleEncodedNbsp(extractBodyHtml(result));

  return forceLinksOpenInNewTab(
    compactDraftBlockSpacing(
      stripEditorChromeStyles(stripDangerousHtml(result).trim(), "background")
    )
  );
}

/** Sanitize HTML pasted into the draft composer (Docs/Gmail → editor). */
export function sanitizeDraftPasteHtml(html: string): string {
  let result = html.trim();
  if (!result) return "";
  if (!looksLikeHtml(result)) return plainTextToHtml(result);

  result = extractBodyHtml(result);
  result = stripDangerousHtml(result).trim();
  result = unwrapDocsClipboardRoot(result);
  result = stripEditorChromeStyles(result, "background");
  result = promoteInlineEmphasisStyles(result);
  result = compactEmptyChromeBlocks(result);
  return result.trim();
}

export function normalizeDraftHtml(body: string): string {
  const trimmed = body.trim();
  if (!trimmed) return "";
  const html = looksLikeHtml(trimmed)
    ? repairDoubleEncodedNbsp(trimmed)
    : plainTextToHtml(trimmed);
  // Preserve intentional blank lines and emphasis; only drop pasted backgrounds.
  return compactEmptyChromeBlocks(stripEditorChromeStyles(html, "background")).trim();
}

/** Body text for clipboard / plain export (HTML → readable plain). */
export function threadBodyToPlainText(body: string): string {
  const trimmed = body.trim();
  if (!trimmed) return "";
  return looksLikeHtml(trimmed) ? stripHtmlToText(trimmed) : trimmed;
}
