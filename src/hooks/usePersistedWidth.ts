"use client";

import { useEffect, useMemo, useState } from "react";

export function useResponsivePanelMax(defaultPx: number, xlPx: number): number {
  const [max, setMax] = useState(defaultPx);

  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1280px)");
    const update = () => setMax(mq.matches ? xlPx : defaultPx);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, [defaultPx, xlPx]);

  return max;
}

export function usePersistedWidth(
  key: string,
  maxWidth: number,
  minRatio = 0.5
): {
  width: number;
  setWidth: (next: number) => void;
  minWidth: number;
  maxWidth: number;
  fontScale: number;
} {
  const minWidth = Math.round(maxWidth * minRatio);
  const [width, setWidthState] = useState(maxWidth);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    try {
      const stored = sessionStorage.getItem(key);
      if (stored) {
        const parsed = Number(stored);
        if (Number.isFinite(parsed)) {
          setWidthState(parsed);
        }
      }
    } catch {
      /* ignore */
    }
    setHydrated(true);
  }, [key]);

  useEffect(() => {
    if (!hydrated) return;
    setWidthState((current) => Math.min(maxWidth, Math.max(minWidth, current)));
  }, [maxWidth, minWidth, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    try {
      sessionStorage.setItem(key, String(width));
    } catch {
      /* ignore */
    }
  }, [key, width, hydrated]);

  const fontScale = useMemo(() => {
    if (maxWidth <= minWidth) return 1;
    const ratio = (width - minWidth) / (maxWidth - minWidth);
    return 0.75 + ratio * 0.25;
  }, [width, minWidth, maxWidth]);

  function setWidth(next: number) {
    setWidthState(Math.min(maxWidth, Math.max(minWidth, Math.round(next))));
  }

  return { width, setWidth, minWidth, maxWidth, fontScale };
}
