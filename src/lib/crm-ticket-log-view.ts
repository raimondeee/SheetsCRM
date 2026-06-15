import { getCrmTicketEvents } from "./crm-ticket-log";
import { getTicketOverlay } from "./overlay-db";
import {
  computePendingReopenDueAt,
  describePendingReopenTimer,
} from "./status-automation";
import { crmStatusLabel } from "./status-mapper";
import type { TimerSettings } from "./timer-settings";

export function buildCrmTicketLogView(rowId: string, timerSettings: TimerSettings) {
  const overlay = getTicketOverlay(rowId);
  const pendingTimerLabel = describePendingReopenTimer(
    overlay.pendingReopenHours,
    timerSettings
  );
  const pendingReopenDueAt =
    overlay.status === "pending" && overlay.statusChangedAt
      ? computePendingReopenDueAt(
          overlay.statusChangedAt,
          timerSettings,
          overlay.pendingReopenHours
        )?.toISOString() ?? null
      : null;

  return {
    settings: {
      status: overlay.status,
      statusLabel: crmStatusLabel(overlay.status),
      statusSource: overlay.statusSource,
      statusChangedAt: overlay.statusChangedAt,
      pendingReopenHours: overlay.pendingReopenHours,
      pendingTimerLabel,
      pendingReopenDueAt,
      slaHours: overlay.slaHours,
      slaDueAt: overlay.slaDueAt,
    },
    events: getCrmTicketEvents(rowId),
  };
}
