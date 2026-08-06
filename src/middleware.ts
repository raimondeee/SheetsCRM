/**
 * Global API auth gate: require Google OAuth refresh cookie for /api/* except
 * auth routes (sign-in flow) and /api/env (localhost Host-gated setup before
 * first sign-in). Service accounts do not satisfy this check.
 *
 * USE_MOCK_DATA=true bypasses the gate for local demos with synthetic tickets.
 */
import { NextResponse, type NextRequest } from "next/server";
import { GOOGLE_REFRESH_COOKIE } from "@/lib/auth-cookies";

function isPublicApiPath(pathname: string): boolean {
  if (pathname.startsWith("/api/auth/")) return true;
  if (pathname === "/api/env" || pathname.startsWith("/api/env/")) return true;
  return false;
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (!pathname.startsWith("/api/")) {
    return NextResponse.next();
  }

  if (isPublicApiPath(pathname)) {
    return NextResponse.next();
  }

  if (process.env.USE_MOCK_DATA === "true") {
    return NextResponse.next();
  }

  const refreshToken = request.cookies.get(GOOGLE_REFRESH_COOKIE)?.value;
  if (!refreshToken) {
    return NextResponse.json(
      { error: "Sign in with Google first" },
      { status: 401, headers: { "Cache-Control": "no-store" } }
    );
  }

  return NextResponse.next();
}

export const config = {
  matcher: "/api/:path*",
};
