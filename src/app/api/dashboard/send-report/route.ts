import { NextResponse } from "next/server";
import {
  buildAgentDashboardReportBundle,
  buildTeamDashboardReportBundle,
  csvAttachmentForReport,
  loadColleagueTeamRecords,
  loadDashboardTickets,
  zipAttachmentForReport,
} from "@/lib/dashboard-report-server";
import { normalizeDashboardPeriod } from "@/lib/dashboard-period";
import { MAX_OUTBOUND_ATTACHMENT_BYTES } from "@/lib/gmail-attachments";
import { sendStandaloneEmail } from "@/lib/gmail";
import { getSignedInUser } from "@/lib/google-auth";
import { requireOAuthSession } from "@/lib/api-auth";
import {
  CRM_SYSTEM_AUDIT_TICKET_ID,
  logCrmTicketEvent,
} from "@/lib/crm-ticket-log";
import { parseRecipientList } from "@/lib/email-recipients";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function parseRecipients(raw: unknown): string[] | null {
  if (typeof raw !== "string") return null;
  const recipients = parseRecipientList(raw);
  if (
    recipients.length === 0 ||
    recipients.some((recipient) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient))
  ) {
    return null;
  }
  return [...new Map(recipients.map((recipient) => [recipient.toLowerCase(), recipient])).values()];
}

function parseOptionalString(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const trimmed = raw.trim();
  return trimmed === "" ? undefined : trimmed;
}

function parseBoolean(raw: unknown, defaultValue: boolean): boolean {
  if (raw === true || raw === "true") return true;
  if (raw === false || raw === "false") return false;
  return defaultValue;
}

function validateZipBuffer(data: Buffer): string | null {
  if (data.length === 0) return "Dashboard image ZIP is empty";
  if (data.length > MAX_OUTBOUND_ATTACHMENT_BYTES) {
    const mb = (data.length / (1024 * 1024)).toFixed(1);
    const limitMb = (MAX_OUTBOUND_ATTACHMENT_BYTES / (1024 * 1024)).toFixed(0);
    return `Dashboard image ZIP is too large (${mb} MB; limit ${limitMb} MB)`;
  }
  if (data.length < 4 || data.subarray(0, 2).toString("ascii") !== "PK") {
    return "Uploaded file is not a valid ZIP";
  }
  return null;
}

function sanitizeZipFilename(filename: string): string {
  const safe = filename.replace(/[^a-z0-9._-]+/gi, "-");
  if (!safe) return "dashboard-images.zip";
  return safe.toLowerCase().endsWith(".zip") ? safe : `${safe}.zip`;
}

async function parseSendReportRequest(request: Request): Promise<{
  payload: Record<string, unknown>;
  imagesBuffer: Buffer | null;
  imagesFilename: string | null;
}> {
  const contentType = request.headers.get("content-type") ?? "";

  if (contentType.includes("multipart/form-data")) {
    const form = await request.formData();
    const imagesEntry = form.get("images");
    let imagesBuffer: Buffer | null = null;
    let imagesFilename: string | null = null;

    if (imagesEntry instanceof File && imagesEntry.size > 0) {
      imagesBuffer = Buffer.from(await imagesEntry.arrayBuffer());
      imagesFilename = sanitizeZipFilename(imagesEntry.name || "dashboard-images.zip");
    }

    return {
      payload: {
        dashboard: form.get("dashboard"),
        period: form.get("period"),
        to: form.get("to"),
        marketManager: form.get("marketManager"),
        region: form.get("region"),
        owner: form.get("owner"),
        attachCsv: form.get("attachCsv"),
        attachImages: form.get("attachImages"),
      },
      imagesBuffer,
      imagesFilename,
    };
  }

  const body = await request.json();
  return {
    payload: body as Record<string, unknown>,
    imagesBuffer: null,
    imagesFilename: null,
  };
}

export async function POST(request: Request) {
  const denied = await requireOAuthSession();
  if (denied) return denied;
  const user = await getSignedInUser();
  if (user.method !== "oauth") {
    return NextResponse.json(
      { error: "Sign in with Google (OAuth) to email dashboard reports" },
      { status: 403 }
    );
  }

  let parsedRequest: Awaited<ReturnType<typeof parseSendReportRequest>>;
  try {
    parsedRequest = await parseSendReportRequest(request);
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { payload, imagesBuffer, imagesFilename } = parsedRequest;
  const dashboard =
    payload.dashboard === "team" ? "team" : payload.dashboard === "main" ? "main" : null;
  if (!dashboard) {
    return NextResponse.json({ error: "dashboard must be \"main\" or \"team\"" }, { status: 400 });
  }

  const recipients = parseRecipients(payload.to);
  if (!recipients) {
    return NextResponse.json(
      { error: "Enter one or more valid recipient email addresses" },
      { status: 400 }
    );
  }

  const period = normalizeDashboardPeriod(
    typeof payload.period === "string" ? payload.period : null
  );
  const attachCsv = parseBoolean(payload.attachCsv, true);
  const attachImages = parseBoolean(payload.attachImages, false);

  try {
    const tickets = await loadDashboardTickets(user.email);
    let subject: string;
    let html: string;
    let csv: string;
    let csvFilename: string;

    if (dashboard === "main") {
      const marketManagerRaw = parseOptionalString(payload.marketManager) ?? "all";
      const marketManager = marketManagerRaw === "" ? "all" : marketManagerRaw;
      const bundle = await buildAgentDashboardReportBundle({
        period,
        marketManager,
        tickets,
        userEmail: user.email,
      });
      subject = bundle.subject;
      html = bundle.html;
      csv = bundle.csv;
      csvFilename = bundle.csvFilename;
    } else {
      const regionRaw = parseOptionalString(payload.region) ?? "all";
      const ownerRaw = parseOptionalString(payload.owner) ?? "all";
      const region = regionRaw === "" ? "all" : regionRaw;
      const owner = ownerRaw === "" ? "all" : ownerRaw;
      const {
        records: colleagueRecords,
        sourcesLoaded,
        statusMappings,
        hostProfiles,
        hostProfilesLoaded,
      } = await loadColleagueTeamRecords();
      const bundle = buildTeamDashboardReportBundle({
        period,
        region,
        owner,
        tickets,
        colleagueRecords,
        sourcesLoaded,
        statusMappings,
        hostProfiles,
        hostProfilesLoaded,
      });
      subject = bundle.subject;
      html = bundle.html;
      csv = bundle.csv;
      csvFilename = bundle.csvFilename;
    }

    const attachments = [];
    if (attachCsv) {
      attachments.push(csvAttachmentForReport(csv, csvFilename));
    }

    if (attachImages) {
      if (!imagesBuffer) {
        return NextResponse.json(
          {
            error:
              "Dashboard image ZIP was missing from the request. Try again after the dashboard finishes loading.",
          },
          { status: 400 }
        );
      }
      const zipError = validateZipBuffer(imagesBuffer);
      if (zipError) {
        return NextResponse.json({ error: zipError }, { status: 400 });
      }
      attachments.push(
        zipAttachmentForReport(
          imagesBuffer,
          imagesFilename ?? csvFilename.replace(/\.csv$/i, "-images.zip")
        )
      );
    }

    const result = await sendStandaloneEmail({
      to: recipients.join(", "),
      subject,
      body: html,
      attachments,
    });

    logCrmTicketEvent({
      ticketRowId: CRM_SYSTEM_AUDIT_TICKET_ID,
      kind: "dashboard_report_sent",
      summary: `Emailed ${dashboard} dashboard report to ${recipients.join(", ")}`,
      detail: {
        dashboard,
        recipients,
        period,
        attachCsv,
        attachImages,
        subject,
        messageId: result.messageId,
        sender: user.email,
      },
    });

    return NextResponse.json({
      ok: true,
      messageId: result.messageId,
      to: recipients,
      attachCsv,
      attachImages,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to send report";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
