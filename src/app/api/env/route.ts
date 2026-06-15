import { NextResponse } from "next/server";
import {
  ENV_FIELD_GROUPS,
  getEnvFieldStatuses,
  isLocalEnvEditorRequest,
  MANAGED_ENV_FIELDS,
  writeEnvUpdates,
} from "@/lib/env-settings";

export const dynamic = "force-dynamic";

function localOnly(request: Request) {
  if (!isLocalEnvEditorRequest(request)) {
    return NextResponse.json(
      {
        error:
          "Environment settings can only be changed when running SheetsCRM locally (localhost).",
      },
      { status: 403 }
    );
  }
  return null;
}

export async function GET(request: Request) {
  const blocked = localOnly(request);
  if (blocked) return blocked;

  return NextResponse.json({
    fields: getEnvFieldStatuses(),
    groups: ENV_FIELD_GROUPS,
    restartRequired:
      "Some changes (especially URLs starting with NEXT_PUBLIC_) may require restarting the dev server.",
  });
}

export async function PATCH(request: Request) {
  const blocked = localOnly(request);
  if (blocked) return blocked;

  try {
    const body = (await request.json()) as { updates?: Record<string, string> };
    const updates = body.updates ?? {};
    const allowedKeys = new Set(MANAGED_ENV_FIELDS.map((f) => f.key));

    const sanitized: Record<string, string> = {};
    for (const [key, value] of Object.entries(updates)) {
      if (!allowedKeys.has(key)) continue;
      sanitized[key] = typeof value === "string" ? value : String(value ?? "");
    }

    if (Object.keys(sanitized).length === 0) {
      return NextResponse.json({ error: "No valid environment keys to update" }, { status: 400 });
    }

    writeEnvUpdates(sanitized);

    return NextResponse.json({
      ok: true,
      fields: getEnvFieldStatuses(),
      restartRequired:
        "Saved to .env on this machine. Restart the CRM if a setting does not take effect immediately.",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to update .env";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
