"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { ExternalLink, X } from "lucide-react";
import { TRUST_ESCALATION_TEAMS } from "@/lib/trust-escalations";

interface TrustEscalationsModalProps {
  onClose: () => void;
}

export function TrustEscalationsModal({ onClose }: TrustEscalationsModalProps) {
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div
        role="dialog"
        aria-labelledby="trust-escalations-title"
        className="flex max-h-[90vh] w-full max-w-2xl flex-col rounded-lg border border-zendesk-border bg-white shadow-xl"
      >
        <div className="flex shrink-0 items-start justify-between border-b border-zendesk-border px-4 py-3">
          <div>
            <h2 id="trust-escalations-title" className="text-sm font-semibold text-zendesk-navy">
              Trust Escalations
            </h2>
            <p className="mt-1 text-xs text-zendesk-muted">
              Choose the team that matches the case — each link opens their Jira request form.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-zendesk-muted hover:bg-gray-100"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <ul className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3">
          {TRUST_ESCALATION_TEAMS.map((team) => (
            <li
              key={team.id}
              className="rounded-lg border border-zendesk-border bg-gray-50/70 p-3"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-sm font-semibold text-zendesk-navy">{team.name}</h3>
                    <span className="rounded bg-zendesk-navy px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">
                      {team.shortName}
                    </span>
                  </div>
                  <p className="mt-2 text-xs leading-relaxed text-zendesk-muted">{team.guidance}</p>
                </div>
                <a
                  href={team.formUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex shrink-0 items-center gap-1 rounded border border-zendesk-border bg-white px-2.5 py-1.5 text-xs font-medium text-blue-600 hover:bg-blue-50 hover:underline"
                >
                  Open form
                  <ExternalLink className="h-3 w-3 shrink-0" />
                </a>
              </div>
            </li>
          ))}
        </ul>

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
