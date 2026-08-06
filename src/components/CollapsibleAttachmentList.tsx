"use client";

import { useState } from "react";
import { Check, ChevronDown, Loader2, Paperclip, X } from "lucide-react";
import { formatFileSize } from "@/lib/gmail-attachments";
import { rowAttachmentFolderName } from "@/lib/attachment-download-folder";

const attachmentRowClass =
  "flex items-center gap-2 rounded border border-amber-200 bg-white px-2 py-1.5 text-xs";

interface ThreadAttachmentItem {
  id: string;
  filename: string;
  sizeBytes: number;
  downloadHref: string;
}

function triggerBrowserDownload(blob: Blob, filename: string): void {
  const objectUrl = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement("a");
    anchor.href = objectUrl;
    anchor.download = filename || "attachment";
    anchor.rel = "noopener";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  } finally {
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1_000);
  }
}

async function downloadThreadAttachment(
  item: ThreadAttachmentItem
): Promise<"folder" | "browser"> {
  const href = new URL(item.downloadHref, window.location.origin);
  href.searchParams.set("saveLocal", "1");

  const res = await fetch(href.toString(), {
    cache: "no-store",
    credentials: "same-origin",
  });

  if (!res.ok) {
    let message = `Download failed (${res.status})`;
    try {
      const data = (await res.json()) as { error?: string };
      if (data.error?.trim()) message = data.error.trim();
    } catch {
      /* non-JSON error body */
    }
    throw new Error(message);
  }

  const savedTo = res.headers.get("X-SheetsCRM-Saved-To");
  const blob = await res.blob();
  const filename = item.filename || "attachment";

  // Server wrote into ~/Documents/SheetsCRM-Attachments/Row {n}/ (same as Finder).
  if (savedTo) return "folder";

  // Fallback when row number could not be resolved server-side.
  triggerBrowserDownload(blob, filename);
  return "browser";
}

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

interface ThreadAttachmentListProps {
  items: ThreadAttachmentItem[];
  rowNumber: number;
}

export function ThreadAttachmentDownloadButton({
  item,
  rowNumber,
}: {
  item: ThreadAttachmentItem;
  rowNumber: number;
}) {
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const rowFolder = rowAttachmentFolderName(rowNumber);

  async function handleClick() {
    if (busy) return;
    setBusy(true);
    setSaved(false);
    try {
      const mode = await downloadThreadAttachment(item);
      if (mode === "folder") {
        setSaved(true);
        window.setTimeout(() => setSaved(false), 2000);
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to download attachment";
      window.alert(message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={() => void handleClick()}
      disabled={busy}
      title={
        busy
          ? "Downloading…"
          : saved
            ? `Saved to ${rowFolder} in your attachment downloads folder`
            : `Download ${item.filename} (saves to ${rowFolder} in your attachment downloads folder)`
      }
      className="inline-flex w-full items-center gap-1.5 rounded border border-amber-300 bg-white px-2 py-1 text-xs font-medium text-amber-900 hover:bg-amber-100 disabled:cursor-wait disabled:opacity-70"
    >
      {busy ? (
        <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
      ) : saved ? (
        <Check className="h-3.5 w-3.5 shrink-0 text-emerald-600" />
      ) : (
        <Paperclip className="h-3.5 w-3.5 shrink-0" />
      )}
      <span className="min-w-0 flex-1 truncate text-left">{item.filename}</span>
      <span className="shrink-0 text-zendesk-muted">({formatFileSize(item.sizeBytes)})</span>
    </button>
  );
}

export function ThreadAttachmentList({ items, rowNumber }: ThreadAttachmentListProps) {
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
          <ThreadAttachmentDownloadButton item={item} rowNumber={rowNumber} />
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
              <ThreadAttachmentDownloadButton item={item} rowNumber={rowNumber} />
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
