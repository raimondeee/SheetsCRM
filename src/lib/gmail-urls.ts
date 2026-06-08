const DEFAULT_MAIL_BASE = "https://mail.google.com/mail/u/0";

export function getGmailBaseUrl(): string {
  return process.env.NEXT_PUBLIC_GMAIL_BASE_URL ?? DEFAULT_MAIL_BASE;
}

/** Gmail unified search for a contact email (Column M). */
export function buildGmailSearchUrl(email: string): string | null {
  const trimmed = email.trim();
  if (!trimmed) return null;
  return `${getGmailBaseUrl()}/#search/${encodeURIComponent(trimmed)}`;
}

export function buildGmailMessageUrl(messageId: string): string {
  return `${getGmailBaseUrl()}/#all/${messageId}`;
}

export function buildGmailThreadUrl(threadId: string): string {
  return `${getGmailBaseUrl()}/#inbox/${threadId}`;
}

/** Opens Gmail compose with pre-filled fields. Mixmax Chrome extension enhances this window. */
export function buildGmailComposeUrl(params: {
  to?: string;
  cc?: string;
  bcc?: string;
  subject?: string;
  body?: string;
}): string {
  const qs = new URLSearchParams();
  qs.set("tf", "cm");
  if (params.to?.trim()) qs.set("to", params.to.trim());
  if (params.cc?.trim()) qs.set("cc", params.cc.trim());
  if (params.bcc?.trim()) qs.set("bcc", params.bcc.trim());
  if (params.subject?.trim()) qs.set("su", params.subject.trim());
  if (params.body?.trim()) qs.set("body", params.body.trim());
  return `${getGmailBaseUrl()}/?${qs.toString()}`;
}
