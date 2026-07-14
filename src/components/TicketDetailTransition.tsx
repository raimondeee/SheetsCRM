"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowRight } from "lucide-react";

const TRANSITION_OUT_MS = 140;
const TRANSITION_IN_MS = 220;
const TRANSITION_IN_EMPHASIZED_MS = 360;
const LOADED_CUE_VISIBLE_MS = 1700;
const LOADED_CUE_OUT_MS = 220;

export interface TicketLoadedCue {
  rowId: string;
  rowNumber: number;
  requesterName: string;
  requesterEmail: string;
}

interface TicketDetailTransitionProps {
  ticketKey: string | null;
  loadedCue?: TicketLoadedCue | null;
  onLoadedCueComplete?: () => void;
  children: ReactNode;
}

export function TicketDetailTransition({
  ticketKey,
  loadedCue = null,
  onLoadedCueComplete,
  children,
}: TicketDetailTransitionProps) {
  const [visible, setVisible] = useState(true);
  const [emphasized, setEmphasized] = useState(false);
  const [panel, setPanel] = useState(children);
  const [cueVisible, setCueVisible] = useState(false);
  const prevKeyRef = useRef(ticketKey);
  const skipNextTransitionRef = useRef(true);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cueTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onLoadedCueCompleteRef = useRef(onLoadedCueComplete);

  useEffect(() => {
    onLoadedCueCompleteRef.current = onLoadedCueComplete;
  }, [onLoadedCueComplete]);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      if (cueTimerRef.current) clearTimeout(cueTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!loadedCue || loadedCue.rowId !== ticketKey) {
      setCueVisible(false);
      return;
    }

    setCueVisible(true);
    if (cueTimerRef.current) clearTimeout(cueTimerRef.current);
    cueTimerRef.current = setTimeout(() => {
      setCueVisible(false);
      cueTimerRef.current = setTimeout(() => {
        onLoadedCueCompleteRef.current?.();
      }, LOADED_CUE_OUT_MS);
    }, LOADED_CUE_VISIBLE_MS);

    return () => {
      if (cueTimerRef.current) clearTimeout(cueTimerRef.current);
    };
  }, [loadedCue, ticketKey]);

  useEffect(() => {
    if (ticketKey === prevKeyRef.current) {
      setPanel(children);
      return;
    }

    const hasLoadedCue = Boolean(loadedCue && loadedCue.rowId === ticketKey);
    prevKeyRef.current = ticketKey;
    setEmphasized(hasLoadedCue);

    if (skipNextTransitionRef.current) {
      skipNextTransitionRef.current = false;
      setPanel(children);
      setVisible(true);
      return;
    }

    const reduceMotion =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (reduceMotion) {
      setPanel(children);
      setVisible(true);
      return;
    }

    if (timerRef.current) clearTimeout(timerRef.current);

    // Swap ticket content immediately so conversation/thread state never lingers on the prior ticket.
    setPanel(children);

    setVisible(false);
    timerRef.current = setTimeout(() => {
      setVisible(true);
    }, hasLoadedCue ? 80 : 16);
  }, [ticketKey, children, loadedCue]);

  const requesterLabel =
    loadedCue?.requesterName?.trim() ||
    loadedCue?.requesterEmail?.trim() ||
    "Unknown requester";

  return (
    <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
      {loadedCue && (
        <div
          className={`pointer-events-none absolute inset-x-0 top-0 z-20 flex justify-center px-3 pt-2 ${
            cueVisible ? "ticket-loaded-cue-visible" : "ticket-loaded-cue-hidden"
          }`}
          aria-live="polite"
          aria-atomic="true"
        >
          <div className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-zendesk-green/40 bg-white/95 px-3 py-1.5 shadow-md backdrop-blur-sm">
            <ArrowRight className="h-3.5 w-3.5 shrink-0 text-zendesk-green" aria-hidden />
            <span className="truncate text-xs font-semibold text-zendesk-navy">
              Next ticket
            </span>
            <span className="text-zendesk-muted" aria-hidden>
              ·
            </span>
            <span className="truncate text-xs text-zendesk-navy">
              Row {loadedCue.rowNumber}
            </span>
            <span className="text-zendesk-muted" aria-hidden>
              ·
            </span>
            <span className="truncate text-xs text-zendesk-muted">{requesterLabel}</span>
          </div>
        </div>
      )}
      <div
        className={`ticket-panel-transition flex min-h-0 min-w-0 flex-1 flex-col ${
          visible
            ? emphasized
              ? "ticket-panel-visible-emphasized"
              : "ticket-panel-visible"
            : emphasized
              ? "ticket-panel-hidden-emphasized"
              : "ticket-panel-hidden"
        }`}
        style={{
          transitionDuration: visible
            ? `${emphasized ? TRANSITION_IN_EMPHASIZED_MS : TRANSITION_IN_MS}ms`
            : `${TRANSITION_OUT_MS}ms`,
        }}
      >
        {panel}
      </div>
    </div>
  );
}
