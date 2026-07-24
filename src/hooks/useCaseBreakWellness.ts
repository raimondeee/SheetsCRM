"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  loadWellnessContentPool,
  pickRandomWellnessItem,
  wellnessItemKey,
  type WellnessContentItem,
  type WellnessContentSourceId,
} from "@/lib/wellness-content";
import type { CaseBreakThreshold } from "@/lib/wellness-preferences";

const STORAGE_KEY = "sheetscrm_case_break_count_v1";

function readStoredCount(): number {
  if (typeof window === "undefined") return 0;
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    const n = raw ? Number.parseInt(raw, 10) : 0;
    return Number.isFinite(n) && n > 0 ? n : 0;
  } catch {
    return 0;
  }
}

function writeStoredCount(count: number): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(STORAGE_KEY, String(Math.max(0, count)));
  } catch {
    /* ignore */
  }
}

export function useCaseBreakWellness(options: {
  enabled: boolean;
  threshold: CaseBreakThreshold;
  contentIds: WellnessContentSourceId[];
}) {
  const { enabled, threshold, contentIds } = options;
  const [overlay, setOverlay] = useState<{
    item: WellnessContentItem;
    milestoneCount: number;
  } | null>(null);
  const countRef = useRef(0);
  const lastKeyRef = useRef<string | null>(null);
  const poolRef = useRef<WellnessContentItem[]>([]);
  const contentKey = contentIds.slice().sort().join(",");

  useEffect(() => {
    countRef.current = readStoredCount();
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (!enabled || contentIds.length === 0) {
      poolRef.current = [];
      return;
    }
    void (async () => {
      const pool = await loadWellnessContentPool(contentIds);
      if (!cancelled) poolRef.current = pool;
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled, contentKey, contentIds]);

  const dismiss = useCallback(() => {
    setOverlay(null);
  }, []);

  const recordSuccessfulSend = useCallback(() => {
    if (!enabled || contentIds.length === 0) return;

    const next = countRef.current + 1;
    countRef.current = next;
    writeStoredCount(next);

    if (next % threshold !== 0) return;

    const item = pickRandomWellnessItem(poolRef.current, lastKeyRef.current);
    if (!item) return;
    lastKeyRef.current = wellnessItemKey(item);
    setOverlay({ item, milestoneCount: next });
  }, [enabled, contentIds.length, threshold]);

  return {
    overlay,
    dismiss,
    recordSuccessfulSend,
    sendCount: countRef.current,
  };
}
