import {
  isPomodoroScheduleId,
  isWellnessContentSourceId,
  type PomodoroScheduleId,
  type WellnessContentSourceId,
} from "./wellness-content";

export type CaseBreakThreshold = 5 | 10;

export type WellnessPreferences = {
  /** Show a cyan/blue content overlay after N successful sends. */
  caseBreaksEnabled: boolean;
  caseBreakThreshold: CaseBreakThreshold;
  /** Selected public/jsons packs (multi-select). */
  wellnessContentIds: WellnessContentSourceId[];
  /** Show emerald movement reminders on a pomodoro schedule. */
  pomodoroBreaksEnabled: boolean;
  pomodoroScheduleId: PomodoroScheduleId;
};

export const DEFAULT_WELLNESS_PREFERENCES: WellnessPreferences = {
  caseBreaksEnabled: false,
  caseBreakThreshold: 5,
  wellnessContentIds: [],
  pomodoroBreaksEnabled: false,
  pomodoroScheduleId: "25-5",
};

function normalizeThreshold(value: unknown): CaseBreakThreshold {
  return value === 10 || value === "10" ? 10 : 5;
}

export function normalizeWellnessContentIds(value: unknown): WellnessContentSourceId[] {
  if (!Array.isArray(value)) return [...DEFAULT_WELLNESS_PREFERENCES.wellnessContentIds];
  const out: WellnessContentSourceId[] = [];
  for (const entry of value) {
    if (typeof entry !== "string") continue;
    if (!isWellnessContentSourceId(entry)) continue;
    if (!out.includes(entry)) out.push(entry);
  }
  return out;
}

export function normalizeWellnessPreferences(
  partial: Partial<WellnessPreferences> | null | undefined
): WellnessPreferences {
  const scheduleRaw =
    typeof partial?.pomodoroScheduleId === "string" ? partial.pomodoroScheduleId : "";
  return {
    caseBreaksEnabled:
      typeof partial?.caseBreaksEnabled === "boolean"
        ? partial.caseBreaksEnabled
        : DEFAULT_WELLNESS_PREFERENCES.caseBreaksEnabled,
    caseBreakThreshold: normalizeThreshold(partial?.caseBreakThreshold),
    wellnessContentIds: normalizeWellnessContentIds(partial?.wellnessContentIds),
    pomodoroBreaksEnabled:
      typeof partial?.pomodoroBreaksEnabled === "boolean"
        ? partial.pomodoroBreaksEnabled
        : DEFAULT_WELLNESS_PREFERENCES.pomodoroBreaksEnabled,
    pomodoroScheduleId: isPomodoroScheduleId(scheduleRaw)
      ? scheduleRaw
      : DEFAULT_WELLNESS_PREFERENCES.pomodoroScheduleId,
  };
}
