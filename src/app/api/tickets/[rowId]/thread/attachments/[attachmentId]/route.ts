import { NextResponse } from "next/server";
import { fetchGmailAttachment } from "@/lib/gmail";
import { getMessageAttachmentById } from "@/lib/overlay-db";
import { saveBufferToAttachmentRowFolder } from "@/lib/attachment-folder-path";
import { parseTicketRowId } from "@/lib/types";

function sanitizeFilename(filename: string): string {
  const base = filename.replace(/[/\\?%*:|"<>]/g, "_").trim();
  return base || "attachment";
}

function contentDisposition(filename: string): string {
  const safe = sanitizeFilename(filename);
  const asciiFallback = safe.replace(/[^\x20-\x7E]/g, "_").replace(/"/g, "");
  const encoded = encodeURIComponent(safe).replace(/['()]/g, (ch) =>
    `%${ch.charCodeAt(0).toString(16).toUpperCase()}`
  );
  return `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encoded}`;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ rowId: string; attachmentId: string }> }
) {
  try {
    const { rowId, attachmentId } = await params;
    const ticketRowId = decodeURIComponent(rowId);
    const decodedAttachmentId = decodeURIComponent(attachmentId);
    const saveLocal = new URL(request.url).searchParams.get("saveLocal") === "1";

    if (process.env.USE_MOCK_DATA === "true") {
      return NextResponse.json(
        { error: "Attachments are not available in mock mode" },
        { status: 400 }
      );
    }

    const attachment = getMessageAttachmentById(decodedAttachmentId, ticketRowId);
    if (!attachment) {
      return NextResponse.json(
        {
          error:
            "Attachment not found. Refresh the ticket conversation and try again.",
        },
        { status: 404 }
      );
    }

    const { data } = await fetchGmailAttachment({
      gmailMessageId: attachment.gmailMessageId,
      gmailAttachmentId: attachment.gmailAttachmentId,
    });

    const headers = new Headers({
      "Content-Type": attachment.mimeType || "application/octet-stream",
      "Content-Disposition": contentDisposition(attachment.filename),
      "Content-Length": String(data.length),
      "Cache-Control": "private, no-store",
    });

    // Local CRM: write into ~/Documents/SheetsCRM-Attachments/Row {n}/ (same path Finder opens).
    if (saveLocal) {
      const parsed = parseTicketRowId(ticketRowId);
      if (parsed) {
        const saved = saveBufferToAttachmentRowFolder(
          parsed.rowNumber,
          attachment.filename,
          data
        );
        headers.set("X-SheetsCRM-Saved-To", saved.pathHint);
        headers.set("X-SheetsCRM-Saved-Path", saved.absolutePath);
      }
    }

    return new NextResponse(new Uint8Array(data), { status: 200, headers });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to download attachment";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
