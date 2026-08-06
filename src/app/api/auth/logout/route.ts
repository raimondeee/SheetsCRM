import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import {
  AUTH_COOKIES,
  revokeGoogleRefreshToken,
} from "@/lib/google-auth";

export async function POST() {
  const cookieStore = await cookies();
  const refreshToken = cookieStore.get(AUTH_COOKIES.refresh)?.value;
  let revoked = false;
  if (refreshToken) {
    revoked = await revokeGoogleRefreshToken(refreshToken);
  }

  const response = NextResponse.json({ ok: true, revoked });

  response.cookies.set(AUTH_COOKIES.refresh, "", { maxAge: 0, path: "/" });
  response.cookies.set(AUTH_COOKIES.email, "", { maxAge: 0, path: "/" });

  return response;
}
