export interface QueuedSendPayload {
  ticketRowId: string;
  to: string;
  subject: string;
  message: string;
  cc: string | null;
  bcc: string | null;
  statusAfterSend: "pending" | "resolved";
  attachmentFiles: File[];
  intakeTimestamp?: string;
  label: string;
}
