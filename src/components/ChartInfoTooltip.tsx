"use client";

import { Info } from "lucide-react";
import { useId, useState } from "react";

interface ChartInfoTooltipProps {
  title?: string;
  children: string;
}

export function ChartInfoTooltip({ title, children }: ChartInfoTooltipProps) {
  const [open, setOpen] = useState(false);
  const tooltipId = useId();

  return (
    <span className="relative inline-flex">
      <button
        type="button"
        aria-label={title ? `About ${title}` : "About this chart"}
        aria-describedby={open ? tooltipId : undefined}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onClick={() => setOpen((v) => !v)}
        className="rounded p-0.5 text-zendesk-muted hover:bg-gray-100 hover:text-zendesk-navy"
      >
        <Info className="h-3.5 w-3.5" />
      </button>
      {open ? (
        <div
          id={tooltipId}
          role="tooltip"
          className="absolute right-0 top-full z-20 mt-1 w-64 rounded-md border border-zendesk-border bg-white p-3 text-left text-xs leading-relaxed text-gray-700 shadow-lg"
        >
          {title ? <p className="mb-1 font-semibold text-zendesk-navy">{title}</p> : null}
          <p>{children}</p>
        </div>
      ) : null}
    </span>
  );
}
