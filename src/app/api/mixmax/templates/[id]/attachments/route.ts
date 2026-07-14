import { NextResponse } from "next/server";
import { fetchMixmaxTemplateAttachments } from "@/lib/mixmax-attachments";
import { fetchMixmaxTemplateById, isMixmaxConfigured } from "@/lib/mixmax";

export const dynamic = "force-dynamic";

interface AttachmentImportBody {
  to?: string;
  subject?: string;
  body?: string;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!isMixmaxConfigured()) {
    return NextResponse.json({ error: "Mixmax is not configured" }, { status: 400 });
  }

  const { id } = await params;
  const templateId = id?.trim();
  if (!templateId) {
    return NextResponse.json({ error: "Template id is required" }, { status: 400 });
  }

  let importContext: AttachmentImportBody = {};
  try {
    importContext = (await request.json()) as AttachmentImportBody;
  } catch {
    importContext = {};
  }

  const to = importContext.to?.trim() ?? "";
  if (!to) {
    return NextResponse.json(
      { error: "Requester email is required to import Mixmax template attachments" },
      { status: 400 }
    );
  }

  try {
    const template = await fetchMixmaxTemplateById(templateId);
    if (template.attachments.length === 0) {
      return NextResponse.json({ attachments: [] });
    }

    const attachments = await fetchMixmaxTemplateAttachments(template.attachments, {
      to,
      subject: importContext.subject,
      body: importContext.body,
    });
    return NextResponse.json({
      attachments,
      source: template.source,
      title: template.title,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to load Mixmax template attachments";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
