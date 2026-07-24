"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Footprints, X } from "lucide-react";
import type { PomodoroSchedule } from "@/lib/wellness-content";

interface PomodoroBreakModalProps {
  schedule: PomodoroSchedule;
  onDismiss: () => void;
}

function formatCountdown(totalSeconds: number): string {
  const safe = Math.max(0, totalSeconds);
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

export function PomodoroBreakModal({ schedule, onDismiss }: PomodoroBreakModalProps) {
  const [mounted, setMounted] = useState(false);
  const [remainingSeconds, setRemainingSeconds] = useState(
    () => Math.max(1, schedule.breakMinutes) * 60
  );
  const dismissedRef = useRef(false);
  const onDismissRef = useRef(onDismiss);
  onDismissRef.current = onDismiss;

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    dismissedRef.current = false;
    const breakMs = Math.max(1, schedule.breakMinutes) * 60 * 1000;
    const endsAt = Date.now() + breakMs;
    setRemainingSeconds(Math.ceil(breakMs / 1000));

    const intervalId = window.setInterval(() => {
      const leftMs = endsAt - Date.now();
      const leftSeconds = Math.max(0, Math.ceil(leftMs / 1000));
      setRemainingSeconds(leftSeconds);
      if (leftMs > 0 || dismissedRef.current) return;
      dismissedRef.current = true;
      onDismissRef.current();
    }, 250);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [schedule.breakMinutes, schedule.id]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape" || dismissedRef.current) return;
      dismissedRef.current = true;
      onDismiss();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onDismiss]);

  function dismissEarly() {
    if (dismissedRef.current) return;
    dismissedRef.current = true;
    onDismiss();
  }

  if (!mounted) return null;

  return createPortal(
    <div
      role="alertdialog"
      aria-labelledby="pomodoro-break-title"
      aria-describedby="pomodoro-break-desc"
      className="fixed inset-0 z-[70] flex flex-col items-center justify-center bg-gradient-to-br from-emerald-700/95 via-teal-700/95 to-teal-900/95 p-6 text-white"
    >
      <button
        type="button"
        onClick={dismissEarly}
        className="absolute right-4 top-4 rounded-full p-2 text-white/90 hover:bg-white/15 hover:text-white"
        aria-label="Skip movement break"
      >
        <X className="h-6 w-6" />
      </button>

      <div className="flex w-full max-w-lg flex-col items-center text-center">
        <div className="mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-white/20 shadow-lg">
          <Footprints className="h-10 w-10" />
        </div>

        <p
          id="pomodoro-break-desc"
          className="text-sm font-semibold uppercase tracking-[0.2em] text-emerald-50/90"
        >
          Time to move · {schedule.label} ({schedule.nickname})
        </p>

        <p
          className="mt-5 font-mono text-6xl font-bold tabular-nums tracking-tight"
          aria-live="polite"
          aria-atomic="true"
        >
          {formatCountdown(remainingSeconds)}
        </p>
        <p className="mt-2 text-sm text-emerald-50/90">
          Break ends automatically — then your next {schedule.workMinutes}-minute work block
          starts
        </p>

        <h2 id="pomodoro-break-title" className="mt-5 text-3xl font-bold leading-tight">
          {schedule.movement}
        </h2>

        <p className="mt-4 text-base text-emerald-50/95">
          Take about {schedule.breakMinutes} minute
          {schedule.breakMinutes === 1 ? "" : "s"} away from the screen.
        </p>

        <div className="mt-6 w-full rounded-lg border border-white/20 bg-white/10 px-4 py-3 text-left text-sm text-emerald-50/95">
          <p>
            <span className="font-semibold text-white">Why it helps: </span>
            {schedule.benefit}
          </p>
          <p className="mt-2 text-emerald-100/90">
            <span className="font-semibold text-white">Across an 8-hour day: </span>
            {schedule.dailyActivity}
          </p>
        </div>

        <div className="mt-10 flex w-full flex-col gap-3 sm:flex-row sm:justify-center">
          <button
            type="button"
            onClick={dismissEarly}
            className="inline-flex items-center justify-center rounded-lg bg-white px-6 py-3 text-base font-semibold text-teal-800 shadow-lg hover:bg-emerald-50"
          >
            Skip break
          </button>
          <button
            type="button"
            onClick={dismissEarly}
            className="inline-flex items-center justify-center rounded-lg border-2 border-white/40 bg-white/10 px-6 py-3 text-base font-semibold text-white hover:bg-white/20"
          >
            Ignore
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
