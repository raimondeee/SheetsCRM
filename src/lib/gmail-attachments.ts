import type { gmail_v1 } from "googleapis";

export interface ParsedGmailAttachment {
  gmailAttachmentId: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
}

function getPartHeader(
  headers: gmail_v1.Schema$MessagePartHeader[] | undefined,
  name: string
): string {
  return headers?.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value ?? "";
}

function decodeFilename(raw: string): string {
  const trimmed = raw.trim().replace(/^["']|["']$/g, "");
  if (trimmed.toLowerCase().startsWith("utf-8''")) {
    try {
      return decodeURIComponent(trimmed.slice(7));
    } catch {
      return trimmed.slice(7);
    }
  }
  try {
    return decodeURIComponent(trimmed);
  } catch {
    return trimmed;
  }
}

function getPartFilename(part: gmail_v1.Schema$MessagePart): string | null {
  const disposition = getPartHeader(part.headers, "Content-Disposition");
  const dispMatch =
    disposition.match(/filename\*=(?:UTF-8'')?([^;]+)/i) ??
    disposition.match(/filename=([^;]+)/i);
  if (dispMatch?.[1]) return decodeFilename(dispMatch[1]);

  const contentType = getPartHeader(part.headers, "Content-Type");
  const nameMatch = contentType.match(/name="([^"]+)"/i) ?? contentType.match(/name=([^;]+)/i);
  if (nameMatch?.[1]) return decodeFilename(nameMatch[1]);

  return part.filename ?? null;
}

function isAttachmentPart(part: gmail_v1.Schema$MessagePart): boolean {
  const attachmentId = part.body?.attachmentId;
  if (!attachmentId) return false;

  const mime = (part.mimeType ?? "").toLowerCase();
  const disposition = getPartHeader(part.headers, "Content-Disposition").toLowerCase();

  if (disposition.includes("attachment")) return true;
  if (getPartFilename(part)) return true;

  if (mime.startsWith("multipart/")) return false;
  if (mime === "text/plain" || mime === "text/html") {
    return disposition.includes("attachment");
  }

  return true;
}

/** Walk a Gmail MIME payload and collect attachment metadata (no bytes). */
export function extractAttachmentsFromPayload(
  payload: gmail_v1.Schema$MessagePart | undefined,
  results: ParsedGmailAttachment[] = []
): ParsedGmailAttachment[] {
  if (!payload) return results;

  if (isAttachmentPart(payload)) {
    const attachmentId = payload.body?.attachmentId;
    if (attachmentId) {
      const filename = getPartFilename(payload) ?? `attachment-${results.length + 1}`;
      results.push({
        gmailAttachmentId: attachmentId,
        filename,
        mimeType: payload.mimeType ?? "application/octet-stream",
        sizeBytes: payload.body?.size ?? 0,
      });
    }
  }

  for (const part of payload.parts ?? []) {
    extractAttachmentsFromPayload(part, results);
  }

  return results;
}

export const MAX_OUTBOUND_ATTACHMENTS = 10;
export const MAX_OUTBOUND_ATTACHMENT_BYTES = 20 * 1024 * 1024;
export const MAX_OUTBOUND_ATTACHMENTS_TOTAL_BYTES = 24 * 1024 * 1024;

export interface OutboundEmailAttachment {
  filename: string;
  mimeType: string;
  data: Buffer;
}

export function sanitizeAttachmentFilename(name: string): string {
  const base = name.trim().split(/[/\\]/).pop() ?? "attachment";
  const sanitized = base.replace(/[^\w.\- ()[\]]+/g, "_").slice(0, 200);
  return sanitized || "attachment";
}

export function encodeBase64MimeLines(buffer: Buffer): string {
  const b64 = buffer.toString("base64");
  const lines: string[] = [];
  for (let i = 0; i < b64.length; i += 76) {
    lines.push(b64.slice(i, i + 76));
  }
  return lines.join("\r\n");
}

export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
