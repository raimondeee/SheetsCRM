import { PENDING_WITHOUT_EMAIL_HOURS_OPTIONS } from "./admin-notes";

const ADMIN_NOTE_LINE_RE = /^•\s*(\d{1,2})\/(\d{1,2})\/(\d{4})\s*-\s*(.+)$/;

/** Parse "Set to pending 72h (no email sent)" lines from admin notes. */
export function parsePendingTimerFromAdminNotes(text: string): {
  statusChangedAt: string;
  pendingReopenHours: number | null;
} | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  const lines = trimmed.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]!;
    const match = line.match(ADMIN_NOTE_LINE_RE);
    if (!match) continue;

    const [, month, day, year, noteBody] = match;
    const pendingMatch = noteBody.match(/set to pending(?:\s+(\d+)h)?\s*\(no email sent\)/i);
    if (!pendingMatch) continue;

    const hoursRaw = pendingMatch[1];
    let pendingReopenHours: number | null = null;
    if (hoursRaw) {
      const hours = Number.parseInt(hoursRaw, 10);
      if (
        PENDING_WITHOUT_EMAIL_HOURS_OPTIONS.includes(
          hours as (typeof PENDING_WITHOUT_EMAIL_HOURS_OPTIONS)[number]
        )
      ) {
        pendingReopenHours = hours;
      }
    }

    const changed = new Date(
      Number.parseInt(year!, 10),
      Number.parseInt(month!, 10) - 1,
      Number.parseInt(day!, 10),
      12,
      0,
      0,
      0
    );
    if (Number.isNaN(changed.getTime())) continue;

    return {
      statusChangedAt: changed.toISOString(),
      pendingReopenHours,
    };
  }

  return null;
}

export function combineNotesForPendingInference(
  ...sources: Array<string | null | undefined>
): string {
  return sources
    .map((value) => value?.trim() ?? "")
    .filter(Boolean)
    .join("\n");
}

export function resolvePendingTimerAnchor(params: {
  adminNotes: string;
  lastOutboundSentAt: string | null;
  overlayUpdatedAt: string | null;
}): {
  statusChangedAt: string;
  pendingReopenHours: number | null;
  source: "admin_note" | "last_outbound" | "overlay_updated_at";
} | null {
  const fromNotes = parsePendingTimerFromAdminNotes(params.adminNotes);
  if (fromNotes) {
    return { ...fromNotes, source: "admin_note" };
  }

  if (params.lastOutboundSentAt) {
    const outbound = new Date(params.lastOutboundSentAt);
    if (!Number.isNaN(outbound.getTime())) {
      return {
        statusChangedAt: params.lastOutboundSentAt,
        pendingReopenHours: null,
        source: "last_outbound",
      };
    }
  }

  if (params.overlayUpdatedAt) {
    const updated = new Date(params.overlayUpdatedAt);
    if (!Number.isNaN(updated.getTime())) {
      return {
        statusChangedAt: params.overlayUpdatedAt,
        pendingReopenHours: null,
        source: "overlay_updated_at",
      };
    }
  }

  return null;
}
