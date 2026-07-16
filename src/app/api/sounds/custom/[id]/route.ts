import { NextResponse } from "next/server";
import { readCustomSoundFile } from "@/lib/custom-sounds-store";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const result = readCustomSoundFile(id);
  if (!result) {
    return NextResponse.json({ error: "Sound not found" }, { status: 404 });
  }

  return new NextResponse(new Uint8Array(result.buffer), {
    status: 200,
    headers: {
      "Content-Type": result.record.mimeType || "audio/mpeg",
      "Cache-Control": "private, max-age=3600",
      "Content-Length": String(result.buffer.byteLength),
    },
  });
}
