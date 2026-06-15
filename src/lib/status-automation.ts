import {
  DEFAULT_TIMER_SETTINGS,
  type TimerSettings,
} from "./timer-settings";

/** Mon–Fri, 9:00–17:00 local time. */
export function isBusinessHour(date: Date): boolean {
  const day = date.getDay();
  if (day === 0 || day === 6) return false;
  const hour = date.getHours();
  return hour >= 9 && hour < 17;
}

export function addBusinessHours(start: Date, hoursToAdd: number): Date {
  let current = new Date(start);
  let added = 0;
  const maxSteps = hoursToAdd * 24 + 48;
  let steps = 0;

  while (added < hoursToAdd && steps < maxSteps) {
    current = new Date(current.getTime() + 60 * 60 * 1000);
    steps += 1;
    if (isBusinessHour(current)) added += 1;
  }

  return current;
}

/** Returns `open` when the customer replied after the ticket was marked pending. */
export function getReopenOnCustomerReplyStatus(
  status: string,
  latestDirection: "inbound" | "outbound" | null | undefined,
  latestMessageAt: string | null | undefined,
  statusChangedAt: string | null | undefined
): "open" | null {
  if (status !== "pending") return null;
  if (latestDirection !== "inbound") return null;

  if (statusChangedAt && latestMessageAt) {
    const changed = new Date(statusChangedAt).getTime();
    const latest = new Date(latestMessageAt).getTime();
    if (!Number.isNaN(changed) && !Number.isNaN(latest) && latest <= changed) {
      return null;
    }
  }

  return "open";
}

/** Agent sent a new outbound message after the ticket was marked pending. */
export function hasAgentReplySincePending(
  statusChangedAt: string,
  latestOutboundSentAt: string | null | undefined
): boolean {
  if (!latestOutboundSentAt) return false;
  const changed = new Date(statusChangedAt).getTime();
  const outbound = new Date(latestOutboundSentAt).getTime();
  if (Number.isNaN(changed) || Number.isNaN(outbound)) return false;
  return outbound > changed;
}

export function computePendingReopenDueAt(
  statusChangedAt: string,
  settings: TimerSettings = DEFAULT_TIMER_SETTINGS,
  pendingReopenHours: number | null = null
): Date | null {
  const changed = new Date(statusChangedAt);
  if (Number.isNaN(changed.getTime())) return null;

  if (pendingReopenHours != null && pendingReopenHours > 0) {
    return new Date(changed.getTime() + pendingReopenHours * 60 * 60 * 1000);
  }

  return addBusinessHours(changed, settings.pendingReopenBusinessHours);
}

export function describePendingReopenTimer(
  pendingReopenHours: number | null,
  settings: TimerSettings = DEFAULT_TIMER_SETTINGS
): string {
  if (pendingReopenHours != null && pendingReopenHours > 0) {
    return `${pendingReopenHours} calendar hour${pendingReopenHours === 1 ? "" : "s"}`;
  }
  return `${settings.pendingReopenBusinessHours} business hours (Mon–Fri 9:00–17:00)`;
}

/** Returns `open` when a timed status should auto-reopen, else null. */
export function getAutoReopenStatus(
  status: string,
  statusChangedAt: string | null,
  now = new Date(),
  settings: TimerSettings = DEFAULT_TIMER_SETTINGS,
  pendingReopenHours: number | null = null,
  latestOutboundSentAt: string | null = null
): "open" | null {
  if (!statusChangedAt) return null;
  const changed = new Date(statusChangedAt);
  if (Number.isNaN(changed.getTime())) return null;

  if (status === "pending") {
    if (hasAgentReplySincePending(statusChangedAt, latestOutboundSentAt)) return null;

    const reopenAt = computePendingReopenDueAt(statusChangedAt, settings, pendingReopenHours);
    if (reopenAt && reopenAt <= now) return "open";
  }

  if (status === "longterm_hold" || status === "on_hold") {
    const reopenAt = new Date(changed);
    reopenAt.setDate(reopenAt.getDate() + settings.longtermHoldReopenDays);
    if (reopenAt <= now) return "open";
  }

  return null;
}

/** Customer reply takes precedence over timed pending reopen. */
export function resolveAutomatedReopenStatus(
  status: string,
  statusChangedAt: string | null,
  latestDirection: "inbound" | "outbound" | null | undefined,
  latestMessageAt: string | null | undefined = null,
  now = new Date(),
  settings: TimerSettings = DEFAULT_TIMER_SETTINGS,
  pendingReopenHours: number | null = null,
  latestOutboundSentAt: string | null = null
): "open" | null {
  const customerReply = getReopenOnCustomerReplyStatus(
    status,
    latestDirection,
    latestMessageAt,
    statusChangedAt
  );
  if (customerReply) return customerReply;
  return getAutoReopenStatus(
    status,
    statusChangedAt,
    now,
    settings,
    pendingReopenHours,
    latestOutboundSentAt
  );
}
