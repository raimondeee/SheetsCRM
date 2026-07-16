"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { HELP_TOUR_SPOTS, type HelpTourSpot } from "@/lib/help-tour";

type SpotRect = {
  id: string;
  top: number;
  left: number;
  width: number;
  height: number;
  found: boolean;
};

type HelpOverlayProps = {
  open: boolean;
  onClose: () => void;
};

const MARKER_SIZE = 28;
const CARD_WIDTH = 320;
const PAD = 12;

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

function isVisible(el: HTMLElement): boolean {
  const style = window.getComputedStyle(el);
  if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") {
    return false;
  }
  const rect = el.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function asList(value?: string | string[]): string[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function elementLabel(el: HTMLElement): string {
  const own = normalizeText(
    Array.from(el.childNodes)
      .filter((n) => n.nodeType === Node.TEXT_NODE)
      .map((n) => n.textContent ?? "")
      .join(" ")
  );
  if (own) return own;
  if (el.childElementCount === 0) return normalizeText(el.textContent ?? "");
  if (el.childElementCount <= 2) return normalizeText(el.textContent ?? "");
  return "";
}

function findByAriaLabels(ariaLabels: string[]): HTMLElement | null {
  for (const ariaLabel of ariaLabels) {
    const byAria = document.querySelectorAll<HTMLElement>(`[aria-label="${ariaLabel}"]`);
    for (const el of byAria) {
      if (isVisible(el)) return el;
    }
  }
  return null;
}

function findByTexts(texts: string[], tagNames?: string[]): HTMLElement | null {
  if (texts.length === 0) return null;
  const needles = texts.map(normalizeText);
  const tagFilter = tagNames?.map((t) => t.toLowerCase());
  const candidates = document.querySelectorAll<HTMLElement>(
    "button, a, h1, h2, h3, h4, span, div, label, p"
  );

  let best: HTMLElement | null = null;
  let bestScore = Number.POSITIVE_INFINITY;

  for (const el of candidates) {
    if (tagFilter && !tagFilter.includes(el.tagName.toLowerCase())) continue;
    if (!isVisible(el)) continue;

    const label = elementLabel(el);
    if (!label) continue;

    const needleIndex = needles.findIndex(
      (needle) => label === needle || (label.startsWith(needle) && label.length <= needle.length + 12)
    );
    if (needleIndex < 0) continue;

    const needle = needles[needleIndex];
    const exact = label === needle;
    const score =
      needleIndex * 100 + (exact ? 0 : 10) + label.length + el.getBoundingClientRect().width / 100;
    if (score < bestScore) {
      best = el;
      bestScore = score;
    }
  }

  return best;
}

function findByDataHelpTour(id: string): HTMLElement | null {
  const el = document.querySelector<HTMLElement>(`[data-help-tour="${id}"]`);
  if (el && isVisible(el)) return el;
  return null;
}

function findSpotElement(spot: HelpTourSpot): HTMLElement | null {
  if (spot.match.dataHelpTour) {
    const byData = findByDataHelpTour(spot.match.dataHelpTour);
    if (byData) return byData;
  }
  const ariaHit = findByAriaLabels(asList(spot.match.ariaLabel));
  if (ariaHit) return ariaHit;
  return findByTexts(asList(spot.match.text), spot.match.tagNames);
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function cardPosition(
  rect: SpotRect,
  viewportW: number,
  viewportH: number
): { top: number; left: number } {
  const markerX = rect.left + rect.width / 2;
  const markerY = rect.top + rect.height / 2;
  let left = markerX + MARKER_SIZE;
  let top = markerY - 40;

  if (left + CARD_WIDTH + PAD > viewportW) {
    left = markerX - CARD_WIDTH - MARKER_SIZE;
  }
  if (left < PAD) left = PAD;
  if (top + 220 > viewportH) top = viewportH - 220 - PAD;
  if (top < PAD + 48) top = PAD + 48;

  return {
    top: clamp(top, PAD, viewportH - PAD),
    left: clamp(left, PAD, viewportW - CARD_WIDTH - PAD),
  };
}

function measureSpots(): SpotRect[] {
  return HELP_TOUR_SPOTS.map((spot) => {
    const el = findSpotElement(spot);
    if (!el) {
      return { id: spot.id, top: 0, left: 0, width: 0, height: 0, found: false };
    }
    const r = el.getBoundingClientRect();
    return {
      id: spot.id,
      top: r.top,
      left: r.left,
      width: r.width,
      height: r.height,
      found: true,
    };
  });
}

export function HelpOverlay({ open, onClose }: HelpOverlayProps) {
  const [mounted, setMounted] = useState(false);
  const [rects, setRects] = useState<SpotRect[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [frozenRects, setFrozenRects] = useState<Record<string, SpotRect>>({});
  const [viewport, setViewport] = useState({ w: 0, h: 0 });

  useEffect(() => {
    setMounted(true);
  }, []);

  const refresh = useCallback(() => {
    setViewport({ w: window.innerWidth, h: window.innerHeight });
    setRects(measureSpots());
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    refresh();
    const onResize = () => refresh();
    window.addEventListener("resize", onResize);
    window.addEventListener("scroll", onResize, true);
    const interval = window.setInterval(refresh, 800);
    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("scroll", onResize, true);
      window.clearInterval(interval);
    };
  }, [open, refresh]);

  useEffect(() => {
    if (!open) {
      setActiveId(null);
      setFrozenRects({});
      return;
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const displayRects = useMemo(
    () =>
      rects.map((rect) => {
        const frozen = frozenRects[rect.id];
        return frozen?.found ? frozen : rect;
      }),
    [rects, frozenRects]
  );

  const activeSpot = useMemo(
    () => HELP_TOUR_SPOTS.find((s) => s.id === activeId) ?? null,
    [activeId]
  );
  const activeRect = useMemo(
    () => displayRects.find((r) => r.id === activeId) ?? null,
    [displayRects, activeId]
  );

  function activateSpot(spotId: string) {
    setActiveId((current) => {
      if (current === spotId) {
        setFrozenRects({});
        return null;
      }
      const live = rects.find((r) => r.id === spotId);
      setFrozenRects(live?.found ? { [spotId]: live } : {});
      return spotId;
    });
  }

  if (!mounted || !open) return null;

  const cardPos =
    activeSpot && activeRect?.found
      ? cardPosition(activeRect, viewport.w || window.innerWidth, viewport.h || window.innerHeight)
      : null;

  return createPortal(
    <div className="fixed inset-0 z-[80]" role="dialog" aria-modal="true" aria-label="CRM help overlay">
      <button
        type="button"
        aria-label="Close help overlay"
        className="absolute inset-0 cursor-default bg-zendesk-navy/50"
        onClick={onClose}
      />

      <div
        className="absolute left-1/2 top-4 z-[5] flex -translate-x-1/2 items-center gap-2 rounded-full border border-white/20 bg-zendesk-navy/95 px-3 py-1.5 text-white shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <span className="text-xs font-medium">CRM help</span>
        <span className="hidden text-[10px] text-white/70 sm:inline">Click a number · Esc</span>
        <button
          type="button"
          onClick={onClose}
          className="rounded-full p-1 hover:bg-white/10"
          aria-label="Close help"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {HELP_TOUR_SPOTS.map((spot, index) => {
        const rect = displayRects.find((r) => r.id === spot.id);
        if (!rect?.found) return null;
        const cx = rect.left + rect.width / 2 - MARKER_SIZE / 2;
        const cy = Math.max(8, rect.top - MARKER_SIZE / 2);
        const isActive = activeId === spot.id;
        return (
          <div key={spot.id} className="contents">
            <div
              className={`pointer-events-none absolute z-[2] rounded-md border-2 ${
                isActive
                  ? "border-zendesk-green bg-zendesk-green/15"
                  : "border-zendesk-green/70 bg-white/10"
              }`}
              style={{
                top: rect.top - 3,
                left: rect.left - 3,
                width: rect.width + 6,
                height: rect.height + 6,
              }}
            />
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                activateSpot(spot.id);
              }}
              className={`absolute z-[3] flex h-7 w-7 items-center justify-center rounded-full border-2 text-xs font-bold shadow-lg ${
                isActive
                  ? "border-white bg-zendesk-green text-zendesk-navy"
                  : "border-white bg-zendesk-navy text-white hover:bg-zendesk-green hover:text-zendesk-navy"
              }`}
              style={{ top: cy, left: cx }}
              title={spot.title}
              aria-expanded={isActive}
              aria-controls={`help-spot-${spot.id}`}
            >
              {index + 1}
            </button>
          </div>
        );
      })}

      {activeSpot && activeRect?.found && cardPos ? (
        <div
          id={`help-spot-${activeSpot.id}`}
          className="absolute z-[4] w-80 rounded-lg border border-zendesk-border bg-white p-4 shadow-2xl"
          style={{ top: cardPos.top, left: cardPos.left }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="mb-2 flex items-start justify-between gap-2">
            <h3 className="text-sm font-semibold text-zendesk-navy">{activeSpot.title}</h3>
            <button
              type="button"
              onClick={() => activateSpot(activeSpot.id)}
              className="rounded p-1 text-zendesk-muted hover:bg-gray-100 hover:text-zendesk-navy"
              aria-label="Collapse help tip"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <p className="text-xs leading-relaxed text-gray-700">{activeSpot.body}</p>
        </div>
      ) : null}
    </div>,
    document.body
  );
}
