import { NextResponse } from "next/server";
import {
  buildAgentDashboardReportBundle,
  buildTeamDashboardReportBundle,
  csvAttachmentForReport,
  pdfAttachmentForReport,
  loadColleagueTeamRecords,
  loadDashboardTickets,
} from "@/lib/dashboard-report-server";
import { normalizeDashboardPeriod } from "@/lib/dashboard-period";
import { MAX_OUTBOUND_ATTACHMENT_BYTES } from "@/lib/gmail-attachments";
import { sendStandaloneEmail } from "@/lib/gmail";
import { getSignedInUser } from "@/lib/google-auth";
import { hasGoogleCredentials } from "@/lib/sheets";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function parseRecipient(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) return null;
  return trimmed;
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

function parsePdfAttachmentFromJson(raw: unknown): { filename: string; data: Buffer } | null {
  if (!raw || typeof raw !== "object") return null;
  const payload = raw as Record<string, unknown>;
  const filenameRaw = typeof payload.filename === "string" ? payload.filename.trim() : "";
  const dataBase64 = typeof payload.dataBase64 === "string" ? payload.dataBase64.trim() : "";
  if (!filenameRaw || !dataBase64) return null;

  const data = Buffer.from(dataBase64, "base64");
  if (data.length === 0) return null;

  const filename = filenameRaw.replace(/[^a-z0-9._-]+/gi, "-");
  if (!filename) return null;

  return {
    filename: filename.toLowerCase().endsWith(".pdf") ? filename : `${filename}.pdf`,
    data,
  };
}

function validatePdfBuffer(data: Buffer): string | null {
  if (data.length === 0) return "PDF attachment is empty";
  if (data.length > MAX_OUTBOUND_ATTACHMENT_BYTES) {
    const mb = (data.length / (1024 * 1024)).toFixed(1);
    const limitMb = (MAX_OUTBOUND_ATTACHMENT_BYTES / (1024 * 1024)).toFixed(0);
    return `PDF attachment is too large (${mb} MB; limit ${limitMb} MB)`;
  }
  if (data.subarray(0, 5).toString("ascii") !== "%PDF-") {
    return "Uploaded file is not a valid PDF";
  }
  return null;
}

function sanitizePdfFilename(filename: string): string {
  const safe = filename.replace(/[^a-z0-9._-]+/gi, "-");
  if (!safe) return "dashboard-report.pdf";
  return safe.toLowerCase().endsWith(".pdf") ? safe : `${safe}.pdf`;
}

async function parseSendReportRequest(request: Request): Promise<{
  payload: Record<string, unknown>;
  pdfBuffer: Buffer | null;
  pdfFilename: string | null;
}> {
  const contentType = request.headers.get("content-type") ?? "";

  if (contentType.includes("multipart/form-data")) {
    const form = await request.formData();
    const pdfEntry = form.get("pdf");
    let pdfBuffer: Buffer | null = null;
    let pdfFilename: string | null = null;

    if (pdfEntry instanceof File && pdfEntry.size > 0) {
      pdfBuffer = Buffer.from(await pdfEntry.arrayBuffer());
      pdfFilename = sanitizePdfFilename(pdfEntry.name || "dashboard-report.pdf");
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
        attachPdf: form.get("attachPdf"),
      },
      pdfBuffer,
      pdfFilename,
    };
  }

  const body = await request.json();
  const payload = body as Record<string, unknown>;
  const parsed = parsePdfAttachmentFromJson(payload.pdfAttachment);
  return {
    payload,
    pdfBuffer: parsed?.data ?? null,
    pdfFilename: parsed?.filename ?? null,
  };
}

export async function POST(request: Request) {
  const user = await getSignedInUser();
  if (!user.email && !(await hasGoogleCredentials())) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }
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

  const { payload, pdfBuffer, pdfFilename } = parsedRequest;
  const dashboard =
    payload.dashboard === "team" ? "team" : payload.dashboard === "main" ? "main" : null;
  if (!dashboard) {
    return NextResponse.json({ error: "dashboard must be \"main\" or \"team\"" }, { status: 400 });
  }

  const to = parseRecipient(payload.to);
  if (!to) {
    return NextResponse.json({ error: "A valid recipient email is required" }, { status: 400 });
  }

  const period = normalizeDashboardPeriod(
    typeof payload.period === "string" ? payload.period : null
  );
  const attachCsv = parseBoolean(payload.attachCsv, true);
  const attachPdf = parseBoolean(payload.attachPdf, false);

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
      const { records: colleagueRecords, sourcesLoaded } = await loadColleagueTeamRecords();
      const bundle = buildTeamDashboardReportBundle({
        period,
        region,
        owner,
        tickets,
        colleagueRecords,
        sourcesLoaded,
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

    if (attachPdf) {
      if (!pdfBuffer) {
        return NextResponse.json(
          {
            error:
              "PDF attachment was missing from the request. Try again after the dashboard finishes loading.",
          },
          { status: 400 }
        );
      }
      const pdfError = validatePdfBuffer(pdfBuffer);
      if (pdfError) {
        return NextResponse.json({ error: pdfError }, { status: 400 });
      }
      attachments.push(
        pdfAttachmentForReport(
          pdfBuffer,
          pdfFilename ?? csvFilename.replace(/\.csv$/i, ".pdf")
        )
      );
    }

    const result = await sendStandaloneEmail({
      to,
      subject,
      body: html,
      attachments,
    });

    return NextResponse.json({
      ok: true,
      messageId: result.messageId,
      to,
      attachCsv,
      attachPdf,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to send report";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
