/**
 * HTTP session gate for SheetsCRM APIs.
 *
 * Service-account credentials must not satisfy browser/API access — only an
 * OAuth refresh-token cookie counts (except USE_MOCK_DATA=true for local demos).
 * Middleware enforces this globally; route handlers can call requireOAuthSession
 * for defense in depth.
 */
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { GOOGLE_EMAIL_COOKIE, GOOGLE_REFRESH_COOKIE } from "@/lib/auth-cookies";

export function isMockDataMode(): boolean {
  return process.env.USE_MOCK_DATA === "true";
}

export async function hasOAuthSession(): Promise<boolean> {
  if (isMockDataMode()) return true;
  const cookieStore = await cookies();
  return Boolean(cookieStore.get(GOOGLE_REFRESH_COOKIE)?.value);
}

/** Returns a 401 response when the request lacks an OAuth session; otherwise null. */
export async function requireOAuthSession(): Promise<NextResponse | null> {
  if (await hasOAuthSession()) return null;
  return NextResponse.json(
    { error: "Sign in with Google first" },
    { status: 401, headers: { "Cache-Control": "no-store" } }
  );
}

export async function getOAuthSessionEmail(): Promise<string | null> {
  const cookieStore = await cookies();
  if (!cookieStore.get(GOOGLE_REFRESH_COOKIE)?.value) return null;
  return cookieStore.get(GOOGLE_EMAIL_COOKIE)?.value ?? null;
}
