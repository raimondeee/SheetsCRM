"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  getPomodoroSchedule,
  type PomodoroSchedule,
  type PomodoroScheduleId,
} from "@/lib/wellness-content";

function isTabActive(): boolean {
  if (typeof document === "undefined") return false;
  return document.visibilityState === "visible";
}

/**
 * Pomodoro phases are sequential:
 * 1. Work block (workMinutes) — break overlay stays closed
 * 2. Break overlay — countdown runs for breakMinutes; work timer is not armed
 * 3. On dismiss (auto or early) — a fresh full work block starts
 *
 * Break time never overlaps the work countdown.
 */
export function usePomodoroBreakReminders(options: {
  enabled: boolean;
  scheduleId: PomodoroScheduleId;
}) {
  const { enabled, scheduleId } = options;
  const [overlay, setOverlay] = useState<PomodoroSchedule | null>(null);
  const overlayOpenRef = useRef(false);
  /** Wall-clock end of the current work block. Null while a break overlay is showing. */
  const workDeadlineRef = useRef<number | null>(null);

  const schedule = getPomodoroSchedule(scheduleId);

  const armNextWorkPeriod = useCallback(() => {
    workDeadlineRef.current = Date.now() + schedule.workMinutes * 60 * 1000;
  }, [schedule.workMinutes]);

  const dismiss = useCallback(() => {
    if (!overlayOpenRef.current) return;
    overlayOpenRef.current = false;
    setOverlay(null);
    // Work timer starts only after the break ends (or is skipped).
    armNextWorkPeriod();
  }, [armNextWorkPeriod]);

  useEffect(() => {
    overlayOpenRef.current = false;
    setOverlay(null);
    workDeadlineRef.current = null;

    if (!enabled) return;

    armNextWorkPeriod();

    const intervalId = window.setInterval(() => {
      // While the break overlay is open, do not advance or start a work block.
      if (!isTabActive() || overlayOpenRef.current) return;
      const deadline = workDeadlineRef.current;
      if (deadline == null || Date.now() < deadline) return;
      workDeadlineRef.current = null;
      overlayOpenRef.current = true;
      setOverlay(getPomodoroSchedule(scheduleId));
    }, 1000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [enabled, scheduleId, armNextWorkPeriod]);

  return {
    overlay,
    dismiss,
    schedule,
  };
}
