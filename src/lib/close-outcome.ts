/**
 * Close-case outcome questions written to intake sheet columns P/Q/R.
 *
 * Required when a ticket first becomes closed (Resolved or Do Not Action).
 * Existing closed rows are not backfilled — operators fill those in the sheet.
 */
import { getCellValue, getColumnByRole } from "./column-mapper";
import { isClosedTicketStatus } from "./status-mapper";
import type { ColumnRole, SheetConfig, Ticket } from "./types";

export type CloseOutcomeAnswer = "Yes" | "No";

export type CloseOutcomeRole = "inFavorOfHost" | "csInTheWrong" | "remediationSuccessful";

export interface CloseOutcomeAnswers {
  inFavorOfHost: CloseOutcomeAnswer;
  csInTheWrong: CloseOutcomeAnswer;
  remediationSuccessful: CloseOutcomeAnswer;
}

export const CLOSE_OUTCOME_REQUIRED_MESSAGE =
  "Answer the close-case questions before closing this ticket.";

export const CLOSE_OUTCOME_COLUMNS: {
  role: CloseOutcomeRole;
  letter: string;
  index: number;
  label: string;
  hint: string;
}[] = [
  {
    role: "inFavorOfHost",
    letter: "P",
    index: 15,
    label: "In favor of host?",
    hint: "",
  },
  {
    role: "csInTheWrong",
    letter: "Q",
    index: 16,
    label: "Was CS in the wrong?",
    hint: "Was the original decision wrong",
  },
  {
    role: "remediationSuccessful",
    letter: "R",
    index: 17,
    label: "Was our remediation successful?",
    hint: "Were we able to get CS to overturn their decision",
  },
];

export function parseCloseOutcomeAnswer(value: string): CloseOutcomeAnswer | "" {
  const trimmed = value.trim().toLowerCase();
  if (trimmed === "yes" || trimmed === "y" || trimmed === "true" || trimmed === "1") {
    return "Yes";
  }
  if (trimmed === "no" || trimmed === "n" || trimmed === "false" || trimmed === "0") {
    return "No";
  }
  return "";
}

export function parseCloseOutcomeFromUnknown(value: unknown): CloseOutcomeAnswers | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const inFavorOfHost = parseCloseOutcomeAnswer(String(record.inFavorOfHost ?? ""));
  const csInTheWrong = parseCloseOutcomeAnswer(String(record.csInTheWrong ?? ""));
  const remediationSuccessful = parseCloseOutcomeAnswer(
    String(record.remediationSuccessful ?? "")
  );
  if (!inFavorOfHost || !csInTheWrong || !remediationSuccessful) return null;
  return { inFavorOfHost, csInTheWrong, remediationSuccessful };
}

export function closeOutcomeFromTicket(ticket: Ticket): CloseOutcomeAnswers | null {
  return parseCloseOutcomeFromUnknown({
    inFavorOfHost: ticket.inFavorOfHost,
    csInTheWrong: ticket.csInTheWrong,
    remediationSuccessful: ticket.remediationSuccessful,
  });
}

export function hasCompleteCloseOutcome(ticket: Ticket): boolean {
  return closeOutcomeFromTicket(ticket) != null;
}

export function ticketFieldsFromCloseOutcome(
  answers: CloseOutcomeAnswers
): Pick<Ticket, CloseOutcomeRole> {
  return {
    inFavorOfHost: answers.inFavorOfHost,
    csInTheWrong: answers.csInTheWrong,
    remediationSuccessful: answers.remediationSuccessful,
  };
}

/** True when this status change is the ticket's first close (not already closed). */
export function requiresCloseOutcomeAnswers(currentStatus: string, nextStatus: string): boolean {
  return isClosedTicketStatus(nextStatus) && !isClosedTicketStatus(currentStatus);
}

export function closeOutcomeLetter(config: SheetConfig, role: CloseOutcomeRole): string {
  const mapped = getColumnByRole(config, role);
  if (mapped?.letter) return mapped.letter.toUpperCase();
  return CLOSE_OUTCOME_COLUMNS.find((column) => column.role === role)?.letter ?? "P";
}

function readCloseOutcomeCell(row: string[], config: SheetConfig, role: CloseOutcomeRole): string {
  const mapped = getColumnByRole(config, role as ColumnRole);
  if (mapped) {
    const value = getCellValue(row, mapped);
    if (value) return value;
  }
  const fallback = CLOSE_OUTCOME_COLUMNS.find((column) => column.role === role);
  if (!fallback) return "";
  return (row[fallback.index] ?? "").trim();
}

export function readCloseOutcomeFromRow(
  row: string[],
  config: SheetConfig
): Pick<Ticket, CloseOutcomeRole> {
  return {
    inFavorOfHost: readCloseOutcomeCell(row, config, "inFavorOfHost"),
    csInTheWrong: readCloseOutcomeCell(row, config, "csInTheWrong"),
    remediationSuccessful: readCloseOutcomeCell(row, config, "remediationSuccessful"),
  };
}
