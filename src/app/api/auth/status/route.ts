import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getServiceAccountAuth, hasGoogleAuth } from "@/lib/google-auth";
import { GOOGLE_EMAIL_COOKIE, GOOGLE_REFRESH_COOKIE } from "@/lib/auth-cookies";
import { isMockDataMode } from "@/lib/api-auth";

/**
 * Reports browser/API session state. Service-account-only installs are not
 * "signed in" for HTTP — middleware requires an OAuth refresh cookie.
 * Mock mode reports signedIn so the UI can load synthetic tickets without OAuth.
 */
export async function GET() {
  const cookieStore = await cookies();
  const hasOauth = Boolean(cookieStore.get(GOOGLE_REFRESH_COOKIE)?.value);
  const email = hasOauth
    ? (cookieStore.get(GOOGLE_EMAIL_COOKIE)?.value ?? null)
    : null;
  const mockMode = isMockDataMode();

  return NextResponse.json({
    signedIn: hasOauth || mockMode,
    email,
    method: hasOauth ? "oauth" : null,
    mockMode,
    oauthAvailable: hasGoogleAuth(),
    serviceAccountConfigured: Boolean(getServiceAccountAuth()),
  });
}
