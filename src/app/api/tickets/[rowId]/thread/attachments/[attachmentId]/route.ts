import { NextResponse } from "next/server";
import { fetchGmailAttachment } from "@/lib/gmail";
import { getMessageAttachmentById } from "@/lib/overlay-db";

function sanitizeFilename(filename: string): string {
  const base = filename.replace(/[/\\?%*:|"<>]/g, "_").trim();
  return base || "attachment";
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ rowId: string; attachmentId: string }> }
) {
  try {
    const { rowId, attachmentId } = await params;
    const ticketRowId = decodeURIComponent(rowId);
    const decodedAttachmentId = decodeURIComponent(attachmentId);

    if (process.env.USE_MOCK_DATA === "true") {
      return NextResponse.json({ error: "Attachments are not available in mock mode" }, { status: 400 });
    }

    const attachment = getMessageAttachmentById(decodedAttachmentId, ticketRowId);
    if (!attachment) {
      return NextResponse.json({ error: "Attachment not found" }, { status: 404 });
    }

    const { data } = await fetchGmailAttachment({
      gmailMessageId: attachment.gmailMessageId,
      gmailAttachmentId: attachment.gmailAttachmentId,
    });

    const filename = sanitizeFilename(attachment.filename);
    const headers = new Headers({
      "Content-Type": attachment.mimeType || "application/octet-stream",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Content-Length": String(data.length),
      "Cache-Control": "private, no-store",
    });

    return new NextResponse(new Uint8Array(data), { status: 200, headers });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to download attachment";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
