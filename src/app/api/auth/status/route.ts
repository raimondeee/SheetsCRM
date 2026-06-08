import { NextResponse } from "next/server";
import { getSignedInUser, hasGoogleAuth } from "@/lib/google-auth";

export async function GET() {
  const user = await getSignedInUser();

  return NextResponse.json({
    signedIn: user.method !== null,
    email: user.email,
    method: user.method,
    oauthAvailable: hasGoogleAuth(),
  });
}
