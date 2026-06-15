"use client";

import { useEffect, useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight, Copy, Trash2, X } from "lucide-react";
import { stripHtmlToText } from "@/lib/html-utils";
import {
  clearSendArchive,
  loadSendArchive,
  SEND_ARCHIVE_LIMIT,
  subscribeSendArchive,
  type SendArchiveEntry,
  type SendArchiveStatus,
} from "@/lib/send-archive";

interface SendArchivePanelProps {
  onExpandedChange?: (expanded: boolean) => void;
}

function SectionToggle({
  expanded,
  onToggle,
  children,
  collapseIcon = false,
}: {
  expanded: boolean;
  onToggle: () => void;
  children: ReactNode;
  collapseIcon?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="flex w-full items-start gap-1.5 text-left"
      aria-expanded={expanded}
    >
      {collapseIcon ? (
        <ChevronDown className="mt-0.5 h-3.5 w-3.5 shrink-0 text-zendesk-muted" />
      ) : (
        <ChevronRight
          className={`mt-0.5 h-3.5 w-3.5 shrink-0 text-zendesk-muted transition-transform duration-200 ${
            expanded ? "rotate-90" : ""
          }`}
        />
      )}
      <span className="block text-xs font-semibold uppercase text-zendesk-muted">{children}</span>
    </button>
  );
}

function statusLabel(status: SendArchiveStatus): string {
  switch (status) {
    case "queued":
      return "Queued";
    case "sent":
      return "Sent";
    case "failed":
      return "Failed";
    case "cancelled":
      return "Cancelled";
  }
}

function statusClass(status: SendArchiveStatus): string {
  switch (status) {
    case "sent":
      return "bg-green-100 text-green-800";
    case "failed":
      return "bg-red-100 text-red-800";
    case "cancelled":
      return "bg-gray-100 text-gray-700";
    default:
      return "bg-amber-100 text-amber-900";
  }
}

function formatWhen(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

async function copyText(text: string) {
  await navigator.clipboard.writeText(text);
}

function ArchiveRow({ entry }: { entry: SendArchiveEntry }) {
  const [expanded, setExpanded] = useState(false);
  const plainBody = stripHtmlToText(entry.message);

  return (
    <li className="rounded border border-zendesk-border bg-white">
      <button
        type="button"
        onClick={() => setExpanded((open) => !open)}
        className="flex w-full items-start gap-1.5 px-2 py-1.5 text-left"
        aria-expanded={expanded}
      >
        {expanded ? (
          <ChevronDown className="mt-0.5 h-3 w-3 shrink-0 text-zendesk-muted" />
        ) : (
          <ChevronRight className="mt-0.5 h-3 w-3 shrink-0 text-zendesk-muted" />
        )}
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-1.5">
            <span
              className={`rounded px-1 py-0.5 text-[9px] font-medium uppercase ${statusClass(entry.status)}`}
            >
              {statusLabel(entry.status)}
            </span>
            <span className="truncate text-[11px] font-medium text-zendesk-navy">
              {entry.label || entry.to}
            </span>
          </span>
          <span className="mt-0.5 block truncate text-[10px] text-zendesk-muted">
            {entry.subject}
          </span>
          <span className="mt-0.5 block text-[9px] text-zendesk-muted">
            {formatWhen(entry.savedAt)}
            {entry.statusAfterSend === "resolved" ? " · Resolved" : " · Pending"}
          </span>
        </span>
      </button>
      {expanded && (
        <div className="space-y-2 border-t border-zendesk-border px-2 py-2 text-[10px] text-zendesk-navy">
          <div className="flex flex-wrap gap-1">
            <button
              type="button"
              onClick={() => void copyText(entry.subject)}
              className="inline-flex items-center gap-1 rounded border border-zendesk-border bg-white px-1.5 py-0.5 hover:bg-gray-100"
            >
              <Copy className="h-3 w-3" />
              Subject
            </button>
            <button
              type="button"
              onClick={() => void copyText(plainBody)}
              className="inline-flex items-center gap-1 rounded border border-zendesk-border bg-white px-1.5 py-0.5 hover:bg-gray-100"
            >
              <Copy className="h-3 w-3" />
              Body
            </button>
            <button
              type="button"
              onClick={() => void copyText(entry.message)}
              className="inline-flex items-center gap-1 rounded border border-zendesk-border bg-white px-1.5 py-0.5 hover:bg-gray-100"
            >
              <Copy className="h-3 w-3" />
              HTML
            </button>
          </div>
          <p>
            <span className="text-zendesk-muted">To:</span> {entry.to}
          </p>
          {entry.cc && (
            <p>
              <span className="text-zendesk-muted">Cc:</span> {entry.cc}
            </p>
          )}
          {entry.bcc && (
            <p>
              <span className="text-zendesk-muted">Bcc:</span> {entry.bcc}
            </p>
          )}
          {entry.errorMessage && <p className="text-red-700">{entry.errorMessage}</p>}
          {entry.attachments.length > 0 && (
            <ul className="space-y-0.5">
              {entry.attachments.map((file) => (
                <li key={file.filename}>
                  <a
                    href={`data:${file.mimeType};base64,${file.data}`}
                    download={file.filename}
                    className="text-blue-600 hover:underline"
                  >
                    {file.filename}
                  </a>
                </li>
              ))}
            </ul>
          )}
          <div
            className="max-h-32 overflow-y-auto rounded border border-zendesk-border bg-gray-50 p-2 text-[10px] leading-relaxed"
            dangerouslySetInnerHTML={{ __html: entry.message || "<p><em>(empty)</em></p>" }}
          />
        </div>
      )}
    </li>
  );
}

export function SendArchivePanel({ onExpandedChange }: SendArchivePanelProps) {
  const [expanded, setExpanded] = useState(false);
  const [entries, setEntries] = useState<SendArchiveEntry[]>([]);

  function setExpandedState(open: boolean) {
    setExpanded(open);
    onExpandedChange?.(open);
  }

  function toggleExpanded() {
    setExpandedState(!expanded);
  }

  useEffect(() => {
    setEntries(loadSendArchive());
    return subscribeSendArchive(() => setEntries(loadSendArchive()));
  }, []);

  useEffect(() => {
    if (!expanded) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setExpandedState(false);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [expanded]);

  const collapsedBarClass =
    "shrink-0 border-t border-zendesk-border bg-zendesk-sidebar p-3";

  const listContent =
    entries.length === 0 ? (
      <p className="text-xs text-zendesk-muted">No sends saved yet.</p>
    ) : (
      <ul className="min-h-0 flex-1 space-y-1 overflow-y-auto">
        {entries.map((entry) => (
          <ArchiveRow key={entry.id} entry={entry} />
        ))}
      </ul>
    );

  return (
    <>
      {expanded && (
        <div
          className="absolute inset-x-0 bottom-0 top-0 z-20 flex min-h-0 flex-col border-t border-zendesk-border bg-white shadow-xl"
          role="dialog"
          aria-label="Recent sends"
        >
          <div className="flex shrink-0 items-center gap-2 border-b border-zendesk-border px-3 py-2.5">
            <button
              type="button"
              onClick={() => setExpandedState(false)}
              className="flex min-w-0 flex-1 items-start gap-1.5 text-left"
              aria-label="Collapse recent sends"
            >
              <ChevronDown className="mt-0.5 h-3.5 w-3.5 shrink-0 text-zendesk-muted" />
              <span className="block text-xs font-semibold uppercase text-zendesk-muted">
                Recent sends
              </span>
            </button>
            {entries.length > 0 && (
              <button
                type="button"
                onClick={() => clearSendArchive()}
                title="Clear send archive"
                aria-label="Clear send archive"
                className="shrink-0 rounded border border-zendesk-border p-1.5 text-zendesk-muted hover:bg-gray-100 hover:text-zendesk-navy"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            )}
            <button
              type="button"
              onClick={() => setExpandedState(false)}
              className="shrink-0 rounded border border-zendesk-border p-1.5 text-zendesk-muted hover:bg-gray-100 hover:text-zendesk-navy"
              aria-label="Close recent sends"
              title="Collapse (Esc)"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden p-3 pt-2">
            <p className="shrink-0 text-[10px] text-zendesk-muted">
              Last {SEND_ARCHIVE_LIMIT} queued emails (full copy, this browser)
            </p>
            <div className="mt-2 flex min-h-0 flex-1 flex-col">{listContent}</div>
          </div>
          <div className="shrink-0 border-t border-zendesk-border bg-gray-50 px-3 py-2">
            <button
              type="button"
              onClick={() => setExpandedState(false)}
              className="w-full rounded border border-zendesk-border bg-white px-2 py-1.5 text-xs font-medium text-zendesk-navy hover:bg-gray-100"
            >
              Collapse recent sends
            </button>
          </div>
        </div>
      )}
      {!expanded && (
        <div className={collapsedBarClass}>
          <SectionToggle expanded={expanded} onToggle={toggleExpanded}>
            Recent sends{entries.length > 0 ? ` (${entries.length})` : ""}
          </SectionToggle>
        </div>
      )}
    </>
  );
}
