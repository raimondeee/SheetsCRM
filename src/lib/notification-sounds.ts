/** Built-in and custom notification sounds for inbound, outbound, and calendar alerts. */

export type SoundChannel = "inbound" | "outbound" | "calendar";

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
/** Three-tone Web Audio chime (optional alternate for calendar reminders). */
export const SOUND_CALENDAR_ID = "calendar";

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

export const BUILTIN_CALENDAR_SOUNDS: BuiltinSoundOption[] = [
  {
    id: "builtin:calendar:calendar001",
    label: "Calendar 1",
    channel: "calendar",
    src: "/sounds/calendar/calendar001.mp3",
  },
  {
    id: "builtin:calendar:calendar002",
    label: "Calendar 2",
    channel: "calendar",
    src: "/sounds/calendar/calendar002.mp3",
  },
  {
    id: "builtin:calendar:calendar003",
    label: "Calendar 3",
    channel: "calendar",
    src: "/sounds/calendar/calendar003.mp3",
  },
  {
    id: "builtin:calendar:calendar004",
    label: "Calendar 4",
    channel: "calendar",
    src: "/sounds/calendar/calendar004.mp3",
  },
  {
    id: "builtin:calendar:calendar005",
    label: "Calendar 5",
    channel: "calendar",
    src: "/sounds/calendar/calendar005.mp3",
  },
  {
    id: "builtin:calendar:calendar006",
    label: "Calendar 6",
    channel: "calendar",
    src: "/sounds/calendar/calendar006.mp3",
  },
  {
    id: "builtin:calendar:calendar007",
    label: "Calendar 7",
    channel: "calendar",
    src: "/sounds/calendar/calendar007.mp3",
  },
  {
    id: "builtin:calendar:calendar008",
    label: "Calendar 8",
    channel: "calendar",
    src: "/sounds/calendar/calendar008.mp3",
  },
];

export const DEFAULT_INBOUND_SOUND_ID = BUILTIN_INBOUND_SOUNDS[0]!.id;
export const DEFAULT_OUTBOUND_SOUND_ID = BUILTIN_OUTBOUND_SOUNDS[0]!.id;
export const DEFAULT_CALENDAR_SOUND_ID = BUILTIN_CALENDAR_SOUNDS[0]!.id;

export type NotificationSoundPreferences = {
  inboundSoundId: string;
  outboundSoundId: string;
  calendarSoundId: string;
};

export const DEFAULT_NOTIFICATION_SOUND_PREFERENCES: NotificationSoundPreferences = {
  inboundSoundId: DEFAULT_INBOUND_SOUND_ID,
  outboundSoundId: DEFAULT_OUTBOUND_SOUND_ID,
  calendarSoundId: DEFAULT_CALENDAR_SOUND_ID,
};

function isCustomSoundId(id: string): boolean {
  return id.startsWith("custom:");
}

function builtinById(id: string): BuiltinSoundOption | undefined {
  return [
    ...BUILTIN_INBOUND_SOUNDS,
    ...BUILTIN_OUTBOUND_SOUNDS,
    ...BUILTIN_CALENDAR_SOUNDS,
  ].find((s) => s.id === id);
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
  if (soundId === SOUND_CLASSIC_ID || soundId === SOUND_CALENDAR_ID) return null;
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
  if (id === SOUND_CALENDAR_ID) return id;
  if (isCustomSoundId(id)) return id;
  const builtin = builtinById(id);
  if (builtin) return builtin.id;
  // Allow using an inbound builtin for outbound/calendar and vice versa if id is valid
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
    calendarSoundId: normalizeSoundId(
      partial?.calendarSoundId,
      "calendar",
      DEFAULT_CALENDAR_SOUND_ID
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

function playWebAudioChime(tones: number[], options?: {
  type?: OscillatorType;
  step?: number;
  noteDuration?: number;
  peakGain?: number;
  fadeMs?: number;
}): void {
  if (typeof window === "undefined") return;
  const AudioCtx =
    window.AudioContext ??
    (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioCtx) return;

  const type = options?.type ?? "sine";
  const step = options?.step ?? 0.09;
  const noteDuration = options?.noteDuration ?? 0.45;
  const peakGain = options?.peakGain ?? 0.12;
  const fadeMs = options?.fadeMs ?? 800;

  const ctx = new AudioCtx();
  const startTones = () => {
    const now = ctx.currentTime;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(peakGain, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + fadeMs / 1000);
    gain.connect(ctx.destination);

    for (let i = 0; i < tones.length; i += 1) {
      const start = now + i * step;
      const osc = ctx.createOscillator();
      osc.type = type;
      osc.frequency.setValueAtTime(tones[i]!, start);
      osc.connect(gain);
      osc.start(start);
      osc.stop(start + noteDuration);
    }

    window.setTimeout(() => {
      void ctx.close();
    }, fadeMs + 50);
  };

  if (ctx.state === "suspended") {
    void ctx.resume().then(startTones).catch(() => {});
  } else {
    startTones();
  }
}

/** Plays a classic two-tone chime via Web Audio (no file). */
export function playClassicChime(): void {
  playWebAudioChime([880, 1174.66]);
}

/** Three-tone alert for upcoming calendar events (no file). */
export function playCalendarChime(): void {
  playWebAudioChime([659.25, 880, 1046.5], {
    type: "triangle",
    step: 0.12,
    noteDuration: 0.35,
    peakGain: 0.18,
    fadeMs: 900,
  });
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

  if (soundId === SOUND_CALENDAR_ID) {
    playCalendarChime();
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

export function playCalendarReminderSound(): void {
  void playSoundById(configuredSounds.calendarSoundId);
}
