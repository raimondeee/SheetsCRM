/**
 * OAuth callback: exchange code for tokens and set httpOnly refresh-token cookie
 * (plus email cookie for display). Refresh token never exposed to client JS.
 * Session cookies expire after OAUTH_SESSION_MAX_AGE_SECONDS (30 days).
 */
import { NextResponse } from "next/server";
import {
  AUTH_COOKIES,
  exchangeCodeForTokens,
  OAUTH_SESSION_MAX_AGE_SECONDS,
} from "@/lib/google-auth";
import { recordAuthHandler, withApiRequestLog } from "@/lib/ops-diagnostics";

export async function GET(request: Request) {
  return withApiRequestLog(request, "/api/auth/callback", () => handleGet(request));
}

async function handleGet(request: Request) {
  const started = Date.now();
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const error = searchParams.get("error");

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

  if (error) {
    recordAuthHandler({
      name: "callback",
      ok: false,
      durationMs: Date.now() - started,
      error,
    });
    return NextResponse.redirect(`${baseUrl}/?auth_error=${encodeURIComponent(error)}`);
  }

  if (!code) {
    recordAuthHandler({
      name: "callback",
      ok: false,
      durationMs: Date.now() - started,
      error: "missing_code",
    });
    return NextResponse.redirect(`${baseUrl}/?auth_error=missing_code`);
  }

  try {
    const { tokens, email } = await exchangeCodeForTokens(code);
    recordAuthHandler({
      name: "callback",
      ok: true,
      durationMs: Date.now() - started,
    });
    const response = NextResponse.redirect(`${baseUrl}/?signed_in=1`);

    if (tokens.refresh_token) {
      response.cookies.set(AUTH_COOKIES.refresh, tokens.refresh_token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        maxAge: OAUTH_SESSION_MAX_AGE_SECONDS,
        path: "/",
      });
    }

    if (email) {
      response.cookies.set(AUTH_COOKIES.email, email, {
        httpOnly: false,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        maxAge: OAUTH_SESSION_MAX_AGE_SECONDS,
        path: "/",
      });
    }

    return response;
  } catch (e) {
    const message = e instanceof Error ? e.message : "auth_failed";
    recordAuthHandler({
      name: "callback",
      ok: false,
      durationMs: Date.now() - started,
      error: message,
    });
    return NextResponse.redirect(`${baseUrl}/?auth_error=${encodeURIComponent(message)}`);
  }
}
