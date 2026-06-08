import { NextResponse } from "next/server";
import { AUTH_COOKIES } from "@/lib/google-auth";

export async function POST() {
  const response = NextResponse.json({ ok: true });

  response.cookies.set(AUTH_COOKIES.refresh, "", { maxAge: 0, path: "/" });
  response.cookies.set(AUTH_COOKIES.email, "", { maxAge: 0, path: "/" });

  return response;
}
