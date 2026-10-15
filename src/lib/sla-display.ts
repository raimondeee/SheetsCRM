import { addSlaClockHours, diffSlaClockMs, SLA_WEEKEND_PAUSE_LABEL } from "./business-hours";
import { parseSheetTimestamp } from "./ticket-activity";
import { normalizeStatusId } from "./status-mapper";
import { DEFAULT_TIMER_SETTINGS } from "./timer-settings";
import type { Ticket } from "./types";

export { SLA_WEEKEND_PAUSE_LABEL };

export const DEFAULT_SLA_HOURS = DEFAULT_TIMER_SETTINGS.defaultSlaHours;

/** Response / initial-response SLAs do not apply once a ticket is closed out. */
export function isResponseSlaEligibleStatus(status: string): boolean {
  const normalized = normalizeStatusId(status);
  return normalized !== "resolved" && normalized !== "do_not_action";
}

/** Intake submitted before today (local) — pre-CRM imports should not show initial-response badge. */
export function isLegacyIntakeTicket(timestamp: string, now = new Date()): boolean {
  const intake = parseSheetTimestamp(timestamp);
  if (!intake) return false;

  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  return intake.getTime() < startOfToday.getTime();
}

/** Response SLA applies while Open and the customer is waiting for our reply. */
export function shouldShowResponseSla(
  ticket: Pick<Ticket, "status">,
  latestDirection?: "inbound" | "outbound" | null
): boolean {
  if (!isResponseSlaEligibleStatus(ticket.status)) return false;
  const status = normalizeStatusId(ticket.status);
  if (status === "pending" || status === "longterm_hold") return false;
  if (latestDirection === "outbound") return false;
  return true;
}

/** @deprecated Use shouldShowResponseSla */
export function shouldShowSlaTimer(ticket: Pick<Ticket, "status" | "timestamp">): boolean {
  return shouldShowResponseSla(ticket);
}

export type SlaCountdownTone = "green" | "amber" | "red" | "muted";

export interface SlaCountdownPreview {
  label: string;
  tone: SlaCountdownTone;
}

/**
 * Wall-clock instant when `slaHours` of SLA time have elapsed.
 * Friday 5:00 PM through Monday 7:00 AM Pacific does not count.
 */
export function computeResponseSlaDueAt(anchorIso: string, slaHours: number): string {
  const anchor = new Date(anchorIso);
  const base = Number.isNaN(anchor.getTime()) ? new Date() : anchor;
  return addSlaClockHours(base, slaHours).toISOString();
}

/** Anchor = latest inbound thread message, else form intake time. */
export function resolveResponseSlaAnchor(
  latestInboundAt: string | null,
  intakeTimestamp: string
): string | null {
  if (latestInboundAt) return latestInboundAt;
  const intake = parseSheetTimestamp(intakeTimestamp);
  return intake?.toISOString() ?? null;
}

export function computeDefaultSlaDueAt(timestamp: string, slaHours = DEFAULT_SLA_HOURS): string {
  const intakeAt = parseSheetTimestamp(timestamp) ?? new Date();
  return computeResponseSlaDueAt(intakeAt.toISOString(), slaHours);
}

export function getSlaCountdownPreviewForTicket(ticket: Ticket): SlaCountdownPreview | null {
  if (!shouldShowResponseSla(ticket) || !ticket.slaDueAt) return null;
  return getSlaCountdownPreview(ticket.slaDueAt);
}

export function slaCountdownTitle(slaDueAt: string | null): string {
  const due = slaDueAt ? new Date(slaDueAt).toLocaleString() : "";
  const when = due ? `due ${due}. ` : "";
  return `Response SLA ${when}${SLA_WEEKEND_PAUSE_LABEL} does not count.`;
}

export function getSlaCountdownPreview(
  slaDueAt: string | null,
  now = new Date()
): SlaCountdownPreview | null {
  if (!slaDueAt) return null;
  const due = new Date(slaDueAt);
  if (Number.isNaN(due.getTime())) return null;

  const diffMs = diffSlaClockMs(now, due);
  const hours = Math.round(diffMs / (60 * 60 * 1000));

  if (hours < 0) {
    return { label: `${Math.abs(hours)}h overdue`, tone: "red" };
  }
  if (hours === 0) {
    return { label: "Due now", tone: "red" };
  }
  if (hours <= 4) {
    return { label: `${hours}h left`, tone: "red" };
  }
  if (hours <= 12) {
    return { label: `${hours}h left`, tone: "amber" };
  }
  return { label: `${hours}h left`, tone: "green" };
}

export function slaCountdownClassName(tone: SlaCountdownTone): string {
  switch (tone) {
    case "green":
      return "bg-emerald-100 text-emerald-800";
    case "amber":
      return "bg-amber-100 text-amber-900";
    case "red":
      return "bg-red-100 text-red-800";
    default:
      return "bg-gray-100 text-zendesk-muted";
  }
}
