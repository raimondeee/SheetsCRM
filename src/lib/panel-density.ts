/** Text size tiers for resizable side panels (scale 1 = full width, 0.75 = half width). */
export function panelTextSizes(fontScale: number): {
  body: string;
  small: string;
  tiny: string;
  micro: string;
} {
  if (fontScale >= 0.92) {
    return {
      body: "text-sm",
      small: "text-xs",
      tiny: "text-[10px]",
      micro: "text-[9px]",
    };
  }
  if (fontScale >= 0.82) {
    return {
      body: "text-xs",
      small: "text-[10px]",
      tiny: "text-[9px]",
      micro: "text-[8px]",
    };
  }
  return {
    body: "text-[10px]",
    small: "text-[9px]",
    tiny: "text-[8px]",
    micro: "text-[8px]",
  };
}
