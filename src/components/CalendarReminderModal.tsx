"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Calendar, ExternalLink, X } from "lucide-react";
import {
  formatCalendarEventWhen,
  formatCalendarReminderLead,
  type CalendarReminderEvent,
} from "@/lib/calendar-reminders";

interface CalendarReminderModalProps {
  event: CalendarReminderEvent;
  onDismiss: () => void;
}

export function CalendarReminderModal({ event, onDismiss }: CalendarReminderModalProps) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    function onKeyDown(keyEvent: KeyboardEvent) {
      if (keyEvent.key === "Escape") onDismiss();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onDismiss]);

  if (!mounted) return null;

  const whenLabel = formatCalendarEventWhen(event.start, false);
  const openUrl = event.htmlLink;

  return createPortal(
    <div
      role="alertdialog"
      aria-labelledby="calendar-reminder-title"
      aria-describedby="calendar-reminder-desc"
      className="fixed inset-0 z-[70] flex flex-col items-center justify-center bg-gradient-to-br from-amber-600/95 via-orange-600/95 to-orange-700/95 p-6 text-white"
    >
      <button
        type="button"
        onClick={onDismiss}
        className="absolute right-4 top-4 rounded-full p-2 text-white/90 hover:bg-white/15 hover:text-white"
        aria-label="Dismiss calendar reminder"
      >
        <X className="h-6 w-6" />
      </button>

      <div className="flex w-full max-w-lg flex-col items-center text-center">
        <div className="mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-white/20 shadow-lg">
          <Calendar className="h-10 w-10" />
        </div>

        <p
          id="calendar-reminder-desc"
          className="text-sm font-semibold uppercase tracking-[0.2em] text-amber-50/90"
        >
          {formatCalendarReminderLead(event.secondsUntilStart)}
        </p>

        <h2 id="calendar-reminder-title" className="mt-3 text-3xl font-bold leading-tight">
          {event.summary}
        </h2>

        <p className="mt-4 text-lg text-amber-50/95">{whenLabel}</p>

        <div className="mt-10 flex w-full flex-col gap-3 sm:flex-row sm:justify-center">
          {openUrl ? (
            <a
              href={openUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-white px-6 py-3 text-base font-semibold text-orange-700 shadow-lg hover:bg-amber-50"
            >
              Open in Google Calendar
              <ExternalLink className="h-4 w-4" />
            </a>
          ) : null}
          <button
            type="button"
            onClick={onDismiss}
            className="inline-flex items-center justify-center rounded-lg border-2 border-white/40 bg-white/10 px-6 py-3 text-base font-semibold text-white hover:bg-white/20"
          >
            Dismiss
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
