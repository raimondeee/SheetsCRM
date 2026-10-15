/**
 * Turn a follow-up into a real reply for the recipient's mail client.
 *
 * Gmail's thread id only groups mail in the sending account. Outlook and
 * other clients follow In-Reply-To, References, and the quoted message.
 */
import { randomBytes } from "crypto";
import { escapeHtml, plainTextToHtml } from "./html-utils";
import { encodeMimeHeaderValue } from "./mime-headers";

const REPLY_PREFIX = /^(re|fw|fwd)\s*:\s*/i;
const DC0_SHIFT = BigInt(18);
const DC1_SHIFT = BigInt(23);
const ZERO = BigInt(0);
const ONE = BigInt(1);
const EIGHT = BigInt(8);
const SIXTEEN = BigInt(16);
const THIRTY_ONE = BigInt(31);
const FORTY_NINE = BigInt(49);
const BYTE = BigInt(255);
const MASK_31 = BigInt("0x7fffffff");
const MASK_16 = BigInt("0xffff");
const FILETIME_EPOCH_OFFSET_MS = BigInt("11644473600000");
const FILETIME_PER_MS = BigInt(10000);
/** Quote cap so a long thread cannot blow past Gmail's send size limit. */
const MAX_QUOTE_CHARS = 200_000;

export function stripReplySubjectPrefixes(subject: string): string {
  let value = subject.replace(/[\r\n]+/g, " ").trim();
  let previous = "";
  while (value && value !== previous) {
    previous = value;
    value = value.replace(REPLY_PREFIX, "").trim();
  }
  return value;
}

/** One `Re:` plus the thread subject, which is what Gmail requires to stay on the thread. */
export function replySubjectForThread(parentSubject: string): string {
  const cleaned = parentSubject.replace(/[\r\n]+/g, " ").trim();
  const base = stripReplySubjectPrefixes(cleaned);
  if (!base) return cleaned;
  return `Re: ${base}`;
}

export function formatReplyAttributionDate(dateHeader: string): string {
  const parsed = new Date(dateHeader);
  if (Number.isNaN(parsed.getTime())) {
    return dateHeader.replace(/[\r\n]+/g, " ").trim();
  }
  const formatted = new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(parsed);
  return formatted.replace(/, (\d{1,2}:\d{2}\s*[AP]M)$/i, " at $1");
}

export function referenceMessageIds(messageIds: string[]): string[] {
  const unique: string[] = [];
  for (const id of messageIds) {
    if (!unique.includes(id)) unique.push(id);
  }
  if (unique.length <= 32) return unique;
  return [unique[0], ...unique.slice(-31)];
}

function foldHeaderValue(name: string, value: string): string {
  const words = value.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = `${name}:`;
  for (const word of words) {
    const next = `${current} ${word}`;
    if (next.length > 78 && current !== `${name}:`) {
      lines.push(current);
      current = ` ${word}`;
    } else {
      current = next;
    }
  }
  lines.push(current);
  return lines.join("\r\n");
}

function readBigIntBE(buf: Buffer, offset: number, length: number): bigint {
  let value = ZERO;
  for (let i = 0; i < length; i++) {
    value = (value << EIGHT) | BigInt(buf[offset + i] ?? 0);
  }
  return value;
}

/**
 * Append one Outlook conversation-index child block.
 * Returns null when the parent value is not a Thread-Index.
 */
export function childThreadIndex(parentThreadIndex: string, now = new Date()): string | null {
  const compact = parentThreadIndex.replace(/\s+/g, "");
  if (!compact || !/^[A-Za-z0-9+/]+=*$/.test(compact)) return null;
  const raw = Buffer.from(compact, "base64");
  if (raw.length < 22 || (raw.length - 22) % 5 !== 0) return null;

  let anchor = readBigIntBE(raw, 0, 6) << SIXTEEN;
  for (let offset = 22; offset + 5 <= raw.length; offset += 5) {
    const head = readBigIntBE(raw, offset, 4);
    const shift = head >> THIRTY_ONE ? DC1_SHIFT : DC0_SHIFT;
    anchor += (head & MASK_31) << shift;
  }

  const filetime = (BigInt(now.getTime()) + FILETIME_EPOCH_OFFSET_MS) * FILETIME_PER_MS;
  const masked = filetime & ~MASK_16;
  const diff = masked >= anchor ? masked - anchor : anchor - masked;
  const useFineDelta = diff < ONE << FORTY_NINE;
  const shift = useFineDelta ? DC0_SHIFT : DC1_SHIFT;
  const deltaCode = useFineDelta ? ZERO : ONE;
  const delta31 = (diff >> shift) & MASK_31;
  const randomByte = BigInt(randomBytes(1)[0] ?? 0);
  let block = ((deltaCode << THIRTY_ONE) | delta31) << EIGHT | randomByte;
  const suffix = Buffer.alloc(5);
  for (let i = 4; i >= 0; i--) {
    suffix[i] = Number(block & BYTE);
    block >>= EIGHT;
  }
  return Buffer.concat([raw, suffix]).toString("base64");
}

export function threadingHeaderLines(params: {
  inReplyTo: string;
  references: string;
  threadTopic?: string | null;
  threadIndex?: string | null;
}): string[] {
  const lines: string[] = [];
  const inReplyTo = params.inReplyTo.match(/<[^<>\s]+>/)?.[0];
  const references = (params.references.match(/<[^<>\s]+>/g) ?? []).join(" ");
  if (inReplyTo) lines.push(`In-Reply-To: ${inReplyTo}`);
  if (references) lines.push(foldHeaderValue("References", references));
  const topic = params.threadTopic?.replace(/[\r\n]+/g, " ").trim();
  if (topic) lines.push(`Thread-Topic: ${encodeMimeHeaderValue(topic)}`);
  const index = params.threadIndex?.replace(/\s+/g, "") ?? "";
  if (index && /^[A-Za-z0-9+/]+=*$/.test(index)) {
    lines.push(`Thread-Index: ${index}`);
  }
  return lines;
}

function quotePlainText(text: string): string {
  const normalized = text.replace(/\r\n/g, "\n").trim();
  if (!normalized) return "";
  return normalized
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n");
}

export function appendQuotedReply(params: {
  plain: string;
  html?: string;
  from: string;
  dateLabel: string;
  parentPlain: string;
  parentHtml: string;
}): { plain: string; html?: string } {
  const from = params.from.replace(/[\r\n]+/g, " ").trim();
  const dateLabel = params.dateLabel.replace(/[\r\n]+/g, " ").trim();
  const who = from || "the previous sender";
  const attribution = dateLabel ? `On ${dateLabel}, ${who} wrote:` : `${who} wrote:`;
  const quotedPlain = quotePlainText(params.parentPlain);
  const plain = quotedPlain ? `${params.plain}\n\n${attribution}\n${quotedPlain}` : params.plain;

  let parentHtml = params.parentHtml.trim();
  if (parentHtml.length > MAX_QUOTE_CHARS) parentHtml = "";
  if (!parentHtml && params.parentPlain.trim()) {
    const excerpt =
      params.parentPlain.length > 12_000
        ? `${params.parentPlain.slice(0, 12_000)}\n…`
        : params.parentPlain;
    parentHtml = `<div>${plainTextToHtml(excerpt)}</div>`;
  }
  if (!parentHtml) return { plain, html: params.html };

  const quoteHtml = [
    "<br>",
    '<div class="gmail_quote">',
    `<div class="gmail_attr">${escapeHtml(attribution)}<br></div>`,
    '<blockquote class="gmail_quote" style="margin:0px 0px 0px 0.8ex;border-left:1px solid rgb(204,204,204);padding-left:1ex">',
    parentHtml,
    "</blockquote></div>",
  ].join("");

  if (params.html) return { plain, html: `${params.html}${quoteHtml}` };
  return { plain, html: `<div>${plainTextToHtml(params.plain)}</div>${quoteHtml}` };
}
