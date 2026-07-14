"use client";

import { useState } from "react";
import { ChevronDown, Paperclip, X } from "lucide-react";
import { formatFileSize } from "@/lib/gmail-attachments";

const attachmentRowClass =
  "flex items-center gap-2 rounded border border-amber-200 bg-white px-2 py-1.5 text-xs";

interface ComposeAttachmentItem {
  id: string;
  name: string;
  sizeBytes: number;
}

interface ComposeAttachmentListProps {
  items: ComposeAttachmentItem[];
  onRemove: (id: string) => void;
  disabled?: boolean;
}

export function ComposeAttachmentList({
  items,
  onRemove,
  disabled = false,
}: ComposeAttachmentListProps) {
  const [expanded, setExpanded] = useState(false);
  if (items.length === 0) return null;

  if (items.length === 1) {
    const item = items[0]!;
    return (
      <ul className="space-y-0.5">
        <li className={attachmentRowClass}>
          <Paperclip className="h-3.5 w-3.5 shrink-0 text-amber-700" aria-hidden />
          <span className="min-w-0 flex-1 truncate" title={item.name}>
            {item.name}
          </span>
          <span className="shrink-0 text-zendesk-muted">{formatFileSize(item.sizeBytes)}</span>
          <button
            type="button"
            onClick={() => onRemove(item.id)}
            disabled={disabled}
            className="shrink-0 rounded p-0.5 text-zendesk-muted hover:bg-gray-100 hover:text-zendesk-navy disabled:opacity-50"
            aria-label={`Remove ${item.name}`}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </li>
      </ul>
    );
  }

  return (
    <div className="space-y-0.5">
      <button
        type="button"
        onClick={() => setExpanded((open) => !open)}
        className={`${attachmentRowClass} w-full text-left font-medium text-amber-900 hover:bg-amber-50`}
        aria-expanded={expanded}
      >
        <Paperclip className="h-3.5 w-3.5 shrink-0 text-amber-700" aria-hidden />
        <span className="min-w-0 flex-1">More…</span>
        <span className="shrink-0 text-zendesk-muted">
          {items.length} files · {formatFileSize(items.reduce((sum, item) => sum + item.sizeBytes, 0))}
        </span>
        <ChevronDown
          className={`h-3.5 w-3.5 shrink-0 text-amber-700 transition-transform ${
            expanded ? "rotate-180" : ""
          }`}
          aria-hidden
        />
      </button>
      {expanded ? (
        <ul className="space-y-0.5 pl-1">
          {items.map((item) => (
            <li key={item.id} className={attachmentRowClass}>
              <Paperclip className="h-3.5 w-3.5 shrink-0 text-amber-700" aria-hidden />
              <span className="min-w-0 flex-1 truncate" title={item.name}>
                {item.name}
              </span>
              <span className="shrink-0 text-zendesk-muted">{formatFileSize(item.sizeBytes)}</span>
              <button
                type="button"
                onClick={() => onRemove(item.id)}
                disabled={disabled}
                className="shrink-0 rounded p-0.5 text-zendesk-muted hover:bg-gray-100 hover:text-zendesk-navy disabled:opacity-50"
                aria-label={`Remove ${item.name}`}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

interface ThreadAttachmentItem {
  id: string;
  filename: string;
  sizeBytes: number;
  downloadHref: string;
}

interface ThreadAttachmentListProps {
  items: ThreadAttachmentItem[];
}

export function ThreadAttachmentList({ items }: ThreadAttachmentListProps) {
  const [expanded, setExpanded] = useState(false);
  if (items.length === 0) return null;

  if (items.length === 1) {
    const item = items[0]!;
    return (
      <ul className="mt-2 space-y-1 rounded-md border border-amber-200 bg-amber-50/70 p-2">
        <li className="text-[10px] font-semibold uppercase tracking-wide text-amber-900">
          Attachments
        </li>
        <li>
          <a
            href={item.downloadHref}
            download={item.filename}
            className="inline-flex items-center gap-1.5 rounded border border-amber-300 bg-white px-2 py-1 text-xs font-medium text-amber-900 hover:bg-amber-100"
          >
            <Paperclip className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{item.filename}</span>
            <span className="text-zendesk-muted">({formatFileSize(item.sizeBytes)})</span>
          </a>
        </li>
      </ul>
    );
  }

  return (
    <div className="mt-2 space-y-1 rounded-md border border-amber-200 bg-amber-50/70 p-2">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-amber-900">
        Attachments
      </div>
      <button
        type="button"
        onClick={() => setExpanded((open) => !open)}
        className="inline-flex w-full items-center gap-1.5 rounded border border-amber-300 bg-white px-2 py-1 text-xs font-medium text-amber-900 hover:bg-amber-100"
        aria-expanded={expanded}
      >
        <Paperclip className="h-3.5 w-3.5 shrink-0" />
        <span>More…</span>
        <span className="text-zendesk-muted">({items.length} files)</span>
        <ChevronDown
          className={`ml-auto h-3.5 w-3.5 shrink-0 transition-transform ${
            expanded ? "rotate-180" : ""
          }`}
          aria-hidden
        />
      </button>
      {expanded ? (
        <ul className="space-y-1">
          {items.map((item) => (
            <li key={item.id}>
              <a
                href={item.downloadHref}
                download={item.filename}
                className="inline-flex w-full items-center gap-1.5 rounded border border-amber-300 bg-white px-2 py-1 text-xs font-medium text-amber-900 hover:bg-amber-100"
              >
                <Paperclip className="h-3.5 w-3.5 shrink-0" />
                <span className="min-w-0 flex-1 truncate">{item.filename}</span>
                <span className="shrink-0 text-zendesk-muted">
                  ({formatFileSize(item.sizeBytes)})
                </span>
              </a>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
