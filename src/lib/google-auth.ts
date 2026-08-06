/**
 * Google credentials for SheetsCRM.
 *
 * Layer: auth / Google API clients
 *
 * Primary path: user OAuth2 (offline refresh token in an httpOnly cookie). That
 * unlocks Sheets + Gmail + Calendar + People with the signed-in operator's access.
 * Optional service-account JWT is Sheets-only and cannot send mail or read Calendar.
 * HTTP APIs require an OAuth refresh-token cookie (see middleware + api-auth); a
 * service account alone must not unlock ticket/PII routes for anonymous callers.
 *
 * There are no application user accounts — whoever signed in on this machine is
 * the operator. Scopes are listed in GOOGLE_SCOPES; after pulling new scopes,
 * operators must sign out and back in so Google re-prompts.
 *
 * @see /api/auth/google, /api/auth/callback
 */
import { google } from "googleapis";
import type { OAuth2Client } from "google-auth-library";
import { cookies } from "next/headers";
import { GOOGLE_EMAIL_COOKIE, GOOGLE_REFRESH_COOKIE } from "@/lib/auth-cookies";

export const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/spreadsheets",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/gmail.settings.basic",
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/contacts.readonly",
  "https://www.googleapis.com/auth/contacts.other.readonly",
  "https://www.googleapis.com/auth/directory.readonly",
  "openid",
  "email",
  "profile",
];

const REFRESH_COOKIE = GOOGLE_REFRESH_COOKIE;
const EMAIL_COOKIE = GOOGLE_EMAIL_COOKIE;

function getOAuthConfig() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

  if (!clientId || !clientSecret) return null;

  return {
    clientId,
    clientSecret,
    redirectUri: `${baseUrl}/api/auth/callback`,
  };
}

export function createOAuthClient(): OAuth2Client | null {
  const config = getOAuthConfig();
  if (!config) return null;

  return new google.auth.OAuth2(config.clientId, config.clientSecret, config.redirectUri);
}

export function getOAuthSignInUrl(): string | null {
  const client = createOAuthClient();
  if (!client) return null;

  return client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: GOOGLE_SCOPES,
  });
}

export async function exchangeCodeForTokens(code: string) {
  const client = createOAuthClient();
  if (!client) throw new Error("Google OAuth is not configured");

  const { tokens } = await client.getToken(code);
  client.setCredentials(tokens);

  const oauth2 = google.oauth2({ version: "v2", auth: client });
  const profile = await oauth2.userinfo.get();

  return {
    tokens,
    email: profile.data.email ?? null,
  };
}

export function getServiceAccountAuth() {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const key = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n");

  if (!email || !key) return null;

  return new google.auth.JWT({
    email,
    key,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
}

export async function getGoogleAuthClient(): Promise<OAuth2Client | ReturnType<typeof getServiceAccountAuth> | null> {
  const cookieStore = await cookies();
  const refreshToken = cookieStore.get(REFRESH_COOKIE)?.value;

  if (refreshToken) {
    const client = createOAuthClient();
    if (client) {
      client.setCredentials({ refresh_token: refreshToken });
      return client;
    }
  }

  return getServiceAccountAuth();
}

export async function getSignedInUser(): Promise<{ email: string | null; method: "oauth" | "service-account" | null }> {
  const cookieStore = await cookies();
  const email = cookieStore.get(EMAIL_COOKIE)?.value;
  const refreshToken = cookieStore.get(REFRESH_COOKIE)?.value;

  if (refreshToken) {
    return { email: email ?? null, method: "oauth" };
  }

  if (getServiceAccountAuth()) {
    return { email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL ?? null, method: "service-account" };
  }

  return { email: null, method: null };
}

export function hasGoogleAuth(): boolean {
  return Boolean(getOAuthConfig() || getServiceAccountAuth());
}

export async function hasActiveGoogleAuth(): Promise<boolean> {
  const cookieStore = await cookies();
  if (cookieStore.get(REFRESH_COOKIE)?.value) return true;
  return Boolean(getServiceAccountAuth());
}

export const OAUTH_SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 days

export async function revokeGoogleRefreshToken(refreshToken: string): Promise<boolean> {
  const client = createOAuthClient();
  if (!client) {
    try {
      const res = await fetch(
        `https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(refreshToken)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
        }
      );
      return res.ok;
    } catch {
      return false;
    }
  }
  try {
    await client.revokeToken(refreshToken);
    return true;
  } catch {
    return false;
  }
}

export const AUTH_COOKIES = {
  refresh: REFRESH_COOKIE,
  email: EMAIL_COOKIE,
};
