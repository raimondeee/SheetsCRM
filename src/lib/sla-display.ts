import { parseSheetTimestamp } from "./ticket-activity";
import type { Ticket } from "./types";

export const DEFAULT_SLA_HOURS = 48;

/** Intake submitted before today (local) — pre-CRM imports should not show SLA. */
export function isLegacyIntakeTicket(timestamp: string, now = new Date()): boolean {
  const intake = parseSheetTimestamp(timestamp);
  if (!intake) return false;

  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  return intake.getTime() < startOfToday.getTime();
}

export function shouldShowSlaTimer(ticket: Pick<Ticket, "status" | "timestamp">): boolean {
  if (ticket.status === "resolved" || ticket.status === "solved") return false;
  if (ticket.status === "do_not_action") return false;
  if (isLegacyIntakeTicket(ticket.timestamp)) return false;
  return true;
}

export type SlaCountdownTone = "green" | "amber" | "red" | "muted";

export interface SlaCountdownPreview {
  label: string;
  tone: SlaCountdownTone;
}

export function computeDefaultSlaDueAt(timestamp: string, slaHours = DEFAULT_SLA_HOURS): string {
  const intakeAt = parseSheetTimestamp(timestamp) ?? new Date();
  return new Date(intakeAt.getTime() + slaHours * 60 * 60 * 1000).toISOString();
}

export function getSlaCountdownPreviewForTicket(ticket: Ticket): SlaCountdownPreview | null {
  if (!shouldShowSlaTimer(ticket)) return null;
  return getSlaCountdownPreview(ticket.slaDueAt);
}

export function getSlaCountdownPreview(slaDueAt: string | null): SlaCountdownPreview | null {
  if (!slaDueAt) return null;

  const diffMs = new Date(slaDueAt).getTime() - Date.now();
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
