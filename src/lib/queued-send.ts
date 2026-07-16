export type StatusAfterSend = "pending" | "resolved" | "unchanged";

export interface QueuedSendPayload {
  ticketRowId: string;
  to: string;
  subject: string;
  message: string;
  cc: string | null;
  bcc: string | null;
  statusAfterSend: StatusAfterSend;
  attachmentFiles: File[];
  intakeTimestamp?: string;
  label: string;
}
