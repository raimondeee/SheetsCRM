/** Text size tiers for resizable side panels (scale 1 = full width, 0.75 = narrowest). */
export function panelTextSizes(fontScale: number): {
  body: string;
  small: string;
  tiny: string;
  micro: string;
  compact: boolean;
  icon: string;
  inputPy: string;
} {
  if (fontScale >= 0.92) {
    return {
      body: "text-sm",
      small: "text-xs",
      tiny: "text-[10px]",
      micro: "text-[9px]",
      compact: false,
      icon: "h-4 w-4",
      inputPy: "py-2",
    };
  }
  if (fontScale >= 0.82) {
    return {
      body: "text-xs",
      small: "text-[10px]",
      tiny: "text-[9px]",
      micro: "text-[9px]",
      compact: true,
      icon: "h-3.5 w-3.5",
      inputPy: "py-1.5",
    };
  }
  return {
    body: "text-[10px]",
    small: "text-[9px]",
    tiny: "text-[8px]",
    micro: "text-[9px]",
    compact: true,
    icon: "h-3 w-3",
    inputPy: "py-1.5",
  };
}

export function panelSortByLabel(sortBy: "submitted" | "updated", compact: boolean): string {
  if (compact) {
    return sortBy === "submitted" ? "Submitted" : "Updated";
  }
  return sortBy === "submitted" ? "Form submission date" : "Recently updated";
}

export function panelSortOrderLabel(
  sortBy: "submitted" | "updated",
  newestFirst: boolean,
  compact: boolean
): string {
  if (sortBy === "updated") {
    if (newestFirst) return compact ? "Recent" : "Recent";
    return compact ? "Stale" : "Stale";
  }
  if (newestFirst) return compact ? "Newest" : "Newest";
  return compact ? "Oldest" : "Oldest";
}
