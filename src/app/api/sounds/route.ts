import { NextResponse } from "next/server";
import { deleteCustomSound, listCustomSounds, saveCustomSound } from "@/lib/custom-sounds-store";
import {
  BUILTIN_INBOUND_SOUNDS,
  BUILTIN_OUTBOUND_SOUNDS,
  MAX_CUSTOM_SOUND_BYTES,
  MAX_CUSTOM_SOUNDS,
} from "@/lib/notification-sounds";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    builtin: {
      inbound: BUILTIN_INBOUND_SOUNDS,
      outbound: BUILTIN_OUTBOUND_SOUNDS,
    },
    custom: listCustomSounds(),
    limits: {
      maxCustomSounds: MAX_CUSTOM_SOUNDS,
      maxBytes: MAX_CUSTOM_SOUND_BYTES,
      formats: ["mp3", "wav", "ogg"],
    },
  });
}

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Choose an audio file to upload" }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const record = saveCustomSound({
      originalName: file.name || "sound.mp3",
      mimeType: file.type || "",
      buffer,
    });

    return NextResponse.json({ ok: true, sound: record, custom: listCustomSounds() });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to upload sound";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function DELETE(request: Request) {
  try {
    const body = (await request.json()) as { id?: string };
    const id = typeof body.id === "string" ? body.id.trim() : "";
    if (!id) {
      return NextResponse.json({ error: "Missing sound id" }, { status: 400 });
    }
    const deleted = deleteCustomSound(id);
    if (!deleted) {
      return NextResponse.json({ error: "Sound not found" }, { status: 404 });
    }
    return NextResponse.json({ ok: true, custom: listCustomSounds() });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to delete sound";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
