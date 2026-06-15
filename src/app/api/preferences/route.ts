import { NextResponse } from "next/server";
import {
  bulkImportTicketComposePrefs,
  loadStoredUserPreferences,
  saveStoredUserPreferences,
  type StoredUserPreferences,
  type TicketComposePrefs,
} from "@/lib/crm-preferences-store";
import { getSignedInUser } from "@/lib/google-auth";

export const dynamic = "force-dynamic";

async function userKeyFromRequest(): Promise<string | null> {
  const { email } = await getSignedInUser();
  return email;
}

export async function GET() {
  const userKey = await userKeyFromRequest();
  const preferences = loadStoredUserPreferences(userKey);
  return NextResponse.json({ preferences, userKey: userKey ?? "local" });
}

export async function PATCH(request: Request) {
  try {
    const userKey = await userKeyFromRequest();
    const body = (await request.json()) as {
      preferences?: Partial<StoredUserPreferences>;
      migrateCompose?: Record<string, TicketComposePrefs>;
    };

    const current = loadStoredUserPreferences(userKey);
    const merged = saveStoredUserPreferences(
      {
        ...current,
        ...body.preferences,
      },
      userKey
    );

    let composeMigrated = 0;
    if (body.migrateCompose && typeof body.migrateCompose === "object") {
      composeMigrated = bulkImportTicketComposePrefs(body.migrateCompose, userKey);
    }

    return NextResponse.json({
      ok: true,
      preferences: merged,
      composeMigrated: composeMigrated > 0 ? composeMigrated : undefined,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to save preferences";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
