"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { ExternalLink, Loader2, RefreshCw, X } from "lucide-react";
import type { GmailUnreadThreadPreview, Ticket } from "@/lib/types";
import { parseTicketRowId } from "@/lib/types";

interface UnreadInboxModalProps {
  tickets: Ticket[];
  selectedTicketId: string | null;
  onClose: () => void;
  onOpenTicket: (rowId: string) => void;
  onCreatedTicket: (rowId: string) => void;
}

export function UnreadInboxModal({
  tickets,
  selectedTicketId,
  onClose,
  onOpenTicket,
  onCreatedTicket,
}: UnreadInboxModalProps) {
  const [mounted, setMounted] = useState(false);
  const [loading, setLoading] = useState(true);
  const [savingThreadId, setSavingThreadId] = useState<string | null>(null);
  const [threads, setThreads] = useState<GmailUnreadThreadPreview[]>([]);
  const [error, setError] = useState<string | null>(null);

  const selectedTicket = useMemo(
    () => tickets.find((ticket) => ticket.rowId === selectedTicketId) ?? null,
    [tickets, selectedTicketId]
  );

  const emailMatches = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const thread of threads) {
      const matches = tickets
        .filter(
          (ticket) =>
            ticket.requesterEmail.trim().toLowerCase() === thread.fromEmail.trim().toLowerCase()
        )
        .map((ticket) => ticket.rowId);
      map.set(thread.threadId, matches);
    }
    return map;
  }, [threads, tickets]);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  async function loadUnread() {
    setLoading(true);
    try {
      const res = await fetch("/api/gmail/unread?limit=50", {
        cache: "no-store",
        credentials: "same-origin",
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        throw new Error(data.error ?? "Failed to load unread inbox");
      }
      setThreads((data.unread ?? []) as GmailUnreadThreadPreview[]);
      setError(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to load unread inbox";
      setError(message);
      setThreads([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadUnread();
  }, []);

  async function bindToSelected(thread: GmailUnreadThreadPreview) {
    if (!selectedTicket) return;
    setSavingThreadId(thread.threadId);
    try {
      const res = await fetch(`/api/tickets/${encodeURIComponent(selectedTicket.rowId)}/thread/link`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          threadId: thread.openUrl,
          selectedApiThreadId: thread.threadId,
          requesterEmail: thread.fromEmail,
          replace: false,
        }),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        throw new Error(data.error ?? "Failed to bind thread to ticket");
      }
      await loadUnread();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to bind thread");
    } finally {
      setSavingThreadId(null);
    }
  }

  async function createTicketFromThread(thread: GmailUnreadThreadPreview) {
    setSavingThreadId(thread.threadId);
    try {
      const res = await fetch("/api/gmail/unread/ticket", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          threadId: thread.threadId,
          from: thread.from,
          fromEmail: thread.fromEmail,
          subject: thread.subject,
          snippet: thread.snippet,
        }),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        throw new Error(data.error ?? "Failed to create ticket");
      }
      onCreatedTicket(data.rowId as string);
      await loadUnread();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create ticket");
    } finally {
      setSavingThreadId(null);
    }
  }

  if (!mounted) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div
        role="dialog"
        aria-labelledby="unread-inbox-title"
        className="flex max-h-[90vh] w-full max-w-5xl flex-col rounded-lg border border-zendesk-border bg-white shadow-xl"
      >
        <div className="flex shrink-0 items-start justify-between border-b border-zendesk-border px-4 py-3">
          <div>
            <h2 id="unread-inbox-title" className="text-sm font-semibold text-zendesk-navy">
              Gmail unread inbox
            </h2>
            <p className="mt-1 text-xs text-zendesk-muted">
              At-a-glance unread threads with CRM linking and ticket creation actions.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void loadUnread()}
              className="inline-flex items-center gap-1 rounded border border-zendesk-border bg-white px-2 py-1 text-xs text-zendesk-navy hover:bg-gray-100"
            >
              <RefreshCw className="h-3 w-3" />
              Refresh
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded p-1 text-zendesk-muted hover:bg-gray-100"
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          {selectedTicket ? (
            <p className="mb-3 rounded border border-zendesk-border bg-gray-50 px-3 py-2 text-xs text-zendesk-muted">
              Bind target: row {parseTicketRowId(selectedTicket.rowId)?.rowNumber ?? "?"} ·{" "}
              {selectedTicket.requesterEmail || "(no requester email)"}
            </p>
          ) : (
            <p className="mb-3 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              Select a ticket first to enable “Bind to selected ticket”.
            </p>
          )}

          {error && (
            <p className="mb-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
              {error}
            </p>
          )}

          {loading ? (
            <div className="flex items-center gap-2 text-sm text-zendesk-muted">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading unread inbox…
            </div>
          ) : threads.length === 0 ? (
            <p className="text-sm text-zendesk-muted">No unread inbox threads.</p>
          ) : (
            <ul className="space-y-2">
              {threads.map((thread) => {
                const linked = thread.linkedTicketRowId;
                const linkedRow = linked ? parseTicketRowId(linked)?.rowNumber : null;
                const matches = emailMatches.get(thread.threadId) ?? [];
                const busy = savingThreadId === thread.threadId;
                return (
                  <li
                    key={thread.threadId}
                    className="rounded border border-zendesk-border bg-white p-3"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-zendesk-navy">
                          {thread.subject}
                        </p>
                        <p className="mt-0.5 truncate text-xs text-zendesk-muted">
                          {thread.from || "(unknown sender)"} · {new Date(thread.latestAt).toLocaleString()}
                        </p>
                        <p className="mt-1 max-w-[38rem] truncate text-xs text-zendesk-muted">
                          {thread.snippet || "(no snippet)"}
                        </p>
                        <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px]">
                          <span className="rounded bg-gray-100 px-1.5 py-0.5 text-zendesk-muted">
                            unread {thread.unreadCount}
                          </span>
                          <span className="rounded bg-gray-100 px-1.5 py-0.5 text-zendesk-muted">
                            msgs {thread.messageCount}
                          </span>
                          {linked ? (
                            <button
                              type="button"
                              onClick={() => onOpenTicket(linked)}
                              className="rounded border border-green-200 bg-green-50 px-1.5 py-0.5 text-green-700 hover:bg-green-100"
                            >
                              Linked to row {linkedRow ?? "?"}
                            </button>
                          ) : matches.length > 0 ? (
                            <span className="rounded border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-amber-800">
                              Email matches row {parseTicketRowId(matches[0])?.rowNumber ?? "?"}
                            </span>
                          ) : (
                            <span className="rounded border border-zendesk-border px-1.5 py-0.5 text-zendesk-muted">
                              No linked CRM ticket
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-1.5">
                        <a
                          href={thread.openUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 rounded border border-zendesk-border bg-white px-2 py-1 text-xs text-blue-600 hover:bg-blue-50"
                        >
                          Open in Gmail
                          <ExternalLink className="h-3 w-3" />
                        </a>
                        {!linked && (
                          <>
                            <button
                              type="button"
                              disabled={!selectedTicket || busy}
                              onClick={() => void bindToSelected(thread)}
                              className="rounded border border-zendesk-border bg-white px-2 py-1 text-xs text-zendesk-navy hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              {busy ? "Binding…" : "Bind to selected ticket"}
                            </button>
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => void createTicketFromThread(thread)}
                              className="rounded border border-zendesk-border bg-white px-2 py-1 text-xs text-zendesk-navy hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              {busy ? "Creating…" : "Create ticket"}
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="shrink-0 border-t border-zendesk-border bg-gray-50 px-4 py-3">
          <button
            type="button"
            onClick={onClose}
            className="w-full rounded border border-zendesk-border bg-white px-3 py-2 text-xs font-medium text-zendesk-navy hover:bg-gray-100"
          >
            Close
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
