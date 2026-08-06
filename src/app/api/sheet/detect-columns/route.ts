import { NextResponse } from "next/server";
import { EXAMPLE_SHEET_GID } from "@/lib/default-sheet-config";
import { resolveAndAssessIntakeSheet } from "@/lib/intake-column-resolve";
import { loadSheetConfig } from "@/lib/overlay-db";
import { fetchSheetHeaders } from "@/lib/sheets";
import { parseSheetUrl, type SheetConfig } from "@/lib/types";
import { prepareSheetConfig } from "@/lib/ui-field-slots";
import { requireOAuthSession } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

interface DetectBody {
  sheetUrl?: string;
  /** When provided, detect against this draft config instead of saved default. */
  config?: SheetConfig;
}

export async function POST(request: Request) {
  const denied = await requireOAuthSession();
  if (denied) return denied;

  let body: DetectBody;
  try {
    body = (await request.json()) as DetectBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const saved = loadSheetConfig("default");
  const draft = body.config ? prepareSheetConfig(body.config) : saved;
  const sheetUrl = body.sheetUrl?.trim() || draft?.sheetUrl || saved?.sheetUrl || "";
  const parsed = sheetUrl ? parseSheetUrl(sheetUrl) : null;

  const baseConfig: SheetConfig | null = draft
    ? {
        ...draft,
        sheetUrl: sheetUrl || draft.sheetUrl,
        spreadsheetId: parsed?.spreadsheetId || draft.spreadsheetId,
      }
    : null;

  if (!baseConfig?.spreadsheetId) {
    return NextResponse.json(
      { error: "Sheet URL / spreadsheet id is required" },
      { status: 400 }
    );
  }

  try {
    const { headers, sheetName } = await fetchSheetHeaders(
      baseConfig.spreadsheetId,
      baseConfig.sheetName,
      parsed?.gid ?? EXAMPLE_SHEET_GID
    );
    const resolution = resolveAndAssessIntakeSheet(
      { ...baseConfig, sheetName },
      headers,
      [],
      { label: sheetName || "Intake sheet" }
    );

    return NextResponse.json({
      config: {
        ...resolution.config,
        manuallyMapped: true,
        updatedAt: new Date().toISOString(),
      },
      headers,
      sheetName,
      warnings: resolution.warnings,
      letterDrift: resolution.letterDrift,
      fields: resolution.fields,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to detect columns";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
