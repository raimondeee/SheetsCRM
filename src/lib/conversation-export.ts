import type { ThreadMessage, Ticket } from "./types";
import { threadBodyToPlainText } from "./html-utils";

const LEGACY_ADMIN_NOTE_LINE = /^•\s*(\d{2}\/\d{2}\/\d{4})\s*-\s*(.+)$/;

function formatTimestamp(iso: string): string {
  return new Date(iso).toLocaleString();
}

function parseLegacyAdminNotes(
  adminNotes: string,
  threadNoteBodies: Set<string>
): Array<{ date: string; text: string }> {
  const legacy: Array<{ date: string; text: string }> = [];
  for (const line of adminNotes.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const match = trimmed.match(LEGACY_ADMIN_NOTE_LINE);
    if (!match) continue;
    const text = match[2].trim();
    if (threadNoteBodies.has(text)) continue;
    legacy.push({ date: match[1], text });
  }
  return legacy;
}

export function formatConversationForClipboard(params: {
  ticket: Pick<
    Ticket,
    "description" | "timestamp" | "requesterName" | "requesterEmail" | "adminNotes"
  >;
  messages: ThreadMessage[];
}): string {
  const lines: string[] = [];
  const threadNoteBodies = new Set<string>();

  lines.push("=== Original request ===");
  lines.push(
    `From: ${params.ticket.requesterName || "—"} <${params.ticket.requesterEmail || "—"}>`
  );
  lines.push(`Received: ${params.ticket.timestamp}`);
  lines.push("");
  lines.push(params.ticket.description);
  lines.push("");

  for (const msg of params.messages) {
    if (msg.direction === "system") continue;

    const ts = formatTimestamp(msg.sentAt);
    let header: string;
    switch (msg.direction) {
      case "inbound":
        header = `=== ${ts} — Inbound from ${msg.from} ===`;
        break;
      case "outbound":
        header = `=== ${ts} — Outbound to ${msg.to} ===`;
        break;
      case "admin_note":
        header = `=== ${ts} — Admin note (${msg.from}) ===`;
        threadNoteBodies.add(msg.body.trim());
        break;
      case "redacted":
        header = `=== ${ts} — [Message redacted] ===`;
        break;
      default:
        continue;
    }

    lines.push(header);
    if (
      msg.subject &&
      msg.direction !== "admin_note" &&
      msg.direction !== "redacted"
    ) {
      lines.push(`Subject: ${msg.subject}`);
    }
    if (msg.cc) lines.push(`CC: ${msg.cc}`);
    lines.push(threadBodyToPlainText(msg.body));
    if (msg.attachments?.length) {
      lines.push(
        `Attachments: ${msg.attachments.map((att) => att.filename).join(", ")}`
      );
    }
    lines.push("");
  }

  const legacyNotes = parseLegacyAdminNotes(
    params.ticket.adminNotes,
    threadNoteBodies
  );
  if (legacyNotes.length > 0) {
    lines.push("=== Admin notes (historical) ===");
    for (const note of legacyNotes) {
      lines.push(`• ${note.date} - ${note.text}`);
    }
    lines.push("");
  }

  return lines.join("\n").trimEnd();
}

export const GLEAN_THREAD_SUMMARY_PROMPT =
  "Act as an expert customer support analyst. Review the provided CRM conversation thread below. Please provide: 1. A brief executive summary of the case. 2. A chronological timeline of events including timestamps. 3. A clear list of all internal admin notes and actions taken. 4.Any outstanding questions of action items for the customer or the support agent";

export const GLEAN_RESPONSE_PROMPT =
  "Act as an expert Airbnb customer support analyst. Review the provided CRM conversation thread below. Your goal is to formulate a strict, policy-driven resolution for the host's most recent inquiry. Please provide: 1. A brief executive summary of the host's current issue and what they are requesting. 2. A required reading list of specific internal documents, agent workflow tools, and public Airbnb Help Center articles that dictate the policy for this scenario. 3. A drafted, professional response to the host's most recent email that directly applies the policies from the referenced resources to explain the resolution or next steps.";

export const GLEAN_ESCALATION_PROMPT = `Act as an expert customer support escalation manager. Review the provided CRM conversation thread and internal notes below. Your goal is to extract the most critical information and format it into a clear, concise escalation summary for a different internal team.

Please provide the following:

1. **TL;DR / Reason for Escalation:** A 1-2 sentence summary of exactly what the core issue is and why it is being escalated to another team right now.
2. **Urgency & Customer Impact:** A brief assessment of the severity (e.g., High, Medium, Low) and how this issue is currently impacting the user (e.g., blocked from hosting, payment failed, immediate safety concern).
3. **Actions Already Taken:** A concise bulleted list of all troubleshooting steps, workarounds, or relevant communications already completed by the previous agents. (Focus on preventing duplicate effort by the receiving team).
4. **Key Context & Data Points:** Extract any critical identifiers mentioned in the thread (e.g., Reservation IDs, User IDs, specific error codes, or dates).
5. **The "Ask" / Action Required:** A clear, direct statement of exactly what is required from the receiving team to resolve this escalation or move the case forward.

CRM Thread:
[Insert Thread Here]`;

const GLEAN_SERVICE_CHAT_BASE_URL = "https://one.airbnb.com/chat/newchat";

export function buildGleanServiceChatUrl(message: string): string {
  const params = new URLSearchParams({
    message,
    literateType: "GleanService",
  });
  return `${GLEAN_SERVICE_CHAT_BASE_URL}?${params.toString()}`;
}
