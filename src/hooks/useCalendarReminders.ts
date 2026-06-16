"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  CALENDAR_REMINDER_POLL_MS,
  CALENDAR_TOAST_AUTO_DISMISS_MS,
  isCalendarTabActive,
  loadNotifiedCalendarEventIds,
  markCalendarEventNotified,
  type CalendarReminderEvent,
} from "@/lib/calendar-reminders";
import { playCalendarReminderSound } from "@/lib/ticket-chime";

export function useCalendarReminders(enabled: boolean) {
  const [toast, setToast] = useState<CalendarReminderEvent | null>(null);
  const notifiedRef = useRef<Set<string>>(new Set());
  const dismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const dismissToast = useCallback(() => {
    if (dismissTimerRef.current) {
      clearTimeout(dismissTimerRef.current);
      dismissTimerRef.current = null;
    }
    setToast(null);
  }, []);

  const showToast = useCallback(
    (event: CalendarReminderEvent) => {
      markCalendarEventNotified(event);
      notifiedRef.current.add(event.id);
      setToast(event);
      playCalendarReminderSound();

      if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current);
      dismissTimerRef.current = setTimeout(() => {
        dismissTimerRef.current = null;
        setToast(null);
      }, CALENDAR_TOAST_AUTO_DISMISS_MS);
    },
    []
  );

  useEffect(() => {
    if (!enabled) return;

    notifiedRef.current = loadNotifiedCalendarEventIds();

    let cancelled = false;

    async function poll() {
      if (!isCalendarTabActive() || cancelled) return;

      try {
        const res = await fetch("/api/calendar/upcoming", { cache: "no-store" });
        const data = (await res.json()) as {
          events?: CalendarReminderEvent[];
          enabled?: boolean;
        };
        if (!data.enabled || cancelled) return;

        const events = [...(data.events ?? [])].sort(
          (a, b) => a.secondsUntilStart - b.secondsUntilStart
        );

        for (const event of events) {
          if (notifiedRef.current.has(event.id)) continue;
          showToast(event);
          break;
        }
      } catch {
        /* ignore transient network errors */
      }
    }

    const intervalId = window.setInterval(() => void poll(), CALENDAR_REMINDER_POLL_MS);
    const onFocus = () => void poll();
    const onVisibility = () => {
      if (document.visibilityState === "visible") void poll();
    };

    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);
    void poll();

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
      if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current);
    };
  }, [enabled, showToast]);

  return { toast, dismissToast };
}
