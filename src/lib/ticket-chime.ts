import { normalizeStatusId } from "./status-mapper";
import type { Ticket } from "./types";

export type TicketChimeSnapshot = {
  status: string;
  lastResponseAt: string | null;
};

export function buildTicketChimeSnapshots(
  tickets: Ticket[]
): Map<string, TicketChimeSnapshot> {
  return new Map(
    tickets.map((t) => [
      t.rowId,
      {
        status: normalizeStatusId(t.status),
        lastResponseAt: t.lastResponseAt,
      },
    ])
  );
}

/** True when a silent refresh should play the new-ticket chime. */
export function shouldPlayTicketChime(
  previous: Map<string, TicketChimeSnapshot>,
  tickets: Ticket[]
): boolean {
  const next = buildTicketChimeSnapshots(tickets);

  for (const rowId of next.keys()) {
    if (!previous.has(rowId)) return true;
  }

  for (const [rowId, prevSnap] of previous) {
    const nextSnap = next.get(rowId);
    if (!nextSnap) continue;
    if (
      prevSnap.status === "pending" &&
      nextSnap.status === "open" &&
      nextSnap.lastResponseAt !== prevSnap.lastResponseAt
    ) {
      return true;
    }
  }

  return false;
}

let audioContext: AudioContext | null = null;
let unlockListenersAttached = false;

function getAudioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!audioContext) {
    const AudioCtx =
      window.AudioContext ??
      (window as typeof window & { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!AudioCtx) return null;
    audioContext = new AudioCtx();
  }
  return audioContext;
}

export function unlockTicketChimeAudio(): void {
  const ctx = getAudioContext();
  if (!ctx) return;
  if (ctx.state === "suspended") {
    void ctx.resume();
  }
}

/** Call once in the CRM shell so the first click/keypress unlocks audio playback. */
export function attachTicketChimeUnlockListeners(): () => void {
  if (typeof window === "undefined" || unlockListenersAttached) {
    return () => {};
  }
  unlockListenersAttached = true;

  const unlock = () => {
    unlockTicketChimeAudio();
    window.removeEventListener("pointerdown", unlock);
    window.removeEventListener("keydown", unlock);
  };

  window.addEventListener("pointerdown", unlock);
  window.addEventListener("keydown", unlock);

  return () => {
    window.removeEventListener("pointerdown", unlock);
    window.removeEventListener("keydown", unlock);
    unlockListenersAttached = false;
  };
}

export function playTicketChime(): void {
  const ctx = getAudioContext();
  if (!ctx || ctx.state !== "running") return;

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
}

/** Three-tone alert for upcoming calendar events. */
export function playCalendarReminderSound(): void {
  const ctx = getAudioContext();
  if (!ctx || ctx.state !== "running") return;

  const now = ctx.currentTime;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.18, now + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.9);
  gain.connect(ctx.destination);

  const tones = [659.25, 880, 1046.5];
  for (let i = 0; i < tones.length; i += 1) {
    const start = now + i * 0.12;
    const osc = ctx.createOscillator();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(tones[i]!, start);
    osc.connect(gain);
    osc.start(start);
    osc.stop(start + 0.35);
  }
}
