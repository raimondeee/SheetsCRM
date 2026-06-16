import { NextResponse } from "next/server";
import { google } from "googleapis";
import { getGoogleAuthClient } from "@/lib/google-auth";
import { loadSheetConfig, linkExistingGmailThread } from "@/lib/overlay-db";
import { getColumnByRole } from "@/lib/column-mapper";
import { buildGmailThreadUrl } from "@/lib/gmail-urls";

function displayNameFromFromHeader(from: string): string {
  const trimmed = from.trim();
  if (!trimmed) return "";
  const withoutAddress = trimmed.replace(/\s*<[^>]+>\s*$/, "").trim();
  if (withoutAddress && withoutAddress !== trimmed) return withoutAddress.replace(/^"|"$/g, "");
  const localPart = trimmed.split("@")[0] ?? "";
  return localPart.replace(/[._-]+/g, " ").trim();
}

function parseUpdatedRowNumber(updatedRange: string | null | undefined): number | null {
  if (!updatedRange) return null;
  const match = updatedRange.match(/![A-Z]+(\d+):[A-Z]+(\d+)/);
  if (!match) return null;
  const row = Number.parseInt(match[1] ?? "", 10);
  return Number.isFinite(row) ? row : null;
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const {
      threadId,
      from,
      fromEmail,
      subject,
      snippet,
    } = body as {
      threadId: string;
      from?: string;
      fromEmail?: string;
      subject?: string;
      snippet?: string;
    };

    const trimmedThreadId = threadId?.trim();
    if (!trimmedThreadId) {
      return NextResponse.json({ error: "threadId is required" }, { status: 400 });
    }

    const config = loadSheetConfig("default");
    if (!config) {
      return NextResponse.json({ error: "Sheet config not found" }, { status: 400 });
    }

    const auth = await getGoogleAuthClient();
    if (!auth) {
      return NextResponse.json({ error: "Sign in with Google first" }, { status: 401 });
    }

    const maxIndex = Math.max(...config.columns.map((col) => col.index), 30);
    const rowValues = Array.from({ length: maxIndex + 1 }, () => "");
    const setRole = (role: Parameters<typeof getColumnByRole>[1], value: string) => {
      const column = getColumnByRole(config, role);
      if (!column) return;
      rowValues[column.index] = value;
    };

    const now = new Date().toISOString();
    setRole("timestamp", now);
    setRole("email", fromEmail?.trim() ?? "");
    setRole("name", displayNameFromFromHeader(from ?? ""));
    setRole("subject", subject?.trim() ?? "");
    setRole("description", snippet?.trim() ?? "");
    setRole("status", "Open");

    const sheets = google.sheets({ version: "v4", auth });
    const append = await sheets.spreadsheets.values.append({
      spreadsheetId: config.spreadsheetId,
      range: `'${config.sheetName}'!A:ZZ`,
      valueInputOption: "RAW",
      insertDataOption: "INSERT_ROWS",
      requestBody: { values: [rowValues] },
    });

    const rowNumber = parseUpdatedRowNumber(append.data.updates?.updatedRange);
    if (!rowNumber) {
      return NextResponse.json({ error: "Could not determine created row" }, { status: 500 });
    }

    const rowId = `${config.spreadsheetId}:${config.sheetName}:${rowNumber}`;
    const link = linkExistingGmailThread(rowId, {
      threadId: trimmedThreadId,
      openUrl: buildGmailThreadUrl(trimmedThreadId),
      replace: false,
    });

    if (!link.ok) {
      return NextResponse.json(
        {
          error: `Created ticket row, but linking Gmail thread failed: ${link.error}`,
          rowId,
          rowNumber,
          linked: false,
        },
        { status: 409 }
      );
    }

    return NextResponse.json({ ok: true, rowId, rowNumber, linked: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to create ticket from unread Gmail";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
