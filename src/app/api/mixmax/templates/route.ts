import { NextResponse } from "next/server";
import { fetchMixmaxTemplates, isMixmaxConfigured } from "@/lib/mixmax";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!isMixmaxConfigured()) {
    return NextResponse.json({ enabled: false, templates: [] });
  }

  const { searchParams } = new URL(request.url);
  const search = searchParams.get("search") ?? undefined;

  try {
    const templates = await fetchMixmaxTemplates(search);
    return NextResponse.json({ enabled: true, templates });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load Mixmax templates";
    return NextResponse.json({ enabled: true, error: message, templates: [] }, { status: 500 });
  }
}
