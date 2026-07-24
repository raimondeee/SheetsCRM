"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Eye, Lightbulb, X } from "lucide-react";
import {
  wellnessKindLabel,
  type WellnessContentItem,
} from "@/lib/wellness-content";

interface WellnessContentModalProps {
  item: WellnessContentItem;
  milestoneCount: number;
  onDismiss: () => void;
}

export function WellnessContentModal({
  item,
  milestoneCount,
  onDismiss,
}: WellnessContentModalProps) {
  const [mounted, setMounted] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const hasHiddenAnswer = Boolean(item.answer);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    setRevealed(false);
  }, [item]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onDismiss();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onDismiss]);

  if (!mounted) return null;

  return createPortal(
    <div
      role="alertdialog"
      aria-labelledby="wellness-content-title"
      aria-describedby="wellness-content-body"
      className="fixed inset-0 z-[72] flex flex-col items-center justify-center bg-gradient-to-br from-cyan-600/95 via-sky-600/95 to-blue-800/95 p-6 text-white"
    >
      <button
        type="button"
        onClick={onDismiss}
        className="absolute right-4 top-4 rounded-full p-2 text-white/90 hover:bg-white/15 hover:text-white"
        aria-label="Close wellness break"
      >
        <X className="h-6 w-6" />
      </button>

      <div className="flex w-full max-w-lg flex-col items-center text-center">
        <div className="mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-white/20 shadow-lg">
          <Lightbulb className="h-10 w-10" />
        </div>

        <p className="text-sm font-semibold uppercase tracking-[0.2em] text-cyan-50/90">
          Quick break · {milestoneCount} cases sent
        </p>
        <p className="mt-2 text-xs font-medium text-sky-100/90">
          {wellnessKindLabel(item.kind)} · {item.sourceTitle}
        </p>

        {item.eyebrow ? (
          <p className="mt-4 text-sm font-semibold text-cyan-50/95">{item.eyebrow}</p>
        ) : null}

        <h2
          id="wellness-content-title"
          className="mt-3 text-2xl font-bold leading-snug sm:text-3xl"
        >
          {item.kind === "quote" ? `"${item.body}"` : item.body}
        </h2>

        {item.meta ? (
          <p className="mt-3 text-base text-sky-50/95">— {item.meta}</p>
        ) : null}

        <div id="wellness-content-body" className="mt-6 w-full">
          {hasHiddenAnswer ? (
            revealed ? (
              <div className="rounded-lg border border-white/25 bg-white/10 px-4 py-3 text-left">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-cyan-50/80">
                  Answer
                </p>
                <p className="mt-1 text-base font-medium text-white">{item.answer}</p>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setRevealed(true)}
                className="inline-flex items-center justify-center gap-2 rounded-lg border-2 border-white/40 bg-white/10 px-5 py-2.5 text-sm font-semibold text-white hover:bg-white/20"
              >
                <Eye className="h-4 w-4" />
                Reveal
              </button>
            )
          ) : null}
        </div>

        <div className="mt-10 flex w-full flex-col gap-3 sm:flex-row sm:justify-center">
          <button
            type="button"
            onClick={onDismiss}
            className="inline-flex items-center justify-center rounded-lg bg-white px-6 py-3 text-base font-semibold text-sky-800 shadow-lg hover:bg-cyan-50"
          >
            Close
          </button>
          <button
            type="button"
            onClick={onDismiss}
            className="inline-flex items-center justify-center rounded-lg border-2 border-white/40 bg-white/10 px-6 py-3 text-base font-semibold text-white hover:bg-white/20"
          >
            Ignore
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
