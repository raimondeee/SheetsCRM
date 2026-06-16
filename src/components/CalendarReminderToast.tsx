"use client";

import { Calendar, ExternalLink, X } from "lucide-react";
import { formatCalendarReminderLead, type CalendarReminderEvent } from "@/lib/calendar-reminders";

interface CalendarReminderToastProps {
  event: CalendarReminderEvent;
  onDismiss: () => void;
}

export function CalendarReminderToast({ event, onDismiss }: CalendarReminderToastProps) {
  const startLabel = new Date(event.start).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });

  return (
    <div
      role="status"
      aria-live="assertive"
      className="pointer-events-auto w-full max-w-sm overflow-hidden rounded-lg border-2 border-amber-200 bg-gradient-to-br from-amber-500 to-orange-600 text-white shadow-2xl shadow-orange-900/30"
    >
      <div className="flex items-start gap-3 p-4">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/20">
          <Calendar className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-amber-50/90">
            Calendar · {formatCalendarReminderLead(event.secondsUntilStart)}
          </p>
          <p className="mt-1 line-clamp-2 text-sm font-bold leading-snug">{event.summary}</p>
          <p className="mt-1 text-xs text-amber-50/95">{startLabel}</p>
          {event.htmlLink && (
            <a
              href={event.htmlLink}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-white underline underline-offset-2 hover:text-amber-50"
            >
              Open in Google Calendar
              <ExternalLink className="h-3 w-3" />
            </a>
          )}
        </div>
        <button
          type="button"
          onClick={onDismiss}
          className="shrink-0 rounded p-1 text-white/90 hover:bg-white/15 hover:text-white"
          aria-label="Dismiss calendar reminder"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
