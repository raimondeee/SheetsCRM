/**
 * Starts Google OAuth consent. Requires GOOGLE_CLIENT_ID / SECRET in .env and
 * authorized redirect URI http://localhost:3000/api/auth/callback.
 */
import { NextResponse } from "next/server";
import { getOAuthSignInUrl } from "@/lib/google-auth";
import { recordAuthHandler, withApiRequestLog } from "@/lib/ops-diagnostics";

export async function GET(request: Request) {
  return withApiRequestLog(request, "/api/auth/google", handleGet);
}

async function handleGet() {
  const started = Date.now();
  try {
    const url = getOAuthSignInUrl();

    if (!url) {
      recordAuthHandler({
        name: "google_redirect",
        ok: false,
        durationMs: Date.now() - started,
        error: "OAuth client is not configured",
      });
      return NextResponse.json(
        {
          error:
            "Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env, then add http://localhost:3000/api/auth/callback as an authorized redirect URI in Google Cloud Console.",
        },
        { status: 400 }
      );
    }

    recordAuthHandler({
      name: "google_redirect",
      ok: true,
      durationMs: Date.now() - started,
    });
    return NextResponse.redirect(url);
  } catch (error) {
    const message = error instanceof Error ? error.message : "auth_redirect_failed";
    recordAuthHandler({
      name: "google_redirect",
      ok: false,
      durationMs: Date.now() - started,
      error: message,
    });
    throw error;
  }
}
