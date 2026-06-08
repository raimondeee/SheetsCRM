import { NextResponse } from "next/server";
import { analyzeAndBuildConfig, fetchSheetHeaders, hasGoogleCredentials } from "@/lib/sheets";
import { buildDefaultSheetConfig, EXAMPLE_SHEET_GID } from "@/lib/default-sheet-config";
import { analyzeHeaders } from "@/lib/column-mapper";
import { parseSheetUrl } from "@/lib/types";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const sheetUrl = body.sheetUrl as string;

    if (!sheetUrl) {
      return NextResponse.json({ error: "sheetUrl is required" }, { status: 400 });
    }

    const parsed = parseSheetUrl(sheetUrl);
    if (!parsed) {
      return NextResponse.json({ error: "Invalid Google Sheets URL" }, { status: 400 });
    }

    let headers: string[] = [];
    let sheetName = "Form Responses";
    let analysisSource = "position-defaults";

    if (await hasGoogleCredentials()) {
      try {
        const result = await fetchSheetHeaders(
          parsed.spreadsheetId,
          undefined,
          parsed.gid ?? EXAMPLE_SHEET_GID
        );
        headers = result.headers;
        sheetName = result.sheetName;
        analysisSource = "google-api";
      } catch (e) {
        analysisSource = "position-defaults-api-failed";
      }
    }

    const columns = headers.length > 0 ? analyzeHeaders(headers) : buildDefaultSheetConfig().columns;
    const k = columns.find((c) => c.role === "internalToolK");
    const m = columns.find((c) => c.role === "internalToolM");
    const r = columns.find((c) => c.role === "internalToolR");
    const n = columns.find((c) => c.role === "status");

    const config = await analyzeAndBuildConfig(sheetUrl, parsed.spreadsheetId, parsed.gid);

    return NextResponse.json({
      config,
      analysis: {
        source: analysisSource,
        headers,
        sheetName,
        columns: { k, m, r, n },
        note:
          headers.length === 0
            ? "Sign in with Google (top-right) to read this private sheet using your account access."
            : undefined,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Analysis failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
