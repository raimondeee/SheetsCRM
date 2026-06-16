const DEFAULT_MAIL_BASE = "https://mail.google.com/mail/u/0";

export function getGmailBaseUrl(): string {
  return process.env.NEXT_PUBLIC_GMAIL_BASE_URL ?? DEFAULT_MAIL_BASE;
}

/** Gmail unified search for a contact email (Column M). */
export function buildGmailSearchUrl(email: string): string | null {
  const trimmed = email.trim();
  if (!trimmed) return null;
  const query = trimmed.includes("@") ? `from:${trimmed}` : trimmed;
  return `${getGmailBaseUrl()}/#search/${encodeURIComponent(query)}`;
}

export function buildGmailMessageUrl(messageId: string): string {
  return `${getGmailBaseUrl()}/#all/${messageId}`;
}

/** Gmail API thread/message ids are lowercase hex strings. */
export function isGmailApiThreadId(id: string): boolean {
  return /^[0-9a-f]{10,}$/i.test(id.trim());
}

/** Legacy Gmail web ids (e.g. FMfcgz…) open in the browser but not via the API. */
export function isGmailLegacyWebId(id: string): boolean {
  const trimmed = id.trim();
  if (!trimmed) return false;
  if (isGmailApiThreadId(trimmed)) return false;
  if (trimmed.startsWith("FMfcgz") || trimmed.startsWith("msg-f:")) return true;
  return /[A-Z]/.test(trimmed);
}

/** Build a Gmail URL that opens a thread or legacy web conversation id. */
export function buildGmailConversationUrl(id: string): string {
  if (isGmailLegacyWebId(id)) {
    return buildGmailMessageUrl(id);
  }
  return buildGmailThreadUrl(id);
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

/** Sized popup for Gmail compose (Mixmax extension can enhance the Gmail page inside). */
export const GMAIL_COMPOSE_POPUP_FEATURES =
  "width=720,height=820,left=80,top=40,resizable=yes,scrollbars=yes";

export function openGmailComposePopup(
  url: string,
  windowName = "sheetscrm-gmail-compose"
): Window | null {
  return window.open(url, windowName, GMAIL_COMPOSE_POPUP_FEATURES);
}
