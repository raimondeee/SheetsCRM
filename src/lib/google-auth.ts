import { google } from "googleapis";
import type { OAuth2Client } from "google-auth-library";
import { cookies } from "next/headers";

export const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/spreadsheets",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/gmail.settings.basic",
  "openid",
  "email",
  "profile",
];

const REFRESH_COOKIE = "google_refresh_token";
const EMAIL_COOKIE = "google_user_email";

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

export const AUTH_COOKIES = {
  refresh: REFRESH_COOKIE,
  email: EMAIL_COOKIE,
};
