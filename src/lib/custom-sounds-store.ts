import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";
import {
  ALLOWED_SOUND_EXTENSIONS,
  extensionForMime,
  isAllowedSoundFile,
  MAX_CUSTOM_SOUNDS,
  type CustomSoundRecord,
} from "./notification-sounds";

const SOUNDS_DIR =
  process.env.CUSTOM_SOUNDS_PATH ||
  path.join(process.cwd(), "data", "custom-sounds");
const META_PATH = path.join(SOUNDS_DIR, "meta.json");

function ensureDir(): void {
  if (!fs.existsSync(SOUNDS_DIR)) fs.mkdirSync(SOUNDS_DIR, { recursive: true });
}

function readMeta(): CustomSoundRecord[] {
  ensureDir();
  if (!fs.existsSync(META_PATH)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(META_PATH, "utf8")) as {
      sounds?: CustomSoundRecord[];
    };
    return Array.isArray(parsed.sounds) ? parsed.sounds : [];
  } catch {
    return [];
  }
}

function writeMeta(sounds: CustomSoundRecord[]): void {
  ensureDir();
  fs.writeFileSync(
    META_PATH,
    JSON.stringify({ updatedAt: new Date().toISOString(), sounds }, null, 2),
    "utf8"
  );
}

function filePathFor(record: CustomSoundRecord): string {
  return path.join(SOUNDS_DIR, record.filename);
}

export function listCustomSounds(): CustomSoundRecord[] {
  return readMeta().sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export function getCustomSound(id: string): CustomSoundRecord | null {
  return readMeta().find((s) => s.id === id) ?? null;
}

export function readCustomSoundFile(
  id: string
): { record: CustomSoundRecord; buffer: Buffer } | null {
  const record = getCustomSound(id);
  if (!record) return null;
  const filePath = filePathFor(record);
  if (!fs.existsSync(filePath)) return null;
  return { record, buffer: fs.readFileSync(filePath) };
}

function pickExtension(fileName: string, mimeType: string): string {
  const lower = fileName.toLowerCase();
  for (const ext of ALLOWED_SOUND_EXTENSIONS) {
    if (lower.endsWith(ext)) return ext;
  }
  return extensionForMime(mimeType) ?? ".mp3";
}

export function saveCustomSound(input: {
  originalName: string;
  mimeType: string;
  buffer: Buffer;
}): CustomSoundRecord {
  const sounds = readMeta();
  if (sounds.length >= MAX_CUSTOM_SOUNDS) {
    throw new Error(`You can upload at most ${MAX_CUSTOM_SOUNDS} custom sounds`);
  }

  const validationError = isAllowedSoundFile(
    input.originalName,
    input.mimeType,
    input.buffer.byteLength
  );
  if (validationError) throw new Error(validationError);

  ensureDir();
  const id = randomUUID();
  const ext = pickExtension(input.originalName, input.mimeType);
  const filename = `${id}${ext}`;
  const baseName = path.basename(input.originalName, path.extname(input.originalName)).trim();
  const name = baseName || `Custom sound ${sounds.length + 1}`;

  let mimeType = input.mimeType;
  if (!mimeType || mimeType === "application/octet-stream") {
    if (ext === ".mp3") mimeType = "audio/mpeg";
    else if (ext === ".wav") mimeType = "audio/wav";
    else if (ext === ".ogg") mimeType = "audio/ogg";
    else mimeType = "audio/mpeg";
  }

  const record: CustomSoundRecord = {
    id,
    name: name.slice(0, 80),
    filename,
    mimeType,
    sizeBytes: input.buffer.byteLength,
    createdAt: new Date().toISOString(),
  };

  fs.writeFileSync(path.join(SOUNDS_DIR, filename), input.buffer);
  writeMeta([...sounds, record]);
  return record;
}

export function deleteCustomSound(id: string): boolean {
  const sounds = readMeta();
  const record = sounds.find((s) => s.id === id);
  if (!record) return false;

  const filePath = filePathFor(record);
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  writeMeta(sounds.filter((s) => s.id !== id));
  return true;
}
