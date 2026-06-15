/** Workspace timer defaults — overridable in user preferences. */
export interface TimerSettings {
  /** Pending → Open after this many business hours (Mon–Fri 9–17 local). */
  pendingReopenBusinessHours: number;
  /** Longterm Hold / on_hold → Open after this many calendar days. */
  longtermHoldReopenDays: number;
  /** Flag tickets with no outbound reply after this many hours since intake. */
  initialResponseHours: number;
  /** Default Response SLA hours — due time is anchored on the customer's last message. */
  defaultSlaHours: number;
}

export const DEFAULT_TIMER_SETTINGS: TimerSettings = {
  pendingReopenBusinessHours: 72,
  longtermHoldReopenDays: 7,
  initialResponseHours: 48,
  defaultSlaHours: 48,
};

export const SLA_HOUR_OPTIONS = [4, 8, 24, 48, 72] as const;

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  const rounded = Math.round(value);
  return Math.min(max, Math.max(min, rounded));
}

export function normalizeTimerSettings(
  partial: Partial<TimerSettings> | null | undefined
): TimerSettings {
  return {
    pendingReopenBusinessHours: clampInt(
      partial?.pendingReopenBusinessHours,
      DEFAULT_TIMER_SETTINGS.pendingReopenBusinessHours,
      1,
      500
    ),
    longtermHoldReopenDays: clampInt(
      partial?.longtermHoldReopenDays,
      DEFAULT_TIMER_SETTINGS.longtermHoldReopenDays,
      1,
      365
    ),
    initialResponseHours: clampInt(
      partial?.initialResponseHours,
      DEFAULT_TIMER_SETTINGS.initialResponseHours,
      1,
      720
    ),
    defaultSlaHours: clampInt(
      partial?.defaultSlaHours,
      DEFAULT_TIMER_SETTINGS.defaultSlaHours,
      1,
      720
    ),
  };
}

export function timerSettingsFromPreferences(
  prefs: Partial<TimerSettings> | null | undefined
): TimerSettings {
  return normalizeTimerSettings(prefs);
}
