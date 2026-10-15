"use client";

import {
  DEFAULT_BUSINESS_HOURS,
  formatBusinessHoursLabel,
  normalizeBusinessHours,
  type BusinessHoursConfig,
} from "@/lib/business-hours";

const WEEKDAY_OPTIONS = [
  { value: 1, label: "Mon" },
  { value: 2, label: "Tue" },
  { value: 3, label: "Wed" },
  { value: 4, label: "Thu" },
  { value: 5, label: "Fri" },
  { value: 6, label: "Sat" },
  { value: 0, label: "Sun" },
];

const HOUR_OPTIONS = Array.from({ length: 24 }, (_, i) => i);

interface BusinessHoursPanelProps {
  value: BusinessHoursConfig | undefined;
  onChange: (value: BusinessHoursConfig) => void;
}

export function BusinessHoursPanel({ value, onChange }: BusinessHoursPanelProps) {
  const hours = normalizeBusinessHours(value);

  function patch(partial: Partial<BusinessHoursConfig>) {
    onChange(normalizeBusinessHours({ ...hours, ...partial }));
  }

  function toggleWeekday(day: number) {
    const next = hours.weekdays.includes(day)
      ? hours.weekdays.filter((d) => d !== day)
      : [...hours.weekdays, day];
    patch({ weekdays: next });
  }

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-sm font-semibold text-zendesk-navy">Business hours</h3>
        <p className="mt-1 text-sm text-zendesk-muted">
          Used for service metrics and the initial-response flag. Time outside these hours does
          not count — including intakes submitted after hours (the clock starts at the next open
          window). US federal holidays from the shared Google Holidays calendar are also excluded.
          Inbox response-SLA tags pause Friday 5:00 PM–Monday 7:00 AM Pacific instead (weeknights
          still count). Pending auto-reopen uses weekday hours (24h on workdays, weekends excluded),
          not this schedule.
        </p>
        <p className="mt-2 text-xs text-zendesk-muted">
          Current schedule: <strong>{formatBusinessHoursLabel(hours)}</strong>
        </p>
      </div>

      <div>
        <p className="text-sm font-medium">Working days</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {WEEKDAY_OPTIONS.map((day) => {
            const active = hours.weekdays.includes(day.value);
            return (
              <button
                key={day.value}
                type="button"
                onClick={() => toggleWeekday(day.value)}
                className={`rounded border px-3 py-1.5 text-sm ${
                  active
                    ? "border-zendesk-teal bg-zendesk-teal/10 text-zendesk-navy"
                    : "border-zendesk-border bg-white text-zendesk-muted hover:bg-gray-50"
                }`}
              >
                {day.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block text-sm">
          <span className="font-medium">Start hour</span>
          <select
            value={hours.startHour}
            onChange={(e) => patch({ startHour: Number(e.target.value) })}
            className="mt-1 w-full rounded border border-zendesk-border px-3 py-2 text-sm"
          >
            {HOUR_OPTIONS.map((h) => (
              <option key={h} value={h}>
                {formatHour(h)}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          <span className="font-medium">End hour</span>
          <select
            value={hours.endHour}
            onChange={(e) => patch({ endHour: Number(e.target.value) })}
            className="mt-1 w-full rounded border border-zendesk-border px-3 py-2 text-sm"
          >
            {HOUR_OPTIONS.map((h) => (
              <option key={h} value={h + 1}>
                {formatHour(h + 1)}
              </option>
            ))}
            <option value={24}>12:00 AM (midnight)</option>
          </select>
        </label>
      </div>

      <label className="block text-sm">
        <span className="font-medium">Timezone (optional)</span>
        <input
          type="text"
          value={hours.timezone ?? ""}
          onChange={(e) => patch({ timezone: e.target.value || undefined })}
          placeholder="e.g. America/Los_Angeles (leave blank for server local)"
          className="mt-1 w-full rounded border border-zendesk-border px-3 py-2 text-sm"
        />
      </label>

      <button
        type="button"
        onClick={() => onChange({ ...DEFAULT_BUSINESS_HOURS })}
        className="text-xs text-zendesk-muted underline hover:text-zendesk-navy"
      >
        Reset to Mon–Fri 9:00 AM–5:00 PM
      </button>
    </div>
  );
}

function formatHour(hour: number): string {
  const h = ((hour % 24) + 24) % 24;
  const suffix = h >= 12 ? "PM" : "AM";
  const display = h % 12 === 0 ? 12 : h % 12;
  return `${display}:00 ${suffix}`;
}
