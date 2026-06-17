"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { ShieldAlert, X } from "lucide-react";

interface RedactMessageConfirmModalProps {
  messageSummary: string;
  messageWhen: string;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function RedactMessageConfirmModal({
  messageSummary,
  messageWhen,
  busy = false,
  onConfirm,
  onCancel,
}: RedactMessageConfirmModalProps) {
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
        aria-labelledby="redact-confirm-title"
        aria-describedby="redact-confirm-desc"
        className="w-full max-w-md rounded-lg border border-amber-400 bg-white shadow-xl"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-amber-200 bg-amber-50 px-4 py-3">
          <div className="flex min-w-0 items-start gap-2">
            <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" />
            <h2 id="redact-confirm-title" className="text-sm font-semibold text-amber-950">
              Redact this message?
            </h2>
          </div>
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="rounded p-1 text-amber-900/70 hover:bg-amber-100 disabled:opacity-50"
            aria-label="Cancel"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div id="redact-confirm-desc" className="space-y-3 px-4 py-4 text-sm text-zendesk-navy">
          <p>
            This removes the message from the CRM and blocks Gmail from re-importing it. An admin
            note will be added automatically.
          </p>
          <div className="rounded border border-zendesk-border bg-gray-50 px-3 py-2 text-xs">
            <p className="font-medium text-zendesk-navy">{messageSummary}</p>
            <p className="mt-1 text-zendesk-muted">{messageWhen}</p>
          </div>
          <p className="text-xs text-zendesk-muted">
            Delete the message in Gmail separately if it contained sensitive information.
          </p>
        </div>

        <div className="flex justify-end gap-2 border-t border-zendesk-border px-4 py-3">
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
            className="rounded border border-amber-600 bg-amber-500 px-3 py-1.5 text-xs font-semibold text-amber-950 hover:bg-amber-400 disabled:opacity-50"
          >
            {busy ? "Redacting…" : "Redact message"}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
