import {
  MAX_OUTBOUND_ATTACHMENT_BYTES,
  MAX_OUTBOUND_ATTACHMENTS,
  MAX_OUTBOUND_ATTACHMENTS_TOTAL_BYTES,
  sanitizeAttachmentFilename,
} from "./gmail-attachments";
import {
  findGmailAttachmentBytesByFilename,
  importAttachmentsFromTransientGmailDraft,
} from "./gmail";
import { createMixmaxGmailSyncDraft, getMixmaxApiToken, type MixmaxAttachmentMeta } from "./mixmax";
import { withOpsMetric } from "./ops-metrics";

export interface MixmaxAttachmentPayload {
  filename: string;
  mimeType: string;
  data: string;
  size: number;
}

export interface MixmaxAttachmentImportContext {
  to: string;
  subject?: string;
  body?: string;
}

function isCloudHostedAttachment(attachment: MixmaxAttachmentMeta): boolean {
  return Boolean(attachment.location?.includes("cloudfront.net"));
}

function mixmaxAttachmentDownloadUrls(
  attachment: MixmaxAttachmentMeta,
  token: string
): string[] {
  const encodedToken = encodeURIComponent(token);
  const key = encodeURIComponent(attachment.key);
  const urls = [
    `https://app.mixmax.com/api/cloudattachments/${key}/download?apiToken=${encodedToken}`,
    `https://app.mixmax.com/api/cloudattachments/${key}/download`,
  ];
  if (attachment.location) {
    const separator = attachment.location.includes("?") ? "&" : "?";
    urls.push(`${attachment.location}${separator}apiToken=${encodedToken}`);
    urls.push(attachment.location);
  }
  return urls;
}

async function downloadMixmaxAttachmentDirect(
  attachment: MixmaxAttachmentMeta
): Promise<Buffer> {
  const token = getMixmaxApiToken();
  if (!token) {
    throw new Error("Mixmax is not configured");
  }

  let lastStatus = 0;
  for (const url of mixmaxAttachmentDownloadUrls(attachment, token)) {
    const res = await withOpsMetric("mixmax", "attachments.download", () =>
      fetch(url, {
        headers: { "X-API-Token": token },
        redirect: "follow",
        cache: "no-store",
      })
    );
    lastStatus = res.status;
    if (!res.ok) continue;

    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.length === 0) continue;
    if (attachment.size > 0 && buffer.length < Math.min(attachment.size, 32)) {
      const asText = buffer.toString("utf8").trim();
      if (asText.startsWith("{") || asText.startsWith("<!")) continue;
    }
    return buffer;
  }

  throw new Error(
    `Could not download "${attachment.name}" from Mixmax (last status ${lastStatus || "unknown"})`
  );
}

function toPayload(
  filename: string,
  mimeType: string,
  data: Buffer
): MixmaxAttachmentPayload {
  return {
    filename: sanitizeAttachmentFilename(filename),
    mimeType: mimeType || "application/octet-stream",
    data: data.toString("base64"),
    size: data.length,
  };
}

async function importCloudAttachmentsViaGmail(
  attachments: MixmaxAttachmentMeta[],
  context: MixmaxAttachmentImportContext
): Promise<MixmaxAttachmentPayload[]> {
  const marker = `SheetsCRM-Mixmax-import-${Date.now()}`;
  const bodyMarker = `<!-- ${marker} -->`;
  const startedAt = Date.now();
  const draftSubject = `${context.subject?.trim() || "Template attachments"} [${marker}]`;
  const baseBody = context.body?.trim() || "<p></p>";
  const bodyWithMarker = baseBody.includes(bodyMarker) ? baseBody : `${baseBody}\n${bodyMarker}`;

  await createMixmaxGmailSyncDraft({
    to: context.to,
    subject: draftSubject,
    body: bodyWithMarker,
    attachments,
  });

  const imported = await importAttachmentsFromTransientGmailDraft({
    subjectMarker: marker,
    bodyMarker,
    toEmail: context.to,
    startedAt,
    expectedFilenames: attachments.map((attachment) => attachment.name),
    maxWaitMs: 45_000,
  });

  return imported.map((file) => toPayload(file.filename, file.mimeType, file.data));
}

function enforceAttachmentLimits(payloads: MixmaxAttachmentPayload[]): MixmaxAttachmentPayload[] {
  if (payloads.length > MAX_OUTBOUND_ATTACHMENTS) {
    throw new Error(`Template has more than ${MAX_OUTBOUND_ATTACHMENTS} attachments`);
  }

  let totalBytes = 0;
  for (const payload of payloads) {
    if (payload.size > MAX_OUTBOUND_ATTACHMENT_BYTES) {
      throw new Error(
        `"${payload.filename}" exceeds ${Math.round(MAX_OUTBOUND_ATTACHMENT_BYTES / (1024 * 1024))}MB`
      );
    }
    totalBytes += payload.size;
    if (totalBytes > MAX_OUTBOUND_ATTACHMENTS_TOTAL_BYTES) {
      throw new Error(
        `Template attachments exceed ${Math.round(MAX_OUTBOUND_ATTACHMENTS_TOTAL_BYTES / (1024 * 1024))}MB total`
      );
    }
  }

  return payloads;
}

export async function fetchMixmaxTemplateAttachments(
  attachments: MixmaxAttachmentMeta[],
  context: MixmaxAttachmentImportContext
): Promise<MixmaxAttachmentPayload[]> {
  if (attachments.length === 0) return [];

  const to = context.to.trim();
  if (!to) {
    throw new Error("Ticket email is required to import Mixmax template attachments");
  }

  const cloudAttachments = attachments.filter(isCloudHostedAttachment);
  const directAttachments = attachments.filter((attachment) => !isCloudHostedAttachment(attachment));

  const payloads: MixmaxAttachmentPayload[] = [];

  for (const attachment of directAttachments) {
    const fromMailbox = await findGmailAttachmentBytesByFilename(attachment.name);
    if (fromMailbox) {
      payloads.push(toPayload(fromMailbox.filename, fromMailbox.mimeType, fromMailbox.data));
      continue;
    }
    const buffer = await downloadMixmaxAttachmentDirect(attachment);
    payloads.push(toPayload(attachment.name, attachment.type, buffer));
  }

  if (cloudAttachments.length > 0) {
    const remaining: MixmaxAttachmentMeta[] = [];
    for (const attachment of cloudAttachments) {
      const fromMailbox = await findGmailAttachmentBytesByFilename(attachment.name);
      if (fromMailbox) {
        payloads.push(toPayload(fromMailbox.filename, fromMailbox.mimeType, fromMailbox.data));
      } else {
        remaining.push(attachment);
      }
    }

    if (remaining.length > 0) {
      payloads.push(...(await importCloudAttachmentsViaGmail(remaining, { ...context, to })));
    }
  }

  return enforceAttachmentLimits(payloads);
}
