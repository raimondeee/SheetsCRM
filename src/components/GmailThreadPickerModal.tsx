"use client";

import { X } from "lucide-react";
import type { GmailThreadCandidatePreview } from "@/lib/types";

interface GmailThreadPickerModalProps {
  candidates: GmailThreadCandidatePreview[];
  onClose: () => void;
  onSelect: (apiThreadId: string) => void;
  selecting?: boolean;
}

function formatFolderLabels(folders: string[]): string {
  const labels = folders
    .map((folder) => (folder === "SENT" ? "Sent" : folder === "INBOX" ? "Inbox" : folder))
    .filter(Boolean);
  return labels.length > 0 ? labels.join(" · ") : "Gmail";
}

function formatPreviewDate(sentAt: string): string {
  const date = new Date(sentAt);
  if (Number.isNaN(date.getTime())) return sentAt;
  return date.toLocaleString();
}

export function GmailThreadPickerModal({
  candidates,
  onClose,
  onSelect,
  selecting = false,
}: GmailThreadPickerModalProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div
        role="dialog"
        aria-labelledby="gmail-thread-picker-title"
        className="flex max-h-[85vh] w-full max-w-lg flex-col rounded-lg border border-zendesk-border bg-white shadow-xl"
      >
        <div className="flex items-start justify-between border-b border-zendesk-border px-4 py-3">
          <div>
            <h2 id="gmail-thread-picker-title" className="text-sm font-semibold text-zendesk-navy">
              Choose Gmail thread
            </h2>
            <p className="mt-1 text-xs text-zendesk-muted">
              Multiple threads matched your link. Select the conversation you want to link.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={selecting}
            className="rounded p-1 text-zendesk-muted hover:bg-gray-100 disabled:opacity-50"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <ul className="overflow-y-auto px-2 py-2">
          {candidates.map((candidate) => (
            <li key={candidate.apiThreadId} className="mb-2 last:mb-0">
              <button
                type="button"
                onClick={() => onSelect(candidate.apiThreadId)}
                disabled={selecting}
                className="w-full rounded-lg border border-zendesk-border bg-white px-3 py-3 text-left transition-colors hover:border-zendesk-green hover:bg-green-50 disabled:opacity-50"
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-medium text-zendesk-navy">{candidate.subject}</p>
                  <span className="shrink-0 text-[10px] font-medium uppercase text-zendesk-muted">
                    {formatFolderLabels(candidate.folders)}
                  </span>
                </div>
                <p className="mt-1 text-xs text-zendesk-muted">
                  {candidate.from}
                  {candidate.to ? ` → ${candidate.to}` : ""}
                </p>
                <p className="mt-1 line-clamp-2 text-xs text-zendesk-muted">{candidate.snippet}</p>
                <p className="mt-2 text-[10px] text-zendesk-muted">
                  {formatPreviewDate(candidate.sentAt)}
                  {candidate.messageCount > 1
                    ? ` · ${candidate.messageCount} messages`
                    : " · 1 message"}
                </p>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
