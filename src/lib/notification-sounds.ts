/** Built-in and custom notification sounds for inbound alerts and outbound sends. */

export type SoundChannel = "inbound" | "outbound";

export type BuiltinSoundOption = {
  id: string;
  label: string;
  channel: SoundChannel;
  src: string;
};

export type CustomSoundRecord = {
  id: string;
  name: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
};

/** Special preference values (not file-backed). */
export const SOUND_OFF_ID = "off";
export const SOUND_CLASSIC_ID = "classic";

export const MAX_CUSTOM_SOUND_BYTES = 512 * 1024; // 512 KB
export const MAX_CUSTOM_SOUNDS = 10;
export const ALLOWED_SOUND_EXTENSIONS = [".mp3", ".wav", ".ogg"] as const;
export const ALLOWED_SOUND_MIME_TYPES = [
  "audio/mpeg",
  "audio/mp3",
  "audio/wav",
  "audio/wave",
  "audio/x-wav",
  "audio/ogg",
  "application/ogg",
] as const;

export const BUILTIN_INBOUND_SOUNDS: BuiltinSoundOption[] = [
  {
    id: "builtin:inbound:inbound001",
    label: "Inbound 1",
    channel: "inbound",
    src: "/sounds/inbound/inbound001.mp3",
  },
  {
    id: "builtin:inbound:inbound002",
    label: "Inbound 2",
    channel: "inbound",
    src: "/sounds/inbound/inbound002.mp3",
  },
  {
    id: "builtin:inbound:inbound003",
    label: "Inbound 3",
    channel: "inbound",
    src: "/sounds/inbound/inbound003.mp3",
  },
  {
    id: "builtin:inbound:inbound004",
    label: "Inbound 4",
    channel: "inbound",
    src: "/sounds/inbound/inbound004.mp3",
  },
  {
    id: "builtin:inbound:inbound005",
    label: "Inbound 5",
    channel: "inbound",
    src: "/sounds/inbound/inbound005.mp3",
  },
  {
    id: "builtin:inbound:inbound006",
    label: "Inbound 6",
    channel: "inbound",
    src: "/sounds/inbound/inbound006.mp3",
  },
];

export const BUILTIN_OUTBOUND_SOUNDS: BuiltinSoundOption[] = [
  {
    id: "builtin:outbound:swoosh001",
    label: "Swoosh 1",
    channel: "outbound",
    src: "/sounds/outbound/swoosh001.mp3",
  },
  {
    id: "builtin:outbound:swoosh002",
    label: "Swoosh 2",
    channel: "outbound",
    src: "/sounds/outbound/swoosh002.mp3",
  },
  {
    id: "builtin:outbound:swoosh003",
    label: "Swoosh 3",
    channel: "outbound",
    src: "/sounds/outbound/swoosh003.mp3",
  },
];

export const DEFAULT_INBOUND_SOUND_ID = BUILTIN_INBOUND_SOUNDS[0]!.id;
export const DEFAULT_OUTBOUND_SOUND_ID = BUILTIN_OUTBOUND_SOUNDS[0]!.id;

export type NotificationSoundPreferences = {
  inboundSoundId: string;
  outboundSoundId: string;
};

export const DEFAULT_NOTIFICATION_SOUND_PREFERENCES: NotificationSoundPreferences = {
  inboundSoundId: DEFAULT_INBOUND_SOUND_ID,
  outboundSoundId: DEFAULT_OUTBOUND_SOUND_ID,
};

function isCustomSoundId(id: string): boolean {
  return id.startsWith("custom:");
}

function builtinById(id: string): BuiltinSoundOption | undefined {
  return [...BUILTIN_INBOUND_SOUNDS, ...BUILTIN_OUTBOUND_SOUNDS].find((s) => s.id === id);
}

export function customSoundSrc(id: string): string {
  const fileId = id.startsWith("custom:") ? id.slice("custom:".length) : id;
  return `/api/sounds/custom/${encodeURIComponent(fileId)}`;
}

export function resolveSoundSrc(
  soundId: string,
  customSounds: CustomSoundRecord[] = []
): string | null {
  if (!soundId || soundId === SOUND_OFF_ID) return null;
  if (soundId === SOUND_CLASSIC_ID) return null;
  const builtin = builtinById(soundId);
  if (builtin) return builtin.src;
  if (isCustomSoundId(soundId)) {
    const fileId = soundId.slice("custom:".length);
    if (customSounds.length > 0 && !customSounds.some((s) => s.id === fileId)) {
      return null;
    }
    return customSoundSrc(soundId);
  }
  return null;
}

export function normalizeSoundId(
  value: unknown,
  channel: SoundChannel,
  fallback: string
): string {
  if (typeof value !== "string" || !value.trim()) return fallback;
  const id = value.trim();
  if (id === SOUND_OFF_ID || id === SOUND_CLASSIC_ID) return id;
  if (isCustomSoundId(id)) return id;
  const builtin = builtinById(id);
  if (builtin) return builtin.id;
  // Allow using an inbound builtin for outbound and vice versa if id is valid
  void channel;
  return fallback;
}

export function normalizeNotificationSoundPreferences(
  partial: Partial<NotificationSoundPreferences> | null | undefined
): NotificationSoundPreferences {
  return {
    inboundSoundId: normalizeSoundId(
      partial?.inboundSoundId,
      "inbound",
      DEFAULT_INBOUND_SOUND_ID
    ),
    outboundSoundId: normalizeSoundId(
      partial?.outboundSoundId,
      "outbound",
      DEFAULT_OUTBOUND_SOUND_ID
    ),
  };
}

export function extensionForMime(mimeType: string): string | null {
  const mime = mimeType.toLowerCase();
  if (mime === "audio/mpeg" || mime === "audio/mp3") return ".mp3";
  if (mime === "audio/wav" || mime === "audio/wave" || mime === "audio/x-wav") return ".wav";
  if (mime === "audio/ogg" || mime === "application/ogg") return ".ogg";
  return null;
}

export function isAllowedSoundFile(fileName: string, mimeType: string, sizeBytes: number): string | null {
  if (sizeBytes <= 0) return "File is empty";
  if (sizeBytes > MAX_CUSTOM_SOUND_BYTES) {
    return `File must be ${Math.round(MAX_CUSTOM_SOUND_BYTES / 1024)} KB or smaller`;
  }
  const lower = fileName.toLowerCase();
  const hasExt = ALLOWED_SOUND_EXTENSIONS.some((ext) => lower.endsWith(ext));
  const mimeOk =
    ALLOWED_SOUND_MIME_TYPES.includes(mimeType.toLowerCase() as (typeof ALLOWED_SOUND_MIME_TYPES)[number]) ||
    mimeType === "" ||
    mimeType === "application/octet-stream";
  if (!hasExt && !extensionForMime(mimeType)) {
    return "Use an MP3, WAV, or OGG audio file";
  }
  if (!hasExt && !mimeOk) {
    return "Use an MP3, WAV, or OGG audio file";
  }
  return null;
}

let configuredSounds: NotificationSoundPreferences = {
  ...DEFAULT_NOTIFICATION_SOUND_PREFERENCES,
};

export function configureNotificationSounds(prefs: NotificationSoundPreferences): void {
  configuredSounds = normalizeNotificationSoundPreferences(prefs);
}

export function getConfiguredNotificationSounds(): NotificationSoundPreferences {
  return configuredSounds;
}

let activeAudio: HTMLAudioElement | null = null;

function stopActiveAudio(): void {
  if (!activeAudio) return;
  activeAudio.pause();
  activeAudio.src = "";
  activeAudio = null;
}

/** Plays a classic two-tone chime via Web Audio (no file). */
export function playClassicChime(): void {
  if (typeof window === "undefined") return;
  const AudioCtx =
    window.AudioContext ??
    (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioCtx) return;

  const ctx = new AudioCtx();
  const startTones = () => {
    const now = ctx.currentTime;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.12, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.65);
    gain.connect(ctx.destination);

    const tones = [880, 1174.66];
    for (let i = 0; i < tones.length; i += 1) {
      const start = now + i * 0.09;
      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.setValueAtTime(tones[i]!, start);
      osc.connect(gain);
      osc.start(start);
      osc.stop(start + 0.45);
    }

    window.setTimeout(() => {
      void ctx.close();
    }, 800);
  };

  if (ctx.state === "suspended") {
    void ctx.resume().then(startTones).catch(() => {});
  } else {
    startTones();
  }
}

export async function playSoundById(
  soundId: string,
  options?: { customSounds?: CustomSoundRecord[] }
): Promise<void> {
  if (typeof window === "undefined") return;
  if (!soundId || soundId === SOUND_OFF_ID) return;

  if (soundId === SOUND_CLASSIC_ID) {
    playClassicChime();
    return;
  }

  const src = resolveSoundSrc(soundId, options?.customSounds);
  if (!src) return;

  stopActiveAudio();
  const audio = new Audio(src);
  audio.volume = 0.7;
  activeAudio = audio;
  try {
    await audio.play();
  } catch {
    /* Autoplay may be blocked until the user interacts with the page. */
  }
}

export function playInboundNotificationSound(): void {
  void playSoundById(configuredSounds.inboundSoundId);
}

export function playOutboundSendSound(): void {
  void playSoundById(configuredSounds.outboundSoundId);
}
