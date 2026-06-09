"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Ticket, ThreadMessage } from "@/lib/types";
import { DEFAULT_STATUSES } from "@/lib/types";
import {
  buildGmailMessageUrl,
  buildGmailSearchUrl,
  buildGmailThreadUrl,
} from "@/lib/gmail-urls";
import { buildSalesforceUnifiedSearchUrl } from "@/lib/salesforce";
import {
  buildNovaListingUrl,
  buildNovaProfileUrl,
  buildNovaReservationUrl,
} from "@/lib/nova-urls";
import { ADMIN_LOGOUT_URL, buildBecomeUserUrl, isNumericUserId } from "@/lib/become-user-url";
import type { MarketManager } from "@/lib/market-managers";
import { resolveMarketManagerEmail } from "@/lib/market-managers";
import { MixmaxTemplatePicker } from "./MixmaxTemplatePicker";
import { ReplyDraftEditor, type ReplyDraftEditorHandle } from "./ReplyDraftEditor";
import {
  buildEmailSubject,
  EMAIL_SUBJECT_PREFIX,
  stripEmailSubjectPrefix,
} from "@/lib/email-subject";
import { isRichTextEmpty, normalizeDraftHtml } from "@/lib/html-utils";
import { shouldShowSlaTimer } from "@/lib/sla-display";
import { clearReplyDraft, loadReplyDraft, saveReplyDraft } from "@/lib/reply-drafts";
import { loadComposePrefs, saveComposePrefs } from "@/lib/ticket-compose-prefs";
import {
  ChevronRight,
  Copy,
  ExternalLink,
  Link2,
  LogOut,
  Mail,
  Pencil,
  Send,
  Undo2,
  UserRound,
} from "lucide-react";

const UNDO_SEND_SECONDS = 10;

interface TicketDetailProps {
  ticket: Ticket | null;
  contactReasonOptions: string[];
  onStatusChange: (rowId: string, status: string) => void;
  onSubjectChange: (rowId: string, subject: string) => void;
  onContactReasonChange: (rowId: string, contactReason: string) => void;
  onAppendAdminNote: (rowId: string, note: string) => Promise<void>;
  onAirbnbUserIdChange: (rowId: string, airbnbUserId: string) => Promise<void>;
  onReservationCodeChange: (rowId: string, reservationCode: string) => Promise<void>;
  onListingIdChange: (rowId: string, listingId: string) => Promise<void>;
  onSlaChange: (rowId: string, hours: number) => void;
  onThreadUpdate: () => void;
  onAdvanceAfterSend: (rowId: string) => boolean;
  onShowInboxVictory: () => void;
  onRestoreSentTicket: (rowId: string) => void;
  onTicketSent: (rowId: string, status: "pending" | "resolved") => Promise<void>;
}

export function TicketDetail({
  ticket,
  contactReasonOptions,
  onStatusChange,
  onSubjectChange,
  onContactReasonChange,
  onAppendAdminNote,
  onAirbnbUserIdChange,
  onReservationCodeChange,
  onListingIdChange,
  onSlaChange,
  onThreadUpdate,
  onAdvanceAfterSend,
  onShowInboxVictory,
  onRestoreSentTicket,
  onTicketSent,
}: TicketDetailProps) {
  const [messages, setMessages] = useState<ThreadMessage[]>([]);
  const [replyBody, setReplyBody] = useState("");
  const [subjectSuffix, setSubjectSuffix] = useState("");
  const [newAdminNote, setNewAdminNote] = useState("");
  const [addingNote, setAddingNote] = useState(false);
  const [airbnbUserIdDraft, setAirbnbUserIdDraft] = useState("");
  const [savingUserId, setSavingUserId] = useState(false);
  const [sending, setSending] = useState(false);
  const [undoSecondsLeft, setUndoSecondsLeft] = useState(0);
  const [pendingSend, setPendingSend] = useState(false);
  const sendTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const replyEditorRef = useRef<ReplyDraftEditorHandle>(null);
  const pendingPayloadRef = useRef<{
    ticketRowId: string;
    to: string;
    subject: string;
    message: string;
    cc: string | null;
    statusAfterSend: "pending" | "resolved";
  } | null>(null);
  const [pendingSendStatus, setPendingSendStatus] = useState<"pending" | "resolved">("pending");
  const [queuedSendLabel, setQueuedSendLabel] = useState<string | null>(null);
  const pendingVictoryRef = useRef(false);
  const [ccMarketManager, setCcMarketManager] = useState(false);
  const [replyFocused, setReplyFocused] = useState(false);
  const [composeTab, setComposeTab] = useState<"reply" | "admin-notes">("reply");
  const [linkThreadInput, setLinkThreadInput] = useState("");
  const [linkingThread, setLinkingThread] = useState(false);
  const [linkThreadError, setLinkThreadError] = useState<string | null>(null);
  const [gmailLinkExpanded, setGmailLinkExpanded] = useState(true);
  const [mixmaxExpanded, setMixmaxExpanded] = useState(false);
  const [marketManagers, setMarketManagers] = useState<MarketManager[]>([]);

  useEffect(() => {
    return () => {
      if (sendTimerRef.current) clearTimeout(sendTimerRef.current);
      if (countdownRef.current) clearInterval(countdownRef.current);
    };
  }, []);

  useEffect(() => {
    if (pendingSend) return;
    if (sendTimerRef.current) clearTimeout(sendTimerRef.current);
    if (countdownRef.current) clearInterval(countdownRef.current);
    setPendingSend(false);
    setUndoSecondsLeft(0);
    pendingPayloadRef.current = null;
  }, [ticket?.rowId, pendingSend]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await fetch("/api/market-managers");
      const data = await res.json();
      if (!cancelled && !data.error) {
        setMarketManagers(data.managers ?? []);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

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
    if (data.statusReopened) onThreadUpdate();
  }, [ticket?.rowId, ticket?.requesterEmail, ticket?.subject, onThreadUpdate]);

  useEffect(() => {
    if (!ticket) {
      setMessages([]);
      setReplyBody("");
      setSubjectSuffix("");
      setNewAdminNote("");
      setAirbnbUserIdDraft("");
      setCcMarketManager(false);
      setReplyFocused(false);
      setComposeTab("reply");
      return;
    }

    setComposeTab("reply");
    setMixmaxExpanded(false);
    setLinkThreadInput("");
    setLinkThreadError(null);
    const saved = loadReplyDraft(ticket.rowId);
    const prefs = loadComposePrefs(ticket.rowId);
    setReplyBody(saved?.body ?? "");
    setSubjectSuffix(
      saved?.subject ? stripEmailSubjectPrefix(saved.subject) : ""
    );
    setCcMarketManager(prefs.ccMarketManager);
    setAirbnbUserIdDraft(ticket.airbnbUserId);
    setReplyFocused(Boolean(saved?.body && !isRichTextEmpty(saved.body)));
  }, [ticket?.rowId]);

  useEffect(() => {
    if (!ticket) return;
    setAirbnbUserIdDraft(ticket.airbnbUserId);
  }, [ticket?.rowId, ticket?.airbnbUserId]);

  useEffect(() => {
    if (!ticket) return;
    loadThread();
  }, [ticket?.rowId, ticket?.requesterEmail, ticket?.subject, loadThread]);

  useEffect(() => {
    if (!ticket) return;

    const timeout = setTimeout(() => {
      saveReplyDraft(ticket.rowId, {
        body: replyBody,
        subject: buildEmailSubject(subjectSuffix),
      });
    }, 300);

    return () => {
      clearTimeout(timeout);
      saveReplyDraft(ticket.rowId, {
        body: replyBody,
        subject: buildEmailSubject(subjectSuffix),
      });
    };
  }, [ticket?.rowId, replyBody, subjectSuffix]);

  useEffect(() => {
    if (!ticket) return;
    const intervalMs =
      (Number(process.env.NEXT_PUBLIC_AUTO_REFRESH_SECONDS) || 60) * 1000;
    const id = setInterval(() => {
      if (document.visibilityState === "visible") loadThread();
    }, intervalMs);
    return () => clearInterval(id);
  }, [ticket?.rowId, loadThread]);

  const gmailThreadId = useMemo(
    () => [...messages].reverse().find((m) => m.gmailThreadId)?.gmailThreadId ?? null,
    [messages]
  );
  const gmailThreadUrl = gmailThreadId ? buildGmailThreadUrl(gmailThreadId) : null;

  useEffect(() => {
    setGmailLinkExpanded(!gmailThreadUrl);
  }, [ticket?.rowId, gmailThreadUrl]);

  const marketManagerEmail = useMemo(
    () => (ticket ? resolveMarketManagerEmail(ticket.marketManager, marketManagers) : null),
    [ticket, marketManagers]
  );
  const marketManagerFromDirectory = Boolean(
    ticket?.marketManager && marketManagerEmail && !ticket.marketManager.includes("@")
  );

  const contactReasonSelectOptions = useMemo(() => {
    const options = new Set(contactReasonOptions);
    if (ticket?.contactReason.trim()) options.add(ticket.contactReason.trim());
    return [...options].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  }, [contactReasonOptions, ticket?.contactReason]);

  if (!ticket) {
    return (
      <main className="flex flex-1 items-center justify-center text-sm text-zendesk-muted">
        Select a ticket to view details
      </main>
    );
  }

  async function saveSubject() {
    if (!ticket) return;
    const fullSubject = buildEmailSubject(subjectSuffix);
    if (!subjectSuffix.trim() || fullSubject === ticket.subject) return;
    onSubjectChange(ticket.rowId, fullSubject);
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

  async function executeSend() {
    const payload = pendingPayloadRef.current;
    if (!payload) return;
    setSending(true);
    setPendingSend(false);
    setQueuedSendLabel(null);
    setUndoSecondsLeft(0);
    try {
      pendingPayloadRef.current = null;
      const showVictoryAfterSend = pendingVictoryRef.current;
      const { statusAfterSend, ticketRowId, ...sendBody } = payload;
      const res = await fetch(`/api/tickets/${encodeURIComponent(ticketRowId)}/thread`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...sendBody, status: statusAfterSend }),
      });
      const data = await res.json();
      if (!res.ok || data.error) return;

      clearReplyDraft(ticketRowId);
      if (ticket?.rowId === ticketRowId) {
        if (data.messages) setMessages(data.messages);
        else if (data.message) setMessages((prev) => [...prev, data.message]);
        setReplyBody("");
      }
      await onTicketSent(ticketRowId, statusAfterSend);
      onThreadUpdate();
      if (showVictoryAfterSend) {
        pendingVictoryRef.current = false;
        onShowInboxVictory();
      }
    } finally {
      setSending(false);
    }
  }

  function queueSend(statusAfterSend: "pending" | "resolved") {
    if (isRichTextEmpty(replyBody) || !ticket || pendingSend) return;

    const ticketRowId = ticket.rowId;
    pendingPayloadRef.current = {
      ticketRowId,
      to: ticket.requesterEmail,
      subject: buildEmailSubject(subjectSuffix),
      message: replyBody,
      cc: ccMarketManager ? marketManagerEmail : null,
      statusAfterSend,
    };

    setPendingSendStatus(statusAfterSend);
    setQueuedSendLabel(ticket.requesterName || ticket.requesterEmail);
    setPendingSend(true);
    setUndoSecondsLeft(UNDO_SEND_SECONDS);
    const advanced = onAdvanceAfterSend(ticketRowId);
    pendingVictoryRef.current = !advanced;

    if (countdownRef.current) clearInterval(countdownRef.current);
    countdownRef.current = setInterval(() => {
      setUndoSecondsLeft((seconds) => {
        if (seconds <= 1) {
          if (countdownRef.current) clearInterval(countdownRef.current);
          return 0;
        }
        return seconds - 1;
      });
    }, 1000);

    if (sendTimerRef.current) clearTimeout(sendTimerRef.current);
    sendTimerRef.current = setTimeout(() => {
      if (countdownRef.current) clearInterval(countdownRef.current);
      void executeSend();
    }, UNDO_SEND_SECONDS * 1000);
  }

  function undoSend() {
    const queuedRowId = pendingPayloadRef.current?.ticketRowId;
    if (sendTimerRef.current) clearTimeout(sendTimerRef.current);
    if (countdownRef.current) clearInterval(countdownRef.current);
    pendingPayloadRef.current = null;
    setPendingSend(false);
    setQueuedSendLabel(null);
    setUndoSecondsLeft(0);
    pendingVictoryRef.current = false;
    if (queuedRowId) onRestoreSentTicket(queuedRowId);
  }

  const gmailSearchUrl = buildGmailSearchUrl(ticket.requesterEmail);
  const salesforceSearchUrl = buildSalesforceUnifiedSearchUrl(ticket.columnD);
  const novaReservationUrl = buildNovaReservationUrl(ticket.reservationCode);
  const novaListingUrl = buildNovaListingUrl(ticket.listingId);
  const becomeUserId = ticket.airbnbUserId || airbnbUserIdDraft;
  const becomeUserUrl = buildBecomeUserUrl(becomeUserId);
  const novaProfileUrl = buildNovaProfileUrl(becomeUserId);
  const becomeUserIdInvalid =
    becomeUserId.trim().length > 0 && !isNumericUserId(becomeUserId);

  function applyTemplate(template: { subject: string; body: string }) {
    if (!ticket) return;
    if (template.subject.trim()) {
      const suffix = stripEmailSubjectPrefix(template.subject.trim());
      setSubjectSuffix(suffix);
      onSubjectChange(ticket.rowId, buildEmailSubject(suffix));
    }
    if (template.body.trim()) setReplyBody(normalizeDraftHtml(template.body));
    setReplyFocused(true);
    requestAnimationFrame(() => {
      replyEditorRef.current?.focus();
    });
  }

  function openInGmail() {
    if (!ticket) return;
    const url = gmailThreadUrl ?? gmailSearchUrl;
    if (!url) return;
    window.open(url, "_blank", "noopener,noreferrer");
  }

  async function linkGmailThread() {
    if (!ticket || !linkThreadInput.trim() || linkingThread) return;
    setLinkingThread(true);
    setLinkThreadError(null);
    try {
      const res = await fetch(
        `/api/tickets/${encodeURIComponent(ticket.rowId)}/thread/link`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ threadId: linkThreadInput.trim() }),
        }
      );
      const data = await res.json();
      if (!res.ok || data.error) {
        setLinkThreadError(data.error ?? "Failed to link Gmail thread");
        return;
      }
      if (data.messages) setMessages(data.messages);
      setLinkThreadInput("");
      onThreadUpdate();
    } catch {
      setLinkThreadError("Failed to link Gmail thread");
    } finally {
      setLinkingThread(false);
    }
  }

  function handleCcMarketManagerChange(checked: boolean) {
    if (!ticket) return;
    setCcMarketManager(checked);
    saveComposePrefs(ticket.rowId, { ccMarketManager: checked });
  }

  return (
    <main className="relative flex min-w-0 flex-1 flex-col overflow-hidden">
      {pendingSend && (
        <div className="pointer-events-none absolute inset-x-0 bottom-4 z-30 flex justify-center px-4">
          <div className="pointer-events-auto flex max-w-xl flex-wrap items-center gap-3 rounded-lg border border-zendesk-border bg-white px-4 py-3 shadow-lg">
            <button
              type="button"
              onClick={undoSend}
              className="flex items-center gap-2 rounded border border-zendesk-border bg-white px-3 py-1.5 text-sm font-medium text-zendesk-navy hover:bg-gray-50"
            >
              <Undo2 className="h-4 w-4" />
              Undo send ({undoSecondsLeft}s)
            </button>
            <p className="text-sm text-zendesk-muted">
              Sending to {queuedSendLabel ?? "previous ticket"} in {undoSecondsLeft}s — will mark{" "}
              {pendingSendStatus === "resolved" ? "Resolved" : "Pending"}
            </p>
          </div>
        </div>
      )}
      <div className="shrink-0 border-b border-zendesk-border px-4 py-2.5">
        <label className="block text-[11px] font-medium text-zendesk-muted">Subject (email line)</label>
        <div className="mt-0.5 flex overflow-hidden rounded border border-zendesk-border focus-within:border-zendesk-green">
          <span className="shrink-0 border-r border-zendesk-border bg-gray-50 px-2.5 py-1.5 text-sm font-medium text-zendesk-muted">
            {EMAIL_SUBJECT_PREFIX}
          </span>
          <input
            type="text"
            value={subjectSuffix}
            onChange={(e) => setSubjectSuffix(e.target.value)}
            onBlur={saveSubject}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.currentTarget.blur();
              }
            }}
            className="min-w-0 flex-1 px-2.5 py-1.5 text-base font-semibold outline-none"
            placeholder="Add subject details…"
          />
        </div>
        <p className="mt-0.5 text-xs text-zendesk-muted">
          {ticket.requesterName} · {ticket.requesterEmail} · Row {ticket.rowNumber}
        </p>
        <div className="mt-1.5 flex flex-wrap gap-2 text-xs">
          <p>
            <span className="text-zendesk-muted">Market Manager: </span>
            <span className="rounded bg-gray-100 px-1.5 py-0.5">
              {ticket.marketManager || "—"}
            </span>
            {marketManagerFromDirectory && (
              <span className="ml-1 text-[10px] text-zendesk-muted">({marketManagerEmail})</span>
            )}
            <span className="ml-1 text-[10px] text-zendesk-muted">(from sheet, read-only)</span>
          </p>
          {ticket.needsInitialResponse && (
            <span className="rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-semibold text-red-700">
              Needs initial response (&gt;48h)
            </span>
          )}
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1.5 text-xs">
            <span className="text-zendesk-muted">CRM Status</span>
            <select
              value={ticket.status}
              onChange={(e) => onStatusChange(ticket.rowId, e.target.value)}
              className="rounded border border-zendesk-border px-2 py-0.5 text-xs"
            >
              {DEFAULT_STATUSES.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-1.5 text-xs">
            <span className="text-zendesk-muted">Contact reason</span>
            <select
              value={ticket.contactReason}
              onChange={(e) => onContactReasonChange(ticket.rowId, e.target.value)}
              title="Updates sheet Column I on change"
              className="rounded border border-zendesk-border px-2 py-0.5 text-xs"
            >
              <option value="">—</option>
              {contactReasonSelectOptions.map((reason) => (
                <option key={reason} value={reason}>
                  {reason}
                </option>
              ))}
            </select>
          </label>
          {shouldShowSlaTimer(ticket) && (
            <label className="flex items-center gap-1.5 text-xs">
              <span className="text-zendesk-muted">SLA</span>
              <select
                value={ticket.slaHours}
                onChange={(e) => onSlaChange(ticket.rowId, Number(e.target.value))}
                className="rounded border border-zendesk-border px-2 py-0.5 text-xs"
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
          )}
          <NovaSheetLinkField
            label="Reso"
            value={ticket.reservationCode}
            href={novaReservationUrl}
            maxDisplayLength={10}
            onSave={(value) => onReservationCodeChange(ticket.rowId, value)}
          />
          <NovaSheetLinkField
            label="Listing"
            value={ticket.listingId}
            href={novaListingUrl}
            onSave={(value) => onListingIdChange(ticket.rowId, value)}
          />
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col border-r border-zendesk-border">
          <div className="border-b border-zendesk-border bg-gray-50 px-6 py-2 text-xs font-semibold uppercase text-zendesk-muted">
            Conversation
          </div>
          <div className="flex-1 overflow-y-auto px-6 py-4">
            <div className="mb-4 rounded border border-zendesk-border bg-white p-4">
              <p className="text-xs font-semibold text-zendesk-muted">Original request</p>
              <p className="mt-2 whitespace-pre-wrap text-sm">{ticket.description}</p>
              <p className="mt-2 text-xs text-zendesk-muted">{ticket.timestamp}</p>
            </div>
            {messages.map((msg) => {
              if (msg.direction === "system") {
                return (
                  <div
                    key={msg.id}
                    className="mb-3 rounded border border-violet-200 bg-violet-50 p-4"
                  >
                    <div className="flex justify-between gap-2 text-xs text-zendesk-muted">
                      <span>SheetsCRM</span>
                      <span>{new Date(msg.sentAt).toLocaleString()}</span>
                    </div>
                    <p className="mt-2 text-sm">{msg.body}</p>
                    {msg.gmailThreadId && (
                      <a
                        href={buildGmailThreadUrl(msg.gmailThreadId)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:underline"
                      >
                        View full history in Gmail
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    )}
                  </div>
                );
              }

              return (
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
              );
            })}
          </div>
          <div className="shrink-0 border-t border-zendesk-border">
            <div className="flex border-b border-zendesk-border bg-gray-50 px-4">
              <button
                type="button"
                onClick={() => setComposeTab("reply")}
                className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
                  composeTab === "reply"
                    ? "border-zendesk-green text-zendesk-navy"
                    : "border-transparent text-zendesk-muted hover:text-zendesk-navy"
                }`}
              >
                Email draft
              </button>
              <button
                type="button"
                onClick={() => setComposeTab("admin-notes")}
                className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
                  composeTab === "admin-notes"
                    ? "border-zendesk-green text-zendesk-navy"
                    : "border-transparent text-zendesk-muted hover:text-zendesk-navy"
                }`}
              >
                Admin notes
              </button>
            </div>
            <div className="p-4">
              {composeTab === "reply" ? (
                <>
                  <ReplyDraftEditor
                    ref={replyEditorRef}
                    value={replyBody}
                    onChange={setReplyBody}
                    focused={replyFocused}
                    onFocusChange={setReplyFocused}
                    placeholder="Draft a reply here, or pick a Mixmax template from the sidebar…"
                  />
                  <label className="mt-2 flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={ccMarketManager}
                      onChange={(e) => handleCcMarketManagerChange(e.target.checked)}
                      disabled={!marketManagerEmail}
                      className="rounded border-zendesk-border"
                    />
                    <span>
                      CC Market Manager
                      <span className="text-zendesk-muted">
                        {!ticket.marketManager
                          ? " (Column H empty — updates on next sheet refresh)"
                          : !marketManagerEmail
                            ? ` (${ticket.marketManager} — add email in Setup → Market managers)`
                            : marketManagerFromDirectory
                              ? ` (${ticket.marketManager} → ${marketManagerEmail})`
                              : ` (${ticket.marketManager})`}
                      </span>
                    </span>
                  </label>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => queueSend("pending")}
                      disabled={sending || pendingSend || isRichTextEmpty(replyBody)}
                      className="flex items-center gap-2 rounded bg-zendesk-green px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                    >
                      <Send className="h-4 w-4" />
                      {sending ? "Sending..." : "Send and mark pending"}
                    </button>
                    <button
                      type="button"
                          onClick={() => queueSend("resolved")}
                      disabled={sending || pendingSend || isRichTextEmpty(replyBody)}
                      className="flex items-center gap-2 rounded border border-zendesk-green bg-white px-4 py-2 text-sm font-medium text-zendesk-green hover:bg-green-50 disabled:opacity-50"
                    >
                      <Send className="h-4 w-4" />
                      {sending ? "Sending..." : "Send and mark resolved"}
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
                </>
              ) : (
                <div className="rounded border border-amber-200/80 bg-amber-100/75 p-3">
                  <div
                    className="max-h-[25vh] min-h-[4.5rem] overflow-y-auto whitespace-pre-wrap rounded border border-amber-200/60 bg-amber-50/90 p-2.5 text-sm"
                  >
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
              )}
            </div>
          </div>
        </div>

        <aside className="relative flex w-72 shrink-0 flex-col overflow-hidden bg-zendesk-sidebar">
          <div
            className={`flex min-h-0 flex-1 flex-col overflow-y-auto p-4 pb-2 transition-opacity duration-200 ${
              mixmaxExpanded ? "pointer-events-none overflow-hidden opacity-25" : ""
            }`}
          >
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
              <button
                type="button"
                onClick={() => setGmailLinkExpanded((open) => !open)}
                className="flex w-full items-start gap-1.5 text-left"
                aria-expanded={gmailLinkExpanded}
              >
                <ChevronRight
                  className={`mt-0.5 h-3.5 w-3.5 shrink-0 text-zendesk-muted transition-transform duration-200 ${
                    gmailLinkExpanded ? "rotate-90" : ""
                  }`}
                />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium text-zendesk-navy">
                    {gmailThreadUrl ? "Gmail thread linked" : "Link Gmail thread"}
                  </span>
                  {!gmailLinkExpanded && gmailThreadUrl && (
                    <span className="mt-0.5 block text-xs text-zendesk-muted">
                      Click to open linked thread
                    </span>
                  )}
                  {!gmailLinkExpanded && !gmailThreadUrl && (
                    <span className="mt-0.5 block text-xs text-zendesk-muted">
                      Click to link a pre-CRM conversation
                    </span>
                  )}
                </span>
              </button>
              {gmailLinkExpanded && (
                <div className="mt-2 pl-5">
                  {gmailThreadUrl ? (
                    <>
                      <p className="text-xs text-zendesk-muted">
                        This ticket is linked to a Gmail thread.
                      </p>
                      <a
                        href={gmailThreadUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-2 inline-flex items-center gap-1 text-sm font-medium text-blue-600 hover:underline"
                      >
                        Open linked thread
                        <ExternalLink className="h-3 w-3 shrink-0" />
                      </a>
                    </>
                  ) : (
                    <>
                      <p className="text-xs text-zendesk-muted">
                        For conversations started before the CRM, paste a Gmail thread URL or ID.
                      </p>
                      <input
                        type="text"
                        value={linkThreadInput}
                        onChange={(e) => setLinkThreadInput(e.target.value)}
                        placeholder="https://mail.google.com/.../#inbox/…"
                        className="mt-2 w-full rounded border border-zendesk-border px-2 py-1.5 text-xs outline-none focus:border-zendesk-green"
                      />
                      {linkThreadError && (
                        <p className="mt-1 text-xs text-red-600">{linkThreadError}</p>
                      )}
                      <button
                        type="button"
                        onClick={linkGmailThread}
                        disabled={linkingThread || !linkThreadInput.trim()}
                        className="mt-2 flex w-full items-center justify-center gap-1 rounded border border-zendesk-border bg-gray-50 px-2 py-1.5 text-xs font-medium text-zendesk-navy hover:bg-gray-100 disabled:opacity-50"
                      >
                        <Link2 className="h-3.5 w-3.5" />
                        {linkingThread ? "Linking…" : "Link thread"}
                      </button>
                    </>
                  )}
                </div>
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
                <p className="text-sm text-zendesk-muted">No Column D value to search</p>
              )}
              {ticket.columnD && (
                <p className="mt-1 break-all text-xs text-zendesk-muted">{ticket.columnD}</p>
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
                <button
                  type="button"
                  onClick={() => {
                    if (novaProfileUrl) {
                      window.open(novaProfileUrl, "_blank", "noopener,noreferrer");
                    }
                  }}
                  disabled={!novaProfileUrl}
                  title={
                    novaProfileUrl
                      ? "Open user profile in Nova"
                      : "Enter a numeric user ID for Nova profile"
                  }
                  className="mt-2 flex w-full items-center justify-center gap-2 rounded border border-zendesk-border bg-white px-3 py-2 text-sm font-medium text-zendesk-navy hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <UserRound className="h-4 w-4" />
                  Nova profile
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (becomeUserUrl) {
                      window.open(becomeUserUrl, "_blank", "noopener,noreferrer");
                    }
                  }}
                  disabled={!becomeUserUrl}
                  title={
                    becomeUserUrl
                      ? "Open Become User in admin.airbnb.com"
                      : becomeUserIdInvalid
                        ? "User ID must be numeric only (emails and text are not supported)"
                        : "Enter a numeric user ID first"
                  }
                  className="mt-2 flex w-full items-center justify-center gap-2 rounded border border-violet-700 bg-violet-600 px-3 py-2 text-sm font-medium text-white hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <UserRound className="h-4 w-4" />
                  Become user
                </button>
                <button
                  type="button"
                  onClick={() => window.open(ADMIN_LOGOUT_URL, "_blank", "noopener,noreferrer")}
                  title="Log out of all users in admin.airbnb.com"
                  className="mt-2 flex w-full items-center justify-center gap-2 rounded border border-zendesk-border bg-white px-3 py-2 text-sm font-medium text-zendesk-navy hover:bg-gray-50"
                >
                  <LogOut className="h-4 w-4" />
                  Log out of all users
                </button>
              </label>
            </li>
            </ul>
          </div>

          <MixmaxTemplatePicker
            key={ticket.rowId}
            templateContext={{
              fullName: ticket.requesterName,
              email: ticket.requesterEmail,
            }}
            onApply={applyTemplate}
            onExpandedChange={setMixmaxExpanded}
          />
        </aside>
      </div>
    </main>
  );
}

function NovaSheetLinkField({
  label,
  value,
  href,
  maxDisplayLength,
  onSave,
}: {
  label: string;
  value: string;
  href: string | null;
  maxDisplayLength?: number;
  onSave?: (value: string) => void | Promise<void>;
}) {
  const [copied, setCopied] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const trimmed = value.trim();

  useEffect(() => {
    if (!isEditing) setDraft(value);
  }, [value, isEditing]);

  const displayValue =
    maxDisplayLength && trimmed.length > maxDisplayLength
      ? `${trimmed.slice(0, maxDisplayLength)}…`
      : trimmed || "—";

  async function copyValue() {
    if (!trimmed) return;
    await navigator.clipboard.writeText(trimmed);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }

  async function saveDraft() {
    const next = draft.trim();
    if (next === trimmed) {
      setIsEditing(false);
      return;
    }
    await onSave?.(next);
    setIsEditing(false);
  }

  return (
    <label className="flex items-center gap-1.5 text-xs">
      <span className="text-zendesk-muted">{label}</span>
      <span className="flex items-center gap-1">
        {isEditing ? (
          <input
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => void saveDraft()}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
              if (e.key === "Escape") {
                setDraft(value);
                setIsEditing(false);
              }
            }}
            autoFocus
            className="w-28 rounded border border-zendesk-green px-1.5 py-0.5 font-mono text-xs outline-none"
          />
        ) : href ? (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            title={trimmed ? `Open in Nova (${label}): ${trimmed}` : `Open in Nova (${label})`}
            className="rounded border border-zendesk-border bg-white px-1.5 py-0.5 font-mono text-xs text-blue-600 hover:bg-gray-50 hover:underline"
          >
            {displayValue}
          </a>
        ) : (
          <span
            className="rounded border border-zendesk-border px-1.5 py-0.5 font-mono text-xs text-zendesk-muted"
            title={trimmed || undefined}
          >
            {displayValue}
          </span>
        )}
        {trimmed && !isEditing && (
          <button
            type="button"
            onClick={copyValue}
            title={copied ? "Copied!" : `Copy ${label}`}
            aria-label={copied ? "Copied" : `Copy ${label} to clipboard`}
            className="rounded border border-zendesk-border p-1 text-zendesk-muted hover:bg-gray-50 hover:text-zendesk-navy"
          >
            <Copy className="h-3.5 w-3.5" />
          </button>
        )}
        {onSave && !isEditing && (
          <button
            type="button"
            onClick={() => setIsEditing(true)}
            title={`Edit ${label}`}
            aria-label={`Edit ${label}`}
            className="rounded border border-zendesk-border p-1 text-zendesk-muted hover:bg-gray-50 hover:text-zendesk-navy"
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
        )}
      </span>
    </label>
  );
}
