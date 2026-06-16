import { NextResponse } from "next/server";
import { loadSheetConfig, redactThreadMessage } from "@/lib/overlay-db";
import { parseTicketRowId } from "@/lib/types";
import type { SheetConfig } from "@/lib/types";
import { writeCaseSummaryOnSheet } from "@/lib/sheets";

function queueSheetSync(label: string, task: () => Promise<void>): void {
  void task().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[SheetsCRM sheet sync] ${label}:`, message);
  });
}

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ rowId: string; messageId: string }> }
) {
  try {
    const { rowId, messageId } = await params;
    const ticketRowId = decodeURIComponent(rowId);
    const threadMessageId = decodeURIComponent(messageId);

    const result = redactThreadMessage({ ticketRowId, messageId: threadMessageId });
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    let sheetSyncQueued = false;
    if (process.env.USE_MOCK_DATA !== "true") {
      const config = loadSheetConfig("default") as SheetConfig | null;
      const parsed = parseTicketRowId(ticketRowId);
      if (config && parsed) {
        sheetSyncQueued = true;
        queueSheetSync("adminNote", () =>
          writeCaseSummaryOnSheet(config, parsed.rowNumber, result.adminNotes)
        );
      }
    }

    return NextResponse.json({
      ok: true,
      messages: result.messages,
      adminNotes: result.adminNotes,
      sheetSyncQueued,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to redact message";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
