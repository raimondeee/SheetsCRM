import {
  bulkSetInitialResponseSlaCleared,
  isOverlayMigrationApplied,
  markOverlayMigrationApplied,
} from "./overlay-db";
import { hoursSinceLastResponse, parseSheetTimestamp } from "./ticket-activity";
import type { Ticket } from "./types";

/** One-time migration: dismiss >48h initial-response flags on pre-CRM tickets. */
export const LEGACY_INITIAL_SLA_MIGRATION_ID = "2026-06-clear-initial-sla-24h";

/** Intake age threshold for the legacy bulk clear (hours). */
export const LEGACY_INITIAL_SLA_AGE_HOURS = 24;

function ticketIntakeAgeHours(ticket: Ticket): number | null {
  const intake = parseSheetTimestamp(ticket.timestamp);
  if (!intake) return null;
  return hoursSinceLastResponse(intake.toISOString());
}

/**
 * Clears the initial-response SLA flag for tickets submitted at least
 * LEGACY_INITIAL_SLA_AGE_HOURS ago. Runs once per overlay database.
 */
export function migrateLegacyInitialResponseSla(tickets: Ticket[]): number {
  if (isOverlayMigrationApplied(LEGACY_INITIAL_SLA_MIGRATION_ID)) return 0;

  const rowIds = tickets
    .filter((ticket) => {
      const ageHours = ticketIntakeAgeHours(ticket);
      return ageHours !== null && ageHours >= LEGACY_INITIAL_SLA_AGE_HOURS;
    })
    .map((ticket) => ticket.rowId);

  const cleared = bulkSetInitialResponseSlaCleared(rowIds);
  markOverlayMigrationApplied(LEGACY_INITIAL_SLA_MIGRATION_ID);
  return cleared;
}
