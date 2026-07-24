import { toCanvas } from "html-to-image";
import { jsPDF } from "jspdf";

export type PdfRenderProfile = "download" | "email";
export type DashboardImageCaptureMode = "current-layout" | "export-layout";

const PROFILE_SETTINGS: Record<
  PdfRenderProfile,
  { pixelRatio: number; jpegQuality: number }
> = {
  download: { pixelRatio: 2, jpegQuality: 0.88 },
  email: { pixelRatio: 1, jpegQuality: 0.76 },
};

const PAGE_WIDTH_MM = 210;
const MARGIN_MM = 8;
const MAX_SINGLE_PAGE_HEIGHT_MM = 2800;
const MAX_SLICE_CONTENT_MM = 281;
const CAPTURE_BACKGROUND = "#f9fafb";
const CAPTURE_BG_RGB = { r: 249, g: 250, b: 251 };
/** Match team/agent dashboard wide layout so capture uses the multi-column grid. */
const DASHBOARD_CAPTURE_MIN_WIDTH = 1280;

function sanitizePdfFilename(filename: string): string {
  const base = filename.replace(/\.pdf$/i, "").replace(/[^a-z0-9._-]+/gi, "-");
  return `${base}.pdf`;
}

function sanitizePngFilename(filename: string): string {
  const base = filename
    .replace(/\.(pdf|png|jpe?g)$/i, "")
    .replace(/[^a-z0-9._-]+/gi, "-");
  return `${base}.png`;
}

type StyleRestore = () => void;

function patchStyle(el: HTMLElement, styles: Record<string, string>): StyleRestore {
  const style = el.style as unknown as Record<string, string>;
  const previous: Record<string, string> = {};
  for (const [key, value] of Object.entries(styles)) {
    previous[key] = style[key] ?? "";
    style[key] = value;
  }
  return () => {
    for (const [key, value] of Object.entries(previous)) {
      style[key] = value;
    }
  };
}

function isExportExcluded(node: HTMLElement): boolean {
  return node.dataset.exportExclude === "true" || node.style.display === "none";
}

function measureVisibleContentHeight(element: HTMLElement): number {
  const rootTop = element.getBoundingClientRect().top;
  let maxBottom = 0;

  const visit = (node: HTMLElement) => {
    if (isExportExcluded(node)) return;
    const computed = window.getComputedStyle(node);
    if (computed.display === "none" || computed.visibility === "hidden") return;

    const rect = node.getBoundingClientRect();
    if (rect.width > 1 && rect.height > 1) {
      maxBottom = Math.max(maxBottom, rect.bottom - rootTop);
    }

    for (const child of node.children) {
      if (child instanceof HTMLElement) visit(child);
    }
  };

  visit(element);
  return Math.max(Math.ceil(maxBottom + 12), 1);
}

function measureSvgContentRight(element: HTMLElement, rootLeft: number): number {
  let maxRight = 0;

  element.querySelectorAll("svg").forEach((svg) => {
    if (svg.closest('[data-export-exclude="true"]')) return;
    const computed = window.getComputedStyle(svg);
    if (computed.display === "none" || computed.visibility === "hidden") return;

    try {
      const rect = svg.getBoundingClientRect();
      const bbox = svg.getBBox();
      if (bbox.width > 0 && rect.width > 0) {
        const scaleX = rect.width / bbox.width;
        maxRight = Math.max(maxRight, rect.left + (bbox.x + bbox.width) * scaleX - rootLeft);
        return;
      }
    } catch {
      // getBBox can fail before SVG layout completes
    }

    const rect = svg.getBoundingClientRect();
    if (rect.width > 1 && rect.height > 1) {
      maxRight = Math.max(maxRight, rect.right - rootLeft);
    }
  });

  return maxRight;
}

function resolveResponsiveGridColumns(className: string, captureWidth: number): number {
  if (captureWidth >= 1280) {
    const xlMatch = className.match(/\bxl:grid-cols-(\d+)\b/);
    if (xlMatch) return Number(xlMatch[1]);
  }
  if (captureWidth >= 1024) {
    const lgMatch = className.match(/\blg:grid-cols-(\d+)\b/);
    if (lgMatch) return Number(lgMatch[1]);
  }
  if (captureWidth >= 768) {
    const mdMatch = className.match(/\bmd:grid-cols-(\d+)\b/);
    if (mdMatch) return Number(mdMatch[1]);
  }
  const baseMatch = className.match(/(?:^|\s)grid-cols-(\d+)\b/);
  return baseMatch ? Number(baseMatch[1]) : 1;
}

function collectLayoutGrids(root: HTMLElement): HTMLElement[] {
  const grids: HTMLElement[] = [];
  if (/\bgrid\b/.test(root.className)) grids.push(root);
  root.querySelectorAll<HTMLElement>(".grid").forEach((grid) => {
    if (!grids.includes(grid)) grids.push(grid);
  });
  return grids;
}

function forceDashboardLayoutForCapture(root: HTMLElement): StyleRestore {
  const restores: StyleRestore[] = [];

  restores.push(
    patchStyle(root, {
      overflow: "visible",
      minWidth: `${DASHBOARD_CAPTURE_MIN_WIDTH}px`,
      boxSizing: "border-box",
    })
  );

  for (const grid of collectLayoutGrids(root)) {
    if (isExportExcluded(grid)) continue;
    const columns = resolveResponsiveGridColumns(grid.className, DASHBOARD_CAPTURE_MIN_WIDTH);
    if (columns <= 1) continue;

    restores.push(
      patchStyle(grid, {
        display: "grid",
        gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
        gap: "16px",
        width: "100%",
        overflow: "visible",
      })
    );
  }

  root.querySelectorAll<HTMLElement>("[class*='xl:col-span-'], [class*='lg:col-span-']").forEach(
    (node) => {
      if (isExportExcluded(node)) return;
      const spanMatch =
        node.className.match(/\bxl:col-span-(\d+)\b/) ??
        node.className.match(/\blg:col-span-(\d+)\b/);
      if (!spanMatch) return;
      restores.push(
        patchStyle(node, {
          gridColumn: `span ${spanMatch[1]} / span ${spanMatch[1]}`,
        })
      );
    }
  );

  root.querySelectorAll<HTMLElement>("section, .recharts-responsive-container, .recharts-wrapper").forEach(
    (node) => {
      if (isExportExcluded(node)) return;
      restores.push(patchStyle(node, { overflow: "visible" }));
    }
  );

  // Expand scrollable legends / panels so PDF/PNG capture is not clipped.
  root.querySelectorAll<HTMLElement>("*").forEach((node) => {
    if (isExportExcluded(node)) return;
    const computed = window.getComputedStyle(node);
    if (
      computed.overflowY !== "auto" &&
      computed.overflowY !== "scroll" &&
      computed.overflow !== "auto" &&
      computed.overflow !== "scroll"
    ) {
      return;
    }
    restores.push(
      patchStyle(node, {
        overflow: "visible",
        overflowX: "visible",
        overflowY: "visible",
        maxHeight: "none",
        height: "auto",
      })
    );
  });

  return () => restores.forEach((restore) => restore());
}

function measureVisibleContentWidth(element: HTMLElement): number {
  const rootLeft = element.getBoundingClientRect().left;
  let maxRight = 0;

  const visit = (node: HTMLElement) => {
    if (isExportExcluded(node)) return;
    const computed = window.getComputedStyle(node);
    if (computed.display === "none" || computed.visibility === "hidden") return;

    const rect = node.getBoundingClientRect();
    if (rect.width > 1 && rect.height > 1) {
      maxRight = Math.max(maxRight, rect.right - rootLeft);
    }

    for (const child of node.children) {
      if (child instanceof HTMLElement) visit(child);
    }
  };

  visit(element);
  maxRight = Math.max(maxRight, measureSvgContentRight(element, rootLeft));

  const measured = Math.ceil(maxRight + 16);
  const base = Math.max(measured, DASHBOARD_CAPTURE_MIN_WIDTH, 1);
  const scrollWidth = element.scrollWidth;
  if (scrollWidth <= base * 1.08) return Math.max(base, scrollWidth, 1);
  return base;
}

function clampChartContainers(root: HTMLElement): StyleRestore {
  const restores: StyleRestore[] = [];
  root.querySelectorAll<HTMLElement>(".recharts-responsive-container").forEach((node) => {
    const parent = node.parentElement;
    const height = Math.min(Math.max(parent?.clientHeight ?? 280, 220), 360);
    restores.push(
      patchStyle(node, {
        height: `${height}px`,
        maxHeight: `${height}px`,
        overflow: "visible",
      })
    );
    const wrapper = node.querySelector<HTMLElement>(".recharts-wrapper");
    if (wrapper) {
      restores.push(
        patchStyle(wrapper, {
          height: `${height}px`,
          maxHeight: `${height}px`,
          overflow: "visible",
        })
      );
    }
  });
  return () => restores.forEach((restore) => restore());
}

function prepareElementForCapture(element: HTMLElement): StyleRestore {
  const restores: StyleRestore[] = [];

  const excluded = [...element.querySelectorAll<HTMLElement>('[data-export-exclude="true"]')];
  for (const node of excluded) {
    restores.push(patchStyle(node, { display: "none" }));
  }

  restores.push(clampChartContainers(element));
  restores.push(forceDashboardLayoutForCapture(element));

  const contentWidth = measureVisibleContentWidth(element);
  restores.push(
    patchStyle(element, {
      overflow: "visible",
      width: `${contentWidth}px`,
      minWidth: `${contentWidth}px`,
      maxWidth: "none",
    })
  );

  const contentHeight = measureVisibleContentHeight(element);
  restores.push(
    patchStyle(element, {
      height: `${contentHeight}px`,
      maxHeight: `${contentHeight}px`,
    })
  );

  return () => restores.forEach((restore) => restore());
}

function prepareCurrentLayoutForCapture(element: HTMLElement): StyleRestore {
  const restores: StyleRestore[] = [];
  for (const node of element.querySelectorAll<HTMLElement>('[data-export-exclude="true"]')) {
    restores.push(patchStyle(node, { display: "none" }));
  }
  return () => restores.forEach((restore) => restore());
}

function readCaptureDimensions(element: HTMLElement): { width: number; height: number } {
  return {
    width: measureVisibleContentWidth(element),
    height: measureVisibleContentHeight(element),
  };
}

function trimCanvasBottom(canvas: HTMLCanvasElement): HTMLCanvasElement {
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;

  const { width, height } = canvas;
  const data = ctx.getImageData(0, 0, width, height).data;
  const tolerance = 10;

  const rowHasContent = (y: number) => {
    for (let x = 0; x < width; x += 6) {
      const i = (y * width + x) * 4;
      if (
        Math.abs(data[i]! - CAPTURE_BG_RGB.r) > tolerance ||
        Math.abs(data[i + 1]! - CAPTURE_BG_RGB.g) > tolerance ||
        Math.abs(data[i + 2]! - CAPTURE_BG_RGB.b) > tolerance
      ) {
        return true;
      }
    }
    return false;
  };

  let bottom = height - 1;
  while (bottom > 0 && !rowHasContent(bottom)) {
    bottom -= 1;
  }

  const trimmedHeight = Math.min(height, bottom + 17);
  if (trimmedHeight >= height - 8) return canvas;

  const trimmed = document.createElement("canvas");
  trimmed.width = width;
  trimmed.height = trimmedHeight;
  trimmed.getContext("2d")!.drawImage(canvas, 0, 0, width, trimmedHeight, 0, 0, width, trimmedHeight);
  return trimmed;
}

async function captureElementCanvas(
  element: HTMLElement,
  profile: PdfRenderProfile,
  mode: DashboardImageCaptureMode = "export-layout"
) {
  const { pixelRatio } = PROFILE_SETTINGS[profile];

  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });

  const restoreCapture =
    mode === "export-layout"
      ? prepareElementForCapture(element)
      : prepareCurrentLayoutForCapture(element);

  try {
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    });

    const rect = element.getBoundingClientRect();
    const { width, height } =
      mode === "current-layout"
        ? {
            width: Math.max(1, Math.ceil(rect.width)),
            height: Math.max(1, Math.ceil(rect.height)),
          }
        : readCaptureDimensions(element);

    const rawCanvas = await toCanvas(element, {
      cacheBust: true,
      pixelRatio,
      backgroundColor: CAPTURE_BACKGROUND,
      width,
      height,
      canvasWidth: width * pixelRatio,
      canvasHeight: height * pixelRatio,
    });

    return trimCanvasBottom(rawCanvas);
  } finally {
    restoreCapture?.();
  }
}

function canvasSliceToJpeg(
  canvas: HTMLCanvasElement,
  sourceY: number,
  sliceHeightPx: number,
  jpegQuality: number
): string {
  const pageCanvas = document.createElement("canvas");
  pageCanvas.width = canvas.width;
  pageCanvas.height = sliceHeightPx;

  const ctx = pageCanvas.getContext("2d");
  if (!ctx) throw new Error("Could not create PDF canvas context");

  ctx.drawImage(
    canvas,
    0,
    sourceY,
    canvas.width,
    sliceHeightPx,
    0,
    0,
    canvas.width,
    sliceHeightPx
  );

  return pageCanvas.toDataURL("image/jpeg", jpegQuality);
}

function buildPdfFromCanvas(canvas: HTMLCanvasElement, profile: PdfRenderProfile): jsPDF {
  const { jpegQuality } = PROFILE_SETTINGS[profile];
  const contentWidthMm = PAGE_WIDTH_MM - MARGIN_MM * 2;
  const mmPerPx = contentWidthMm / canvas.width;
  const totalContentHeightMm = canvas.height * mmPerPx;
  const totalPageHeightMm = totalContentHeightMm + MARGIN_MM * 2;

  if (totalPageHeightMm <= MAX_SINGLE_PAGE_HEIGHT_MM) {
    const imgData = canvas.toDataURL("image/jpeg", jpegQuality);
    const pdf = new jsPDF({
      unit: "mm",
      format: [PAGE_WIDTH_MM, totalPageHeightMm],
    });
    pdf.addImage(imgData, "JPEG", MARGIN_MM, MARGIN_MM, contentWidthMm, totalContentHeightMm);
    return pdf;
  }

  const maxSliceHeightPx = Math.max(1, Math.floor(MAX_SLICE_CONTENT_MM / mmPerPx));
  let sourceY = 0;
  let pageIndex = 0;
  let pdf: jsPDF | null = null;

  while (sourceY < canvas.height) {
    const sliceHeightPx = Math.min(maxSliceHeightPx, canvas.height - sourceY);
    const sliceHeightMm = sliceHeightPx * mmPerPx;
    const pageHeightMm = sliceHeightMm + MARGIN_MM * 2;
    const imgData = canvasSliceToJpeg(canvas, sourceY, sliceHeightPx, jpegQuality);

    if (pageIndex === 0) {
      pdf = new jsPDF({
        unit: "mm",
        format: [PAGE_WIDTH_MM, pageHeightMm],
      });
    } else {
      pdf!.addPage([PAGE_WIDTH_MM, pageHeightMm]);
    }

    pdf!.addImage(imgData, "JPEG", MARGIN_MM, MARGIN_MM, contentWidthMm, sliceHeightMm);
    sourceY += sliceHeightPx;
    pageIndex += 1;
  }

  if (!pdf) throw new Error("Could not build PDF");
  return pdf;
}

/** Wait until async dashboard sections finish loading inside the export root. */
export async function waitForDashboardExportReady(
  root: HTMLElement | null,
  timeoutMs = 20000
): Promise<void> {
  if (!root) return;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const loading = root.querySelector('[data-export-loading="true"]');
    if (!loading) {
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      });
      await new Promise((resolve) => setTimeout(resolve, 350));
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
}

export async function renderElementToPdfBytes(
  element: HTMLElement,
  profile: PdfRenderProfile = "download"
): Promise<Uint8Array> {
  const canvas = await captureElementCanvas(element, profile);
  const pdf = buildPdfFromCanvas(canvas, profile);
  return new Uint8Array(pdf.output("arraybuffer"));
}

export async function exportElementToPdf(
  element: HTMLElement,
  filename: string,
  profile: PdfRenderProfile = "download"
): Promise<void> {
  const canvas = await captureElementCanvas(element, profile);
  const pdf = buildPdfFromCanvas(canvas, profile);
  pdf.save(sanitizePdfFilename(filename));
}

export async function exportElementToPng(
  element: HTMLElement,
  filename: string,
  profile: PdfRenderProfile = "download"
): Promise<void> {
  const canvas = await captureElementCanvas(element, profile);
  const href = canvas.toDataURL("image/png");
  const link = document.createElement("a");
  link.href = href;
  link.download = sanitizePngFilename(filename);
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
}

export async function renderElementToPngBlob(
  element: HTMLElement,
  mode: DashboardImageCaptureMode = "current-layout"
): Promise<Blob> {
  const canvas = await captureElementCanvas(element, "download", mode);
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error("Could not encode dashboard image"));
      },
      "image/png"
    );
  });
}

export function resolvePdfFilename(csvFilename: string, pdfFilename?: string): string {
  return sanitizePdfFilename(
    pdfFilename ?? csvFilename.replace(/\.csv$/i, ".pdf").replace(/[^a-z0-9._-]+/gi, "-")
  );
}

export function resolvePngFilename(csvFilename: string, pdfFilename?: string): string {
  return sanitizePngFilename(
    pdfFilename ?? csvFilename.replace(/\.csv$/i, ".png").replace(/[^a-z0-9._-]+/gi, "-")
  );
}

export async function pdfBytesToBase64(bytes: Uint8Array): Promise<string> {
  const blob = new Blob([new Uint8Array(bytes)], { type: "application/pdf" });
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== "string") {
        reject(new Error("Failed to encode PDF"));
        return;
      }
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(reader.error ?? new Error("Failed to encode PDF"));
    reader.readAsDataURL(blob);
  });
}
