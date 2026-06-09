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

const ON_HOLD_REOPEN_DAYS = 7;
const PENDING_REOPEN_BUSINESS_HOURS = 72;

/** Returns `open` when the latest conversation message is from the customer. */
export function getReopenOnCustomerReplyStatus(
  status: string,
  latestDirection: "inbound" | "outbound" | null | undefined
): "open" | null {
  if (status !== "pending") return null;
  if (latestDirection !== "inbound") return null;
  return "open";
}

/** Returns `open` when a timed status should auto-reopen, else null. */
export function getAutoReopenStatus(
  status: string,
  statusChangedAt: string | null,
  now = new Date()
): "open" | null {
  if (!statusChangedAt) return null;
  const changed = new Date(statusChangedAt);
  if (Number.isNaN(changed.getTime())) return null;

  if (status === "pending") {
    if (addBusinessHours(changed, PENDING_REOPEN_BUSINESS_HOURS) <= now) return "open";
  }

  if (status === "longterm_hold" || status === "on_hold") {
    const reopenAt = new Date(changed);
    reopenAt.setDate(reopenAt.getDate() + ON_HOLD_REOPEN_DAYS);
    if (reopenAt <= now) return "open";
  }

  return null;
}

/** Customer reply takes precedence over timed pending reopen. */
export function resolveAutomatedReopenStatus(
  status: string,
  statusChangedAt: string | null,
  latestDirection: "inbound" | "outbound" | null | undefined,
  now = new Date()
): "open" | null {
  const customerReply = getReopenOnCustomerReplyStatus(status, latestDirection);
  if (customerReply) return customerReply;
  return getAutoReopenStatus(status, statusChangedAt, now);
}
