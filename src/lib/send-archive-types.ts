import type { StatusAfterSend } from "./queued-send";

export type SendArchiveStatus = "queued" | "sent" | "failed" | "cancelled";

export interface SendArchiveAttachment {
  filename: string;
  mimeType: string;
  data: string;
}

export interface SendArchiveEntry {
  id: string;
  savedAt: string;
  status: SendArchiveStatus;
  ticketRowId: string;
  label: string;
  to: string;
  subject: string;
  message: string;
  cc: string | null;
  bcc: string | null;
  statusAfterSend: StatusAfterSend;
  intakeTimestamp?: string;
  attachments: SendArchiveAttachment[];
  errorMessage?: string;
  completedAt?: string;
}
