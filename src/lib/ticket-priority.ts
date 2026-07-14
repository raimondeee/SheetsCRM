import { isResponseSlaEligibleStatus } from "./sla-display";
import {
  businessClockAnchor,
  DEFAULT_BUSINESS_HOURS,
  diffBusinessMinutes,
  type BusinessHoursConfig,
  type TimeInterval,
} from "./business-hours";
import { DEFAULT_TIMER_SETTINGS } from "./timer-settings";
import type { Ticket } from "./types";
import { getTicketSortTime, parseSheetTimestamp } from "./ticket-activity";
import type { SortOrder } from "./user-preferences";

export const INITIAL_RESPONSE_HOURS = DEFAULT_TIMER_SETTINGS.initialResponseHours;

export interface InitialResponseTimingOptions {
  businessHours?: BusinessHoursConfig;
  pauses?: TimeInterval[];
  firstInboundAt?: string | null;
  now?: Date;
}

export function ticketHasOutboundResponse(
  ticket: Ticket,
  outboundTicketIds: Set<string>
): boolean {
  return outboundTicketIds.has(ticket.rowId);
}

function resolveIntakeInstant(
  ticket: Ticket,
  firstInboundAt?: string | null
): Date | null {
  const sheet = parseSheetTimestamp(ticket.timestamp);
  const inbound = firstInboundAt ? new Date(firstInboundAt) : null;
  const candidates: Date[] = [];
  if (sheet) candidates.push(sheet);
  if (inbound && !Number.isNaN(inbound.getTime())) candidates.push(inbound);
  if (!candidates.length) return null;
  return new Date(Math.min(...candidates.map((d) => d.getTime())));
}

/** Elapsed business hours since intake (or first inbound), excluding pauses. */
export function elapsedBusinessHoursSinceIntake(
  ticket: Ticket,
  options: InitialResponseTimingOptions = {}
): number | null {
  const intake = resolveIntakeInstant(ticket, options.firstInboundAt);
  if (!intake) return null;

  const config = options.businessHours ?? DEFAULT_BUSINESS_HOURS;
  const now = options.now ?? new Date();
  const anchor = businessClockAnchor(intake, config);
  const minutes = diffBusinessMinutes(anchor, now, config, options.pauses ?? []);
  return minutes / 60;
}

export function needsInitialResponse(
  ticket: Ticket,
  outboundTicketIds: Set<string>,
  thresholdBusinessHours = INITIAL_RESPONSE_HOURS,
  options: InitialResponseTimingOptions = {}
): boolean {
  if (!isResponseSlaEligibleStatus(ticket.status)) return false;
  if (ticketHasOutboundResponse(ticket, outboundTicketIds)) return false;
  const hours = elapsedBusinessHoursSinceIntake(ticket, options);
  return hours !== null && hours >= thresholdBusinessHours;
}

export function sortTicketsWithPriority(
  tickets: Ticket[],
  outboundTicketIds: Set<string>,
  sortOrder: SortOrder,
  options: InitialResponseTimingOptions & { thresholdBusinessHours?: number } = {}
): Ticket[] {
  const threshold = options.thresholdBusinessHours ?? INITIAL_RESPONSE_HOURS;
  return [...tickets].sort((a, b) => {
    const aUrgent = needsInitialResponse(a, outboundTicketIds, threshold, options);
    const bUrgent = needsInitialResponse(b, outboundTicketIds, threshold, options);
    if (aUrgent !== bUrgent) return aUrgent ? -1 : 1;

    const aTime = getTicketSortTime(a);
    const bTime = getTicketSortTime(b);
    return sortOrder === "asc" ? aTime - bTime : bTime - aTime;
  });
}
