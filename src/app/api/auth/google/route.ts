import { NextResponse } from "next/server";
import { getOAuthSignInUrl } from "@/lib/google-auth";

export async function GET() {
  const url = getOAuthSignInUrl();

  if (!url) {
    return NextResponse.json(
      {
        error:
          "Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env, then add http://localhost:3000/api/auth/callback as an authorized redirect URI in Google Cloud Console.",
      },
      { status: 400 }
    );
  }

  return NextResponse.redirect(url);
}
