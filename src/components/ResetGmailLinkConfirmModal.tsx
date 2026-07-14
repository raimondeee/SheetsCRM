"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Link2Off, X } from "lucide-react";

interface ResetGmailLinkConfirmModalProps {
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ResetGmailLinkConfirmModal({
  busy = false,
  onConfirm,
  onCancel,
}: ResetGmailLinkConfirmModalProps) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !busy) onCancel();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [busy, onCancel]);

  if (!mounted) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/45 p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onCancel();
      }}
    >
      <div
        role="alertdialog"
        aria-labelledby="reset-gmail-link-title"
        aria-describedby="reset-gmail-link-desc"
        className="w-full max-w-md rounded-lg border border-violet-300 bg-white shadow-xl"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-violet-200 bg-violet-50 px-4 py-3">
          <div className="flex min-w-0 items-start gap-2">
            <Link2Off className="mt-0.5 h-5 w-5 shrink-0 text-violet-800" />
            <h2 id="reset-gmail-link-title" className="text-sm font-semibold text-violet-950">
              Unlink and start a new thread?
            </h2>
          </div>
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="rounded p-1 text-violet-900/70 hover:bg-violet-100 disabled:opacity-50"
            aria-label="Cancel"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div id="reset-gmail-link-desc" className="space-y-3 px-4 py-4 text-sm text-zendesk-navy">
          <p>
            This removes the Gmail link and clears imported messages from the wrong thread in this
            ticket. The email subject line is cleared as well. Your reply draft body is not changed.
          </p>
          <p>
            The next email you send from this ticket will start a{" "}
            <span className="font-medium">new Gmail conversation</span>, not a reply to the old
            thread.
          </p>
          <p className="text-xs text-zendesk-muted">
            Until you send, the CRM will not auto-link this ticket to Gmail again.
          </p>
        </div>

        <div className="flex justify-end gap-2 border-t border-violet-200 bg-violet-50/60 px-4 py-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="rounded border border-zendesk-border bg-white px-3 py-1.5 text-xs font-medium text-zendesk-navy hover:bg-gray-100 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className="rounded border border-violet-700 bg-violet-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-violet-800 disabled:opacity-50"
          >
            {busy ? "Resetting…" : "Unlink & new thread"}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
