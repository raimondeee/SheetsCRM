/** Workspace timer defaults — overridable in user preferences. */
export interface TimerSettings {
  /** Pending → Open after this many weekday hours (24h on workdays, weekends excluded). */
  pendingReopenBusinessHours: number;
  /** Longterm Hold / on_hold → Open after this many calendar days. */
  longtermHoldReopenDays: number;
  /** Flag tickets with no outbound reply after this many business hours since intake. */
  initialResponseHours: number;
  /** Default Response SLA hours — due time is anchored on the customer's last message. */
  defaultSlaHours: number;
  /** How often to poll Gmail for reopen on Resolved tickets (not Resolve & Close), in hours. */
  resolvedGmailPollHours: number;
  /** Days after resolve before unlinking Gmail thread and stopping background sync (Send/Resolved). */
  resolvedGmailLinkArchiveDays: number;
}

export function defaultResolvedGmailLinkArchiveDays(): number {
  if (typeof process !== "undefined" && process.env.GMAIL_LINK_ARCHIVE_DAYS) {
    const fromEnv = Number(process.env.GMAIL_LINK_ARCHIVE_DAYS);
    if (Number.isFinite(fromEnv) && fromEnv > 0) return Math.round(fromEnv);
  }
  return 90;
}

export const DEFAULT_TIMER_SETTINGS: TimerSettings = {
  pendingReopenBusinessHours: 48,
  longtermHoldReopenDays: 7,
  initialResponseHours: 48,
  defaultSlaHours: 48,
  resolvedGmailPollHours: 24,
  resolvedGmailLinkArchiveDays: defaultResolvedGmailLinkArchiveDays(),
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
    resolvedGmailPollHours: clampInt(
      partial?.resolvedGmailPollHours,
      DEFAULT_TIMER_SETTINGS.resolvedGmailPollHours,
      1,
      168
    ),
    resolvedGmailLinkArchiveDays: clampInt(
      partial?.resolvedGmailLinkArchiveDays,
      DEFAULT_TIMER_SETTINGS.resolvedGmailLinkArchiveDays,
      1,
      365
    ),
  };
}

export function timerSettingsFromPreferences(
  prefs: Partial<TimerSettings> | null | undefined
): TimerSettings {
  return normalizeTimerSettings(prefs);
}
