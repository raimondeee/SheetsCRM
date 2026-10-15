"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { CircleCheck, X } from "lucide-react";
import {
  CLOSE_OUTCOME_COLUMNS,
  parseCloseOutcomeAnswer,
  type CloseOutcomeAnswer,
  type CloseOutcomeAnswers,
  type CloseOutcomeRole,
} from "@/lib/close-outcome";

interface CloseCaseOutcomeModalProps {
  initial?: CloseOutcomeAnswers | null;
  confirmLabel: string;
  busy?: boolean;
  onConfirm: (answers: CloseOutcomeAnswers) => void;
  onCancel: () => void;
}

type Draft = Record<CloseOutcomeRole, CloseOutcomeAnswer | "">;

function emptyDraft(initial?: CloseOutcomeAnswers | null): Draft {
  return {
    inFavorOfHost: initial?.inFavorOfHost ?? "",
    csInTheWrong: initial?.csInTheWrong ?? "",
    remediationSuccessful: initial?.remediationSuccessful ?? "",
  };
}

export function CloseCaseOutcomeModal({
  initial,
  confirmLabel,
  busy = false,
  onConfirm,
  onCancel,
}: CloseCaseOutcomeModalProps) {
  const [mounted, setMounted] = useState(false);
  const [draft, setDraft] = useState<Draft>(() => emptyDraft(initial));

  useEffect(() => {
    setMounted(true);
  }, []);

  const answers = parseComplete(draft);
  const complete = answers != null;

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
        role="dialog"
        aria-labelledby="close-case-outcome-title"
        aria-describedby="close-case-outcome-desc"
        className="w-full max-w-md rounded-lg border border-zendesk-border bg-white shadow-xl"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-zendesk-border px-4 py-3">
          <div className="flex min-w-0 items-start gap-2">
            <CircleCheck className="mt-0.5 h-5 w-5 shrink-0 text-zendesk-teal" />
            <div>
              <h2 id="close-case-outcome-title" className="text-sm font-semibold text-zendesk-navy">
                Close case
              </h2>
              <p id="close-case-outcome-desc" className="mt-0.5 text-xs text-zendesk-muted">
                Required for closed cases. Written to sheet columns P–R.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="rounded p-1 text-zendesk-muted hover:bg-gray-100 disabled:opacity-50"
            aria-label="Cancel"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-3 px-4 py-4">
          {CLOSE_OUTCOME_COLUMNS.map((column) => (
            <fieldset key={column.role} className="min-w-0">
              <legend className="text-sm font-medium text-zendesk-navy">{column.label}</legend>
              {column.hint ? (
                <p className="mt-0.5 text-[11px] text-zendesk-muted">{column.hint}</p>
              ) : null}
              <div className="mt-1.5 flex gap-1.5">
                {(["Yes", "No"] as const).map((option) => {
                  const selected = draft[column.role] === option;
                  return (
                    <button
                      key={option}
                      type="button"
                      disabled={busy}
                      aria-pressed={selected}
                      onClick={() =>
                        setDraft((current) => ({ ...current, [column.role]: option }))
                      }
                      className={`flex-1 rounded border px-2.5 py-1.5 text-xs font-medium disabled:opacity-50 ${
                        selected
                          ? "border-zendesk-green bg-emerald-50 text-zendesk-navy"
                          : "border-zendesk-border bg-white text-zendesk-muted hover:bg-gray-50"
                      }`}
                    >
                      {option}
                    </button>
                  );
                })}
              </div>
            </fieldset>
          ))}
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
            onClick={() => {
              if (!answers || busy) return;
              onConfirm(answers);
            }}
            disabled={!complete || busy}
            className="rounded border border-[#FF5A5F] bg-[#FF5A5F] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#e84e53] disabled:opacity-50"
          >
            {busy ? "Saving…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

function parseComplete(draft: Draft): CloseOutcomeAnswers | null {
  const inFavorOfHost = parseCloseOutcomeAnswer(draft.inFavorOfHost);
  const csInTheWrong = parseCloseOutcomeAnswer(draft.csInTheWrong);
  const remediationSuccessful = parseCloseOutcomeAnswer(draft.remediationSuccessful);
  if (!inFavorOfHost || !csInTheWrong || !remediationSuccessful) return null;
  return { inFavorOfHost, csInTheWrong, remediationSuccessful };
}
