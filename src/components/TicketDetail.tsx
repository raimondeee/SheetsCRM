"use client";

import { useCallback, useEffect, useState } from "react";
import type { Ticket, ThreadMessage } from "@/lib/types";
import { DEFAULT_STATUSES } from "@/lib/types";
import {
  buildGmailMessageUrl,
  buildGmailSearchUrl,
  buildGmailThreadUrl,
} from "@/lib/gmail-urls";
import { buildSalesforceUnifiedSearchUrl } from "@/lib/salesforce";
import { extractEmailFromField } from "@/lib/email-utils";
import { MixmaxTemplatePicker } from "./MixmaxTemplatePicker";
import { ExternalLink, Mail, Send } from "lucide-react";

interface TicketDetailProps {
  ticket: Ticket | null;
  onStatusChange: (rowId: string, status: string) => void;
  onSubjectChange: (rowId: string, subject: string) => void;
  onAppendAdminNote: (rowId: string, note: string) => Promise<void>;
  onAirbnbUserIdChange: (rowId: string, airbnbUserId: string) => Promise<void>;
  onSlaChange: (rowId: string, hours: number) => void;
  onThreadUpdate: () => void;
}

export function TicketDetail({
  ticket,
  onStatusChange,
  onSubjectChange,
  onAppendAdminNote,
  onAirbnbUserIdChange,
  onSlaChange,
  onThreadUpdate,
}: TicketDetailProps) {
  const [messages, setMessages] = useState<ThreadMessage[]>([]);
  const [replyBody, setReplyBody] = useState("");
  const [subjectDraft, setSubjectDraft] = useState("");
  const [newAdminNote, setNewAdminNote] = useState("");
  const [addingNote, setAddingNote] = useState(false);
  const [airbnbUserIdDraft, setAirbnbUserIdDraft] = useState("");
  const [savingUserId, setSavingUserId] = useState(false);
  const [sending, setSending] = useState(false);
  const [ccMarketManager, setCcMarketManager] = useState(false);

  const loadThread = useCallback(async () => {
    if (!ticket) return;
    const params = new URLSearchParams({
      email: ticket.requesterEmail,
      subject: ticket.subject,
    });
    const res = await fetch(
      `/api/tickets/${encodeURIComponent(ticket.rowId)}/thread?${params.toString()}&_=${Date.now()}`,
      { cache: "no-store", credentials: "same-origin" }
    );
    const data = await res.json();
    setMessages(data.messages ?? []);
  }, [ticket]);

  useEffect(() => {
    if (!ticket) {
      setMessages([]);
      setSubjectDraft("");
      setNewAdminNote("");
      setAirbnbUserIdDraft("");
      setCcMarketManager(false);
      return;
    }
    setSubjectDraft(ticket.subject);
    setAirbnbUserIdDraft(ticket.airbnbUserId);
    loadThread();
  }, [ticket?.rowId, ticket?.subject, ticket?.airbnbUserId, loadThread]);

  useEffect(() => {
    if (!ticket) return;
    const intervalMs =
      (Number(process.env.NEXT_PUBLIC_AUTO_REFRESH_SECONDS) || 60) * 1000;
    const id = setInterval(() => {
      if (document.visibilityState === "visible") loadThread();
    }, intervalMs);
    return () => clearInterval(id);
  }, [ticket?.rowId, loadThread]);

  if (!ticket) {
    return (
      <main className="flex flex-1 items-center justify-center text-sm text-zendesk-muted">
        Select a ticket to view details
      </main>
    );
  }

  async function saveSubject() {
    if (!ticket) return;
    const trimmed = subjectDraft.trim();
    if (!trimmed || trimmed === ticket.subject) return;
    onSubjectChange(ticket.rowId, trimmed);
  }

  async function addAdminNote() {
    if (!ticket || !newAdminNote.trim()) return;
    setAddingNote(true);
    try {
      await onAppendAdminNote(ticket.rowId, newAdminNote.trim());
      setNewAdminNote("");
    } finally {
      setAddingNote(false);
    }
  }

  async function saveAirbnbUserId() {
    if (!ticket) return;
    const trimmed = airbnbUserIdDraft.trim();
    if (trimmed === ticket.airbnbUserId) return;
    setSavingUserId(true);
    try {
      await onAirbnbUserIdChange(ticket.rowId, trimmed);
    } finally {
      setSavingUserId(false);
    }
  }

  async function sendReply() {
    if (!replyBody.trim() || !ticket) return;
    setSending(true);
    try {
      const res = await fetch(`/api/tickets/${encodeURIComponent(ticket.rowId)}/thread`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to: ticket.requesterEmail,
          subject: subjectDraft.trim() || ticket.subject,
          message: replyBody,
          cc: ccMarketManager ? marketManagerEmail : null,
        }),
      });
      const data = await res.json();
      if (data.messages) {
        setMessages(data.messages);
        setReplyBody("");
        onThreadUpdate();
      } else if (data.message) {
        setMessages((prev) => [...prev, data.message]);
        setReplyBody("");
        onThreadUpdate();
      }
    } finally {
      setSending(false);
    }
  }

  const marketManagerEmail = extractEmailFromField(ticket.marketManager);
  const gmailSearchUrl = buildGmailSearchUrl(ticket.requesterEmail);
  const salesforceSearchUrl = buildSalesforceUnifiedSearchUrl(ticket.requesterEmail);

  const gmailThreadId =
    [...messages].reverse().find((m) => m.gmailThreadId)?.gmailThreadId ?? null;
  const gmailThreadUrl = gmailThreadId ? buildGmailThreadUrl(gmailThreadId) : null;

  function applyTemplate(template: { subject: string; body: string }) {
    if (!ticket) return;
    if (template.subject.trim()) {
      setSubjectDraft(template.subject.trim());
      onSubjectChange(ticket.rowId, template.subject.trim());
    }
    if (template.body.trim()) setReplyBody(template.body.trim());
  }

  function openInGmail() {
    if (!ticket) return;
    const url = gmailThreadUrl ?? gmailSearchUrl;
    if (!url) return;
    window.open(url, "_blank", "noopener,noreferrer");
  }

  return (
    <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
      <div className="border-b border-zendesk-border px-6 py-4">
        <label className="block text-xs font-medium text-zendesk-muted">Subject (email line)</label>
        <input
          type="text"
          value={subjectDraft}
          onChange={(e) => setSubjectDraft(e.target.value)}
          onBlur={saveSubject}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.currentTarget.blur();
            }
          }}
          className="mt-1 w-full rounded border border-zendesk-border px-3 py-2 text-lg font-semibold outline-none focus:border-zendesk-green"
          placeholder="Support request subject"
        />
        <p className="mt-1 text-sm text-zendesk-muted">
          {ticket.requesterName} · {ticket.requesterEmail} · Row {ticket.rowNumber}
        </p>
        <div className="mt-2 flex flex-wrap gap-3 text-sm">
          {ticket.contactReason && (
            <p>
              <span className="text-zendesk-muted">Contact reason: </span>
              <span className="rounded bg-gray-100 px-2 py-0.5">{ticket.contactReason}</span>
            </p>
          )}
          <p>
            <span className="text-zendesk-muted">Market Manager: </span>
            <span className="rounded bg-gray-100 px-2 py-0.5">
              {ticket.marketManager || "—"}
            </span>
            <span className="ml-1 text-[10px] text-zendesk-muted">(from sheet, read-only)</span>
          </p>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-sm">
            <span className="text-zendesk-muted">CRM Status</span>
            <select
              value={ticket.status}
              onChange={(e) => onStatusChange(ticket.rowId, e.target.value)}
              className="rounded border border-zendesk-border px-2 py-1 text-sm"
            >
              {DEFAULT_STATUSES.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2 text-sm">
            <span className="text-zendesk-muted">Sheet status (N)</span>
            <span className="rounded bg-gray-100 px-2 py-1 text-xs">{ticket.sheetStatus || "—"}</span>
          </label>
          <label className="flex items-center gap-2 text-sm">
            <span className="text-zendesk-muted">SLA</span>
            <select
              value={ticket.slaHours}
              onChange={(e) => onSlaChange(ticket.rowId, Number(e.target.value))}
              className="rounded border border-zendesk-border px-2 py-1 text-sm"
            >
              {[4, 8, 24, 48, 72].map((h) => (
                <option key={h} value={h}>
                  {h}h
                </option>
              ))}
            </select>
            {ticket.slaDueAt && (
              <span className={`text-xs ${ticket.slaBreached ? "text-red-600" : "text-zendesk-muted"}`}>
                Due {new Date(ticket.slaDueAt).toLocaleString()}
              </span>
            )}
          </label>
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col border-r border-zendesk-border">
          <div className="border-b border-zendesk-border bg-gray-50 px-6 py-2 text-xs font-semibold uppercase text-zendesk-muted">
            Conversation
          </div>
          <div className="flex-1 overflow-y-auto px-6 py-4">
            <div className="mb-4 rounded border border-zendesk-border bg-amber-50/50 p-4">
              <p className="text-xs font-semibold uppercase text-zendesk-muted">
                Admin notes (Column U)
              </p>
              <div className="mt-2 min-h-[4rem] whitespace-pre-wrap rounded border border-zendesk-border bg-white p-3 text-sm">
                {ticket.adminNotes || (
                  <span className="text-zendesk-muted">No notes yet.</span>
                )}
              </div>
              <div className="mt-3 flex gap-2">
                <input
                  type="text"
                  value={newAdminNote}
                  onChange={(e) => setNewAdminNote(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") addAdminNote();
                  }}
                  placeholder="Add a note…"
                  className="min-w-0 flex-1 rounded border border-zendesk-border px-3 py-2 text-sm outline-none focus:border-zendesk-green"
                />
                <button
                  type="button"
                  onClick={addAdminNote}
                  disabled={addingNote || !newAdminNote.trim()}
                  className="shrink-0 rounded bg-zendesk-green px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
                >
                  {addingNote ? "Adding…" : "Add"}
                </button>
              </div>
              <p className="mt-1 text-[10px] text-zendesk-muted">
                Appends as • MM/DD/YYYY - your note to the sheet
              </p>
            </div>
            <div className="mb-4 rounded border border-zendesk-border bg-white p-4">
              <p className="text-xs font-semibold text-zendesk-muted">Original request</p>
              <p className="mt-2 whitespace-pre-wrap text-sm">{ticket.description}</p>
              <p className="mt-2 text-xs text-zendesk-muted">{ticket.timestamp}</p>
            </div>
            {messages.map((msg) => (
              <div
                key={msg.id}
                className={`mb-3 rounded border p-4 ${
                  msg.direction === "outbound"
                    ? "ml-8 border-blue-200 bg-blue-50"
                    : "mr-8 border-zendesk-border bg-white"
                }`}
              >
                <div className="flex justify-between gap-2 text-xs text-zendesk-muted">
                  <span>
                    {msg.direction === "outbound" ? "You" : msg.from}
                    {msg.direction === "outbound" ? ` → ${msg.to}` : " replied"}
                  </span>
                  <span>{new Date(msg.sentAt).toLocaleString()}</span>
                </div>
                <p className="mt-1 text-xs font-medium text-zendesk-muted">{msg.subject}</p>
                {msg.cc && (
                  <p className="mt-1 text-xs text-zendesk-muted">CC: {msg.cc}</p>
                )}
                <p className="mt-2 whitespace-pre-wrap text-sm">{msg.body}</p>
                {msg.gmailMessageId && (
                  <a
                    href={buildGmailMessageUrl(msg.gmailMessageId)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-2 inline-flex items-center gap-1 text-xs text-blue-600 hover:underline"
                  >
                    Open in Gmail
                    <ExternalLink className="h-3 w-3" />
                  </a>
                )}
              </div>
            ))}
          </div>
          <div className="border-t border-zendesk-border p-4">
            <textarea
              value={replyBody}
              onChange={(e) => setReplyBody(e.target.value)}
              placeholder="Draft a reply here, or pick a Mixmax template from the sidebar…"
              rows={3}
              className="w-full rounded border border-zendesk-border p-3 text-sm outline-none focus:border-zendesk-green"
            />
            <label className="mt-2 flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={ccMarketManager}
                onChange={(e) => setCcMarketManager(e.target.checked)}
                disabled={!marketManagerEmail}
                className="rounded border-zendesk-border"
              />
              <span>
                CC Market Manager
                <span className="text-zendesk-muted">
                  {!ticket.marketManager
                    ? " (Column H empty — updates on next sheet refresh)"
                    : !marketManagerEmail
                      ? ` (${ticket.marketManager} — no email found)`
                      : ` (${ticket.marketManager})`}
                </span>
              </span>
            </label>
            <div className="mt-2 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={sendReply}
                disabled={sending || !replyBody.trim()}
                className="flex items-center gap-2 rounded bg-zendesk-green px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
              >
                <Send className="h-4 w-4" />
                {sending ? "Sending..." : "Send via CRM"}
              </button>
              <button
                type="button"
                onClick={openInGmail}
                disabled={!gmailThreadUrl && !gmailSearchUrl}
                title={
                  gmailThreadUrl
                    ? "Open this email thread in Gmail"
                    : gmailSearchUrl
                      ? "No CRM thread yet — search Gmail for this contact"
                      : undefined
                }
                className="flex items-center gap-2 rounded border border-zendesk-border bg-white px-4 py-2 text-sm font-medium text-zendesk-muted hover:bg-gray-50 disabled:opacity-50"
              >
                <Mail className="h-4 w-4" />
                Open in Gmail
              </button>
            </div>
          </div>
        </div>

        <aside className="w-72 shrink-0 overflow-y-auto bg-zendesk-sidebar p-4">
          <h3 className="text-xs font-semibold uppercase text-zendesk-muted">Internal tools</h3>
          <ul className="mt-3 space-y-3">
            <li className="rounded border border-zendesk-border bg-white p-3">
              {gmailSearchUrl ? (
                <>
                  <a
                    href={gmailSearchUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1 text-sm font-medium text-blue-600 hover:underline"
                  >
                    Gmail Search
                    <ExternalLink className="h-3 w-3 shrink-0" />
                  </a>
                  <p className="mt-1 break-all text-xs text-zendesk-muted">{ticket.requesterEmail}</p>
                </>
              ) : (
                <p className="text-sm text-zendesk-muted">No email to search</p>
              )}
            </li>
            <li className="rounded border border-zendesk-border bg-white p-3">
              {salesforceSearchUrl ? (
                <a
                  href={salesforceSearchUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 text-sm font-medium text-blue-600 hover:underline"
                >
                  Salesforce Search
                  <ExternalLink className="h-3 w-3 shrink-0" />
                </a>
              ) : (
                <p className="text-sm text-zendesk-muted">No email to search</p>
              )}
              {ticket.requesterEmail && (
                <p className="mt-1 break-all text-xs text-zendesk-muted">{ticket.requesterEmail}</p>
              )}
              <label className="mt-3 block text-xs">
                <span className="font-medium text-zendesk-muted">Airbnb User ID (Column AD)</span>
                <input
                  type="text"
                  value={airbnbUserIdDraft}
                  onChange={(e) => setAirbnbUserIdDraft(e.target.value)}
                  onBlur={saveAirbnbUserId}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") e.currentTarget.blur();
                  }}
                  placeholder="Enter user ID…"
                  className="mt-1 w-full rounded border border-zendesk-border px-2 py-1.5 font-mono text-sm outline-none focus:border-zendesk-green"
                />
                <span className="mt-1 block text-[10px] text-zendesk-muted">
                  {savingUserId ? "Saving to sheet…" : "Synced with Column AD on save"}
                </span>
              </label>
            </li>
          </ul>

          <MixmaxTemplatePicker
            templateContext={{
              fullName: ticket.requesterName,
              email: ticket.requesterEmail,
            }}
            onApply={applyTemplate}
          />
        </aside>
      </div>
    </main>
  );
}
