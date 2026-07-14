import {
  addWeekdayHours,
  DEFAULT_BUSINESS_HOURS,
  type BusinessHoursConfig,
} from "./business-hours";
import { blocksTicketAutoReopen, normalizeStatusId } from "./status-mapper";
import {
  DEFAULT_TIMER_SETTINGS,
  type TimerSettings,
} from "./timer-settings";

export { isBusinessHour } from "./business-hours";
export { addWeekdayHours } from "./business-hours";

/** Returns `open` when the customer replied after the ticket was marked pending. */
export function getReopenOnCustomerReplyStatus(
  status: string,
  latestDirection: "inbound" | "outbound" | null | undefined,
  latestMessageAt: string | null | undefined,
  statusChangedAt: string | null | undefined,
  resolvedClosed = false
): "open" | null {
  const normalized = normalizeStatusId(status);
  if (blocksTicketAutoReopen(normalized, resolvedClosed) || normalized !== "pending") return null;
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

function resolvePendingReopenHourCount(
  settings: TimerSettings,
  pendingReopenHours: number | null
): number {
  if (pendingReopenHours != null && pendingReopenHours > 0) return pendingReopenHours;
  return settings.pendingReopenBusinessHours;
}

export function computePendingReopenDueAt(
  statusChangedAt: string,
  settings: TimerSettings = DEFAULT_TIMER_SETTINGS,
  pendingReopenHours: number | null = null,
  businessHours: BusinessHoursConfig = DEFAULT_BUSINESS_HOURS
): Date | null {
  const changed = new Date(statusChangedAt);
  if (Number.isNaN(changed.getTime())) return null;

  const hours = resolvePendingReopenHourCount(settings, pendingReopenHours);
  return addWeekdayHours(changed, hours, businessHours);
}

export function describePendingReopenTimer(
  pendingReopenHours: number | null,
  settings: TimerSettings = DEFAULT_TIMER_SETTINGS,
  _businessHours: BusinessHoursConfig = DEFAULT_BUSINESS_HOURS
): string {
  const hours = resolvePendingReopenHourCount(settings, pendingReopenHours);
  return `${hours} weekday hour${hours === 1 ? "" : "s"} (weekends excluded)`;
}

/** Returns `open` when a timed status should auto-reopen, else null. */
export function getAutoReopenStatus(
  status: string,
  statusChangedAt: string | null,
  now = new Date(),
  settings: TimerSettings = DEFAULT_TIMER_SETTINGS,
  pendingReopenHours: number | null = null,
  latestOutboundSentAt: string | null = null,
  businessHours: BusinessHoursConfig = DEFAULT_BUSINESS_HOURS,
  resolvedClosed = false
): "open" | null {
  if (blocksTicketAutoReopen(status, resolvedClosed)) return null;
  if (!statusChangedAt) return null;
  const changed = new Date(statusChangedAt);
  if (Number.isNaN(changed.getTime())) return null;

  const normalized = normalizeStatusId(status);

  if (normalized === "pending") {
    if (hasAgentReplySincePending(statusChangedAt, latestOutboundSentAt)) return null;

    const reopenAt = computePendingReopenDueAt(
      statusChangedAt,
      settings,
      pendingReopenHours,
      businessHours
    );
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
  latestOutboundSentAt: string | null = null,
  businessHours: BusinessHoursConfig = DEFAULT_BUSINESS_HOURS,
  resolvedClosed = false
): "open" | null {
  if (blocksTicketAutoReopen(status, resolvedClosed)) return null;
  const customerReply = getReopenOnCustomerReplyStatus(
    status,
    latestDirection,
    latestMessageAt,
    statusChangedAt,
    resolvedClosed
  );
  if (customerReply) return customerReply;
  return getAutoReopenStatus(
    status,
    statusChangedAt,
    now,
    settings,
    pendingReopenHours,
    latestOutboundSentAt,
    businessHours,
    resolvedClosed
  );
}
