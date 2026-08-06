"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { ExternalLink, X } from "lucide-react";

/** Served from public/gso-triage/index.html — use the full filename (folder URLs 404 in App Router). */
export const GSO_TRIAGE_HREF = "/gso-triage/index.html";

interface GsoTriageModalProps {
  onClose: () => void;
}

export function GsoTriageModal({ onClose }: GsoTriageModalProps) {
  const [mounted, setMounted] = useState(false);

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

  if (!mounted) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-3 sm:p-4">
      <div
        role="dialog"
        aria-labelledby="gso-triage-title"
        className="flex h-[min(92vh,920px)] w-full max-w-5xl flex-col overflow-hidden rounded-lg border border-zendesk-border bg-white shadow-xl"
      >
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-zendesk-border px-4 py-3">
          <div className="min-w-0">
            <h2 id="gso-triage-title" className="text-sm font-semibold text-zendesk-navy">
              GSO Escalations Triage
            </h2>
            <p className="mt-1 text-xs text-zendesk-muted">
              Search Homes escalation playbooks by keyword or team.
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <a
              href={GSO_TRIAGE_HREF}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 rounded border border-zendesk-border px-2.5 py-1.5 text-xs font-medium text-blue-600 hover:bg-blue-50"
              title="Open in a new tab"
            >
              Open tab
              <ExternalLink className="h-3 w-3 shrink-0" />
            </a>
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

        <iframe
          title="GSO Escalations Triage Assistant"
          src={GSO_TRIAGE_HREF}
          className="min-h-0 w-full flex-1 border-0 bg-white"
        />
      </div>
    </div>,
    document.body
  );
}
