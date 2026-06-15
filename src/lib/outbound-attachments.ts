import {
  MAX_OUTBOUND_ATTACHMENT_BYTES,
  MAX_OUTBOUND_ATTACHMENTS,
  MAX_OUTBOUND_ATTACHMENTS_TOTAL_BYTES,
  sanitizeAttachmentFilename,
  type OutboundEmailAttachment,
} from "./gmail-attachments";

export interface OutboundAttachmentInput {
  filename: string;
  mimeType: string;
  data: string;
}

const MIME_BY_EXTENSION: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  heic: "image/heic",
  pdf: "application/pdf",
  txt: "text/plain",
  csv: "text/csv",
};

export function inferAttachmentMimeType(filename: string, reportedType?: string): string {
  const trimmed = reportedType?.trim();
  if (trimmed && trimmed !== "application/octet-stream") return trimmed;
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  return MIME_BY_EXTENSION[ext] ?? "application/octet-stream";
}

export function parseOutboundAttachments(
  raw: unknown
): OutboundEmailAttachment[] | { error: string } {
  if (raw == null) return [];
  if (!Array.isArray(raw)) {
    return { error: "attachments must be an array" };
  }
  if (raw.length > MAX_OUTBOUND_ATTACHMENTS) {
    return { error: `At most ${MAX_OUTBOUND_ATTACHMENTS} attachments per email` };
  }

  const parsed: OutboundEmailAttachment[] = [];
  let totalBytes = 0;

  for (const item of raw) {
    if (!item || typeof item !== "object") {
      return { error: "Invalid attachment entry" };
    }
    const { filename, mimeType, data } = item as OutboundAttachmentInput;
    if (typeof filename !== "string" || !filename.trim()) {
      return { error: "Each attachment needs a filename" };
    }
    if (typeof data !== "string" || !data.trim()) {
      return { error: `Attachment "${filename}" is missing data` };
    }

    let buffer: Buffer;
    try {
      buffer = Buffer.from(data, "base64");
    } catch {
      return { error: `Attachment "${filename}" has invalid base64 data` };
    }

    if (buffer.length === 0) {
      return { error: `Attachment "${filename}" is empty` };
    }
    if (buffer.length > MAX_OUTBOUND_ATTACHMENT_BYTES) {
      return {
        error: `Attachment "${filename}" exceeds ${Math.round(MAX_OUTBOUND_ATTACHMENT_BYTES / (1024 * 1024))}MB`,
      };
    }

    totalBytes += buffer.length;
    if (totalBytes > MAX_OUTBOUND_ATTACHMENTS_TOTAL_BYTES) {
      return {
        error: `Total attachment size exceeds ${Math.round(MAX_OUTBOUND_ATTACHMENTS_TOTAL_BYTES / (1024 * 1024))}MB`,
      };
    }

    parsed.push({
      filename: sanitizeAttachmentFilename(filename),
      mimeType: inferAttachmentMimeType(filename, mimeType),
      data: buffer,
    });
  }

  return parsed;
}

export function validateReplyAttachmentFiles(
  existing: File[],
  incoming: File[]
): { accepted: File[]; error: string | null } {
  const combined = [...existing, ...incoming];
  if (combined.length > MAX_OUTBOUND_ATTACHMENTS) {
    return {
      accepted: [],
      error: `At most ${MAX_OUTBOUND_ATTACHMENTS} attachments per email`,
    };
  }

  let totalBytes = existing.reduce((sum, file) => sum + file.size, 0);
  for (const file of incoming) {
    if (file.size > MAX_OUTBOUND_ATTACHMENT_BYTES) {
      return {
        accepted: [],
        error: `"${file.name}" exceeds ${Math.round(MAX_OUTBOUND_ATTACHMENT_BYTES / (1024 * 1024))}MB`,
      };
    }
    totalBytes += file.size;
    if (totalBytes > MAX_OUTBOUND_ATTACHMENTS_TOTAL_BYTES) {
      return {
        accepted: [],
        error: `Total attachment size exceeds ${Math.round(MAX_OUTBOUND_ATTACHMENTS_TOTAL_BYTES / (1024 * 1024))}MB`,
      };
    }
  }

  return { accepted: incoming, error: null };
}

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== "string") {
        reject(new Error(`Failed to read "${file.name}"`));
        return;
      }
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(reader.error ?? new Error(`Failed to read "${file.name}"`));
    reader.readAsDataURL(file);
  });
}

/** Browser-only: encode selected files for POST /thread. */
export async function readFilesAsAttachmentPayload(
  files: File[]
): Promise<OutboundAttachmentInput[]> {
  return Promise.all(
    files.map(async (file) => ({
      filename: file.name,
      mimeType: inferAttachmentMimeType(file.name, file.type),
      data: await readFileAsBase64(file),
    }))
  );
}
