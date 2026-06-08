import { google } from "googleapis";
import type { gmail_v1 } from "googleapis";
import { v4 as uuidv4 } from "uuid";
import type { ThreadMessage } from "./types";
import { stripHtmlToText } from "./html-utils";
import { getGoogleAuthClient, getSignedInUser } from "./google-auth";
import {
  addThreadMessage,
  claimGmailThreadForTicket,
  getThreadMessages,
  getTicketRowIdForGmailThread,
  pruneMismatchedThreadMessages,
  resolveTicketGmailThreadId,
} from "./overlay-db";

async function getGmailClient() {
  const auth = await getGoogleAuthClient();
  if (!auth) return null;

  return google.gmail({ version: "v1", auth });
}

async function resolveSenderEmail(): Promise<string> {
  const user = await getSignedInUser();
  if (user.email) return user.email;
  return process.env.GMAIL_SENDER_EMAIL || "support@example.com";
}

const signatureCache = new Map<string, { html: string; fetchedAt: number }>();
const SIGNATURE_CACHE_MS = 5 * 60 * 1000;

/** Fetch the Gmail signature for the signed-in user's send-as address. */
export async function fetchGmailSignature(
  gmail: gmail_v1.Gmail,
  sendAsEmail: string
): Promise<string> {
  const cached = signatureCache.get(sendAsEmail);
  if (cached && Date.now() - cached.fetchedAt < SIGNATURE_CACHE_MS) {
    return cached.html;
  }

  try {
    const res = await gmail.users.settings.sendAs.get({
      userId: "me",
      sendAsEmail,
    });
    const html = res.data.signature?.trim() ?? "";
    signatureCache.set(sendAsEmail, { html, fetchedAt: Date.now() });
    return html;
  } catch {
    try {
      const list = await gmail.users.settings.sendAs.list({ userId: "me" });
      const primary =
        list.data.sendAs?.find((alias) => alias.isPrimary) ?? list.data.sendAs?.[0];
      const html = primary?.signature?.trim() ?? "";
      if (primary?.sendAsEmail) {
        signatureCache.set(primary.sendAsEmail, { html, fetchedAt: Date.now() });
      }
      return html;
    } catch {
      return "";
    }
  }
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function appendSignatureToBody(
  userBody: string,
  signatureHtml: string
): { plain: string; html?: string } {
  const trimmed = userBody.trim();
  if (!signatureHtml) return { plain: trimmed };

  const signaturePlain = stripHtmlToText(signatureHtml);
  const plain = signaturePlain
    ? `${trimmed}\n\n--\n${signaturePlain}`
    : trimmed;

  const hasHtmlSignature = /<[a-z][\s\S]*>/i.test(signatureHtml);
  if (!hasHtmlSignature) return { plain };

  const htmlBody = [
    `<div>${escapeHtml(trimmed).replace(/\n/g, "<br>")}</div>`,
    "<br>",
    signatureHtml,
  ].join("");

  return { plain, html: htmlBody };
}

function encodeMessage(
  from: string,
  to: string,
  subject: string,
  body: string,
  cc?: string | null,
  htmlBody?: string
): string {
  const headers = [`From: ${from}`, `To: ${to}`];
  if (cc?.trim()) headers.push(`Cc: ${cc.trim()}`);
  headers.push(`Subject: ${subject}`, "MIME-Version: 1.0");

  let mimeBody: string;
  if (htmlBody) {
    const boundary = `sheetscrm_${Date.now().toString(36)}`;
    headers.push(`Content-Type: multipart/alternative; boundary="${boundary}"`);
    mimeBody = [
      ...headers,
      "",
      `--${boundary}`,
      "Content-Type: text/plain; charset=utf-8",
      "Content-Transfer-Encoding: 7bit",
      "",
      body,
      `--${boundary}`,
      "Content-Type: text/html; charset=utf-8",
      "Content-Transfer-Encoding: 7bit",
      "",
      htmlBody,
      `--${boundary}--`,
    ].join("\r\n");
  } else {
    headers.push("Content-Type: text/plain; charset=utf-8", "", body);
    mimeBody = headers.join("\r\n");
  }

  return Buffer.from(mimeBody)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function getHeader(
  headers: gmail_v1.Schema$MessagePartHeader[] | undefined,
  name: string
): string {
  return headers?.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value ?? "";
}

function extractEmailAddress(headerValue: string): string {
  const match = headerValue.match(/<([^>]+)>/);
  return (match?.[1] ?? headerValue).trim().toLowerCase();
}

function extractBody(payload: gmail_v1.Schema$MessagePart | undefined): string {
  if (!payload) return "";

  if (payload.mimeType === "text/plain" && payload.body?.data) {
    return Buffer.from(payload.body.data, "base64url").toString("utf-8");
  }

  for (const part of payload.parts ?? []) {
    const text = extractBody(part);
    if (text) return text;
  }

  return "";
}

function parseGmailMessage(
  msg: gmail_v1.Schema$Message,
  ticketRowId: string,
  requesterEmail: string,
  agentEmail: string
): ThreadMessage | null {
  if (!msg.id) return null;

  const headers = msg.payload?.headers;
  const from = getHeader(headers, "From");
  const to = getHeader(headers, "To");
  const subject = getHeader(headers, "Subject");
  const dateHeader = getHeader(headers, "Date");
  const body = extractBody(msg.payload).trim();

  const fromEmail = extractEmailAddress(from);
  const requester = requesterEmail.trim().toLowerCase();
  const isInbound = fromEmail === requester;

  return {
    id: uuidv4(),
    ticketRowId,
    direction: isInbound ? "inbound" : "outbound",
    from: from || (isInbound ? requesterEmail : agentEmail),
    to: to || (isInbound ? agentEmail : requesterEmail),
    cc: null,
    subject: subject || "(no subject)",
    body: body || "(empty message)",
    gmailMessageId: msg.id,
    gmailThreadId: msg.threadId ?? null,
    sentAt: dateHeader ? new Date(dateHeader).toISOString() : new Date().toISOString(),
  };
}

async function importThreadMessages(
  gmail: gmail_v1.Gmail,
  threadId: string,
  ticketRowId: string,
  requesterEmail: string,
  agentEmail: string,
  knownIds: Set<string>
): Promise<void> {
  const owner = getTicketRowIdForGmailThread(threadId);
  if (owner && owner !== ticketRowId) return;

  const thread = await gmail.users.threads.get({
    userId: "me",
    id: threadId,
    format: "full",
  });

  for (const ref of thread.data.messages ?? []) {
    if (!ref.id || knownIds.has(ref.id)) continue;
    if (ref.threadId && ref.threadId !== threadId) continue;

    const full = await gmail.users.messages.get({
      userId: "me",
      id: ref.id,
      format: "full",
    });

    const parsed = parseGmailMessage(full.data, ticketRowId, requesterEmail, agentEmail);
    if (!parsed || parsed.gmailThreadId !== threadId) continue;

    addThreadMessage(parsed);
    knownIds.add(ref.id);
  }
}

/**
 * Sync Gmail messages for a ticket using only its bound thread ID.
 * Each Gmail thread maps to exactly one CRM ticket.
 */
export async function syncGmailThreadForTicket(params: {
  ticketRowId: string;
  requesterEmail: string;
}): Promise<ThreadMessage[]> {
  const gmail = await getGmailClient();

  pruneMismatchedThreadMessages(params.ticketRowId);
  const threadId = resolveTicketGmailThreadId(params.ticketRowId);

  if (!gmail || !threadId || !params.requesterEmail.trim()) {
    return getThreadMessages(params.ticketRowId);
  }

  const agentEmail = await resolveSenderEmail();
  const existing = getThreadMessages(params.ticketRowId);
  const knownIds = new Set(
    existing.map((m) => m.gmailMessageId).filter((id): id is string => Boolean(id))
  );

  await importThreadMessages(
    gmail,
    threadId,
    params.ticketRowId,
    params.requesterEmail,
    agentEmail,
    knownIds
  );

  pruneMismatchedThreadMessages(params.ticketRowId);

  return getThreadMessages(params.ticketRowId).sort(
    (a, b) => new Date(a.sentAt).getTime() - new Date(b.sentAt).getTime()
  );
}

export async function sendReplyEmail(params: {
  ticketRowId: string;
  to: string;
  subject: string;
  body: string;
  cc?: string | null;
}): Promise<ThreadMessage> {
  const from = await resolveSenderEmail();
  const boundThreadId = resolveTicketGmailThreadId(params.ticketRowId);

  const message: ThreadMessage = {
    id: uuidv4(),
    ticketRowId: params.ticketRowId,
    direction: "outbound",
    from,
    to: params.to,
    cc: params.cc?.trim() || null,
    subject: params.subject,
    body: params.body,
    gmailMessageId: null,
    gmailThreadId: boundThreadId,
    sentAt: new Date().toISOString(),
  };

  const gmail = await getGmailClient();
  if (gmail) {
    const signatureHtml = await fetchGmailSignature(gmail, from);
    const { plain, html } = appendSignatureToBody(params.body, signatureHtml);
    message.body = plain;

    const encoded = encodeMessage(
      from,
      params.to,
      params.subject,
      plain,
      params.cc,
      html
    );
    const res = await gmail.users.messages.send({
      userId: "me",
      requestBody: {
        raw: encoded,
        threadId: boundThreadId ?? undefined,
      },
    });
    message.gmailMessageId = res.data.id ?? null;
    message.gmailThreadId = res.data.threadId ?? boundThreadId;

    if (message.gmailMessageId && !message.gmailThreadId) {
      const meta = await gmail.users.messages.get({
        userId: "me",
        id: message.gmailMessageId,
        format: "metadata",
      });
      message.gmailThreadId = meta.data.threadId ?? null;
    }

    if (message.gmailThreadId) {
      claimGmailThreadForTicket(params.ticketRowId, message.gmailThreadId);
    }
  }

  addThreadMessage(message);
  return message;
}

export async function hasGmailCredentials(): Promise<boolean> {
  return Boolean(await getGmailClient());
}
