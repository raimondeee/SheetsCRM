export interface ReplyDraft {
  body: string;
  subject: string;
  cc?: string;
  bcc?: string;
  updatedAt: number;
}
