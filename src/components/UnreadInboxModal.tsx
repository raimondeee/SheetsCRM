"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, ChevronRight, ExternalLink, Loader2, RefreshCw, X } from "lucide-react";
import type { GmailUnreadThreadPreview, Ticket } from "@/lib/types";
import { parseTicketRowId } from "@/lib/types";
import { findLinkableTicketsForThread } from "@/lib/gmail-ticket-match";
import {
  getStaleCachedUnreadGmail,
  removeCachedUnreadGmailThread,
  setCachedUnreadGmail,
} from "@/lib/gmail-unread-cache";

interface UnreadInboxModalProps {
  tickets: Ticket[];
  selectedTicketId: string | null;
  bindToSelectedEnabled: boolean;
  appendToSelectedEnabled: boolean;
  onClose: () => void;
  onOpenTicket: (rowId: string) => void;
  onCreatedTicket: (rowId: string) => void;
}

export function UnreadInboxModal({
  tickets,
  selectedTicketId,
  bindToSelectedEnabled,
  appendToSelectedEnabled,
  onClose,
  onOpenTicket,
  onCreatedTicket,
}: UnreadInboxModalProps) {
  const [mounted, setMounted] = useState(false);
  const [loading, setLoading] = useState(() => !getStaleCachedUnreadGmail());
  const [refreshing, setRefreshing] = useState(false);
  const [savingThreadId, setSavingThreadId] = useState<string | null>(null);
  const [dismissingThreadId, setDismissingThreadId] = useState<string | null>(null);
  const [threads, setThreads] = useState<GmailUnreadThreadPreview[]>(
    () => getStaleCachedUnreadGmail()?.threads ?? []
  );
  const [error, setError] = useState<string | null>(null);
  const [expandedMatches, setExpandedMatches] = useState<Record<string, boolean>>({});

  const selectedTicket = useMemo(
    () => tickets.find((ticket) => ticket.rowId === selectedTicketId) ?? null,
    [tickets, selectedTicketId]
  );

  const linkableByThread = useMemo(() => {
    const map = new Map<string, ReturnType<typeof findLinkableTicketsForThread>>();
    for (const thread of threads) {
      map.set(
        thread.threadId,
        findLinkableTicketsForThread(
          {
            fromEmail: thread.fromEmail,
            from: thread.from,
            subject: thread.subject,
          },
          tickets
        )
      );
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

  async function loadUnread(force = false) {
    const stale = getStaleCachedUnreadGmail();
    if (stale && !force) {
      setThreads(stale.threads);
      setLoading(false);
      setRefreshing(true);
    } else if (threads.length === 0) {
      setLoading(true);
    } else {
      setRefreshing(true);
    }

    try {
      const params = new URLSearchParams({ limit: "50" });
      if (force) params.set("refresh", "1");
      const res = await fetch(`/api/gmail/unread?${params.toString()}`, {
        cache: "no-store",
        credentials: "same-origin",
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        throw new Error(data.error ?? "Failed to load unread inbox");
      }
      const next = (data.unread ?? []) as GmailUnreadThreadPreview[];
      setCachedUnreadGmail(next);
      setThreads(next);
      setError(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to load unread inbox";
      setError(message);
      if (!stale) setThreads([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => {
    void loadUnread(false);
  }, []);

  async function prefetchTicketThread(rowId: string) {
    const ticket = tickets.find((t) => t.rowId === rowId);
    if (!ticket?.requesterEmail.trim()) return;
    const params = new URLSearchParams({
      email: ticket.requesterEmail,
      timestamp: ticket.timestamp,
    });
    await fetch(
      `/api/tickets/${encodeURIComponent(rowId)}/thread?${params.toString()}&_=${Date.now()}`,
      { cache: "no-store", credentials: "same-origin" }
    );
  }

  async function openLinkedTicket(linkedRowId: string, threadId: string) {
    setSavingThreadId(threadId);
    try {
      await prefetchTicketThread(linkedRowId);
      onOpenTicket(linkedRowId);
    } finally {
      setSavingThreadId(null);
    }
  }

  async function linkThreadToTicket(
    thread: GmailUnreadThreadPreview,
    ticket: Ticket,
    mode: "bind" | "append"
  ) {
    setSavingThreadId(thread.threadId);
    setError(null);
    try {
      const res = await fetch(`/api/tickets/${encodeURIComponent(ticket.rowId)}/thread/link`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          threadId: thread.openUrl,
          selectedApiThreadId: thread.threadId,
          requesterEmail: thread.fromEmail || ticket.requesterEmail,
          replace: false,
          append: mode === "append",
        }),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        throw new Error(data.error ?? "Failed to link thread to ticket");
      }
      onOpenTicket(ticket.rowId);
      await loadUnread(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to link thread");
    } finally {
      setSavingThreadId(null);
    }
  }

  async function bindToSelected(thread: GmailUnreadThreadPreview, append: boolean) {
    if (!selectedTicket) return;
    await linkThreadToTicket(thread, selectedTicket, append ? "append" : "bind");
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
      await loadUnread(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create ticket");
    } finally {
      setSavingThreadId(null);
    }
  }

  async function dismissUnreadThread(thread: GmailUnreadThreadPreview) {
    setDismissingThreadId(thread.threadId);
    setError(null);
    try {
      const res = await fetch("/api/gmail/unread/dismiss", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ threadId: thread.threadId }),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        throw new Error(data.error ?? "Failed to mark thread as read");
      }
      removeCachedUnreadGmailThread(thread.threadId);
      setThreads((prev) => prev.filter((item) => item.threadId !== thread.threadId));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to mark thread as read");
    } finally {
      setDismissingThreadId(null);
    }
  }

  function toggleMatches(threadId: string) {
    setExpandedMatches((prev) => ({ ...prev, [threadId]: !prev[threadId] }));
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
              Link threads to CRM tickets. Append keeps replies on the ticket&apos;s primary thread.
              {" "}
              <span className="text-zendesk-navy">
                Green &ldquo;Linked to row&rdquo; is the same Gmail thread ID — use Append if the
                customer started a new email thread.
              </span>
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void loadUnread(true)}
              disabled={loading || refreshing}
              className="inline-flex items-center gap-1 rounded border border-zendesk-border bg-white px-2 py-1 text-xs text-zendesk-navy hover:bg-gray-100 disabled:opacity-60"
            >
              <RefreshCw className={`h-3 w-3 ${refreshing ? "animate-spin" : ""}`} />
              {refreshing ? "Updating…" : "Refresh"}
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
              Selected ticket: row {parseTicketRowId(selectedTicket.rowId)?.rowNumber ?? "?"} ·{" "}
              {selectedTicket.requesterEmail || "(no requester email)"}
              {selectedTicket.gmailOpenUrl ? (
                <span className="text-zendesk-navy"> · has Gmail link (append available)</span>
              ) : (
                <span> · no Gmail link yet (bind as primary)</span>
              )}
            </p>
          ) : (
            <p className="mb-3 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              Select a ticket to use quick bind/append actions, or expand possible matches below.
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
                const matches = linkableByThread.get(thread.threadId) ?? [];
                const expanded = expandedMatches[thread.threadId] ?? false;
                const busy = savingThreadId === thread.threadId;
                const dismissing = dismissingThreadId === thread.threadId;
                const rowBusy = busy || dismissing;
                const selectedHasLink = Boolean(selectedTicket?.gmailOpenUrl);

                return (
                  <li
                    key={thread.threadId}
                    className="rounded border border-zendesk-border bg-white p-3"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-zendesk-navy">
                          {thread.subject}
                        </p>
                        <p className="mt-0.5 truncate text-xs text-zendesk-muted">
                          {thread.from || "(unknown sender)"} ·{" "}
                          {new Date(thread.latestAt).toLocaleString()}
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
                              onClick={() => void openLinkedTicket(linked, thread.threadId)}
                              className="rounded border border-green-200 bg-green-50 px-1.5 py-0.5 text-green-700 hover:bg-green-100"
                            >
                              Linked to row {linkedRow ?? "?"}
                            </button>
                          ) : matches.length > 0 ? (
                            <span className="rounded border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-amber-800">
                              {matches.length} possible CRM match{matches.length === 1 ? "" : "es"}
                            </span>
                          ) : (
                            <span className="rounded border border-zendesk-border px-1.5 py-0.5 text-zendesk-muted">
                              No linked CRM ticket
                            </span>
                          )}
                        </div>

                        {!linked && matches.length > 0 && (
                          <div className="mt-2">
                            <button
                              type="button"
                              onClick={() => toggleMatches(thread.threadId)}
                              className="inline-flex items-center gap-1 text-xs font-medium text-zendesk-navy hover:text-zendesk-teal"
                            >
                              {expanded ? (
                                <ChevronDown className="h-3.5 w-3.5" />
                              ) : (
                                <ChevronRight className="h-3.5 w-3.5" />
                              )}
                              Possible CRM tickets ({matches.length})
                            </button>
                            {expanded && (
                              <ul className="mt-2 space-y-1.5 border-l-2 border-zendesk-border/60 pl-3">
                                {matches.map((match) => (
                                  <li
                                    key={match.rowId}
                                    className="rounded border border-zendesk-border/70 bg-gray-50 px-2.5 py-2"
                                  >
                                    <div className="flex flex-wrap items-start justify-between gap-2">
                                      <div className="min-w-0">
                                        <p className="text-xs font-semibold text-zendesk-navy">
                                          Row {match.rowNumber}
                                          {match.reservationCode
                                            ? ` · ${match.reservationCode}`
                                            : ""}
                                        </p>
                                        <p className="truncate text-[11px] text-zendesk-muted">
                                          {match.requesterEmail || "(no email)"} · {match.status}
                                        </p>
                                        <p className="truncate text-[11px] text-zendesk-muted">
                                          {match.crmSubjectLabel || "(no subject)"}
                                        </p>
                                        <p className="mt-0.5 text-[10px] text-zendesk-muted">
                                          {match.reasons.join(" · ")}
                                        </p>
                                      </div>
                                      <div className="flex shrink-0 flex-col gap-1">
                                        {bindToSelectedEnabled && (
                                          <button
                                            type="button"
                                            disabled={rowBusy || match.hasGmailLink}
                                            title={
                                              match.hasGmailLink
                                                ? "Ticket already has a primary Gmail link — use Append"
                                                : "Set as primary Gmail thread"
                                            }
                                            onClick={() =>
                                              void linkThreadToTicket(thread, tickets.find((t) => t.rowId === match.rowId)!, "bind")
                                            }
                                            className="rounded border border-zendesk-border bg-white px-2 py-1 text-[11px] text-zendesk-navy hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50"
                                          >
                                            Bind
                                          </button>
                                        )}
                                        {appendToSelectedEnabled && (
                                          <button
                                            type="button"
                                            disabled={rowBusy || !match.hasGmailLink}
                                            title={
                                              match.hasGmailLink
                                                ? "Import this thread; replies stay on the original thread"
                                                : "Requires an existing primary Gmail link on the ticket"
                                            }
                                            onClick={() =>
                                              void linkThreadToTicket(thread, tickets.find((t) => t.rowId === match.rowId)!, "append")
                                            }
                                            className="rounded border border-violet-200 bg-violet-50 px-2 py-1 text-[11px] font-medium text-violet-900 hover:bg-violet-100 disabled:cursor-not-allowed disabled:opacity-50"
                                          >
                                            Append
                                          </button>
                                        )}
                                      </div>
                                    </div>
                                  </li>
                                ))}
                              </ul>
                            )}
                          </div>
                        )}
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
                            {selectedTicket && (
                              <>
                                {bindToSelectedEnabled && (
                                  <button
                                    type="button"
                                    disabled={rowBusy || selectedHasLink}
                                    onClick={() => void bindToSelected(thread, false)}
                                    className="rounded border border-zendesk-border bg-white px-2 py-1 text-xs text-zendesk-navy hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50"
                                  >
                                    {busy ? "Linking…" : "Bind to selected"}
                                  </button>
                                )}
                                {appendToSelectedEnabled && (
                                  <button
                                    type="button"
                                    disabled={rowBusy || !selectedHasLink}
                                    onClick={() => void bindToSelected(thread, true)}
                                    className="rounded border border-violet-200 bg-violet-50 px-2 py-1 text-xs font-medium text-violet-900 hover:bg-violet-100 disabled:cursor-not-allowed disabled:opacity-50"
                                  >
                                    {busy ? "Appending…" : "Append to selected"}
                                  </button>
                                )}
                              </>
                            )}
                            <button
                              type="button"
                              disabled={rowBusy}
                              onClick={() => void createTicketFromThread(thread)}
                              className="rounded border border-zendesk-border bg-white px-2 py-1 text-xs text-zendesk-navy hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              {busy ? "Creating…" : "Create ticket"}
                            </button>
                          </>
                        )}
                        <button
                          type="button"
                          disabled={rowBusy}
                          title="Mark as read in Gmail and remove from this list"
                          onClick={() => void dismissUnreadThread(thread)}
                          className="rounded border border-zendesk-border bg-white px-2 py-1 text-xs text-zendesk-muted hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {dismissing ? "Marking read…" : "Mark as read"}
                        </button>
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
