"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

const TRANSITION_OUT_MS = 140;
const TRANSITION_IN_MS = 220;

interface TicketDetailTransitionProps {
  ticketKey: string | null;
  children: ReactNode;
}

export function TicketDetailTransition({
  ticketKey,
  children,
}: TicketDetailTransitionProps) {
  const [visible, setVisible] = useState(true);
  const [panel, setPanel] = useState(children);
  const prevKeyRef = useRef(ticketKey);
  const skipNextTransitionRef = useRef(true);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  useEffect(() => {
    if (ticketKey === prevKeyRef.current) {
      setPanel(children);
      return;
    }

    prevKeyRef.current = ticketKey;

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
    }, 16);
  }, [ticketKey, children]);

  return (
    <div
      className={`ticket-panel-transition flex min-h-0 min-w-0 flex-1 flex-col ${
        visible ? "ticket-panel-visible" : "ticket-panel-hidden"
      }`}
      style={{
        transitionDuration: visible
          ? `${TRANSITION_IN_MS}ms`
          : `${TRANSITION_OUT_MS}ms`,
      }}
    >
      {panel}
    </div>
  );
}
