"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import JSZip from "jszip";
import {
  ChevronDown,
  Copy,
  Download,
  FileArchive,
  Mail,
  Printer,
  X,
} from "lucide-react";
import type { DashboardPeriod } from "@/lib/dashboard-period";
import { downloadCsvFile } from "@/lib/dashboard-report-export";
import {
  renderElementToPngBlob,
} from "@/lib/dashboard-section-pdf";
import { MAX_OUTBOUND_ATTACHMENT_BYTES } from "@/lib/gmail-attachments";
import type { MarketManager } from "@/lib/market-managers";
import { EmailRecipientInput } from "./EmailRecipientInput";

export interface DashboardSendReportParams {
  dashboard: "main" | "team";
  period: DashboardPeriod;
  marketManager?: string;
  region?: string;
  owner?: string;
}

export interface DashboardImageSection {
  filename: string;
  label: string;
  getElement: () => HTMLElement | null;
}

interface DashboardExportMenuProps {
  label?: string;
  csvFilename: string;
  buildCsv: () => string;
  buildPlainReport: () => string;
  buildHtmlReport: () => string;
  printTargetRef?: RefObject<HTMLElement | null>;
  imageSections?: DashboardImageSection[];
  sendReportParams?: DashboardSendReportParams;
  userEmail?: string | null;
  canSendEmail?: boolean;
}

export function DashboardReportMenu({
  label = "Export",
  csvFilename,
  buildCsv,
  buildPlainReport,
  buildHtmlReport,
  printTargetRef,
  imageSections,
  sendReportParams,
  userEmail,
  canSendEmail = false,
}: DashboardExportMenuProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [sendOpen, setSendOpen] = useState(false);
  const [recipient, setRecipient] = useState(userEmail ?? "");
  const [attachCsv, setAttachCsv] = useState(true);
  const [attachImages, setAttachImages] = useState(false);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "error">("idle");
  const [imagesState, setImagesState] = useState<"idle" | "exporting" | "error">("idle");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [sendSuccess, setSendSuccess] = useState(false);
  const [marketManagers, setMarketManagers] = useState<MarketManager[]>([]);
  const menuRef = useRef<HTMLDivElement>(null);

  const showEmail = Boolean(sendReportParams);
  const canAttachImages = Boolean(imageSections?.length);

  useEffect(() => {
    if (!menuOpen) return;
    function handlePointerDown(event: MouseEvent) {
      if (menuRef.current?.contains(event.target as Node)) return;
      setMenuOpen(false);
    }
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [menuOpen]);

  useEffect(() => {
    if (sendOpen) {
      setRecipient(userEmail ?? "");
      setAttachImages(false);
    }
  }, [sendOpen, userEmail]);

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/market-managers", { cache: "no-store", credentials: "same-origin" })
      .then(async (res) => {
        const data = (await res.json()) as { managers?: MarketManager[]; error?: string };
        if (!cancelled && !data.error) {
          setMarketManagers(data.managers ?? []);
        }
      })
      .catch(() => {
        if (!cancelled) setMarketManagers([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function copyReport() {
    const text = buildPlainReport();
    const html = buildHtmlReport();
    try {
      if (typeof ClipboardItem !== "undefined") {
        await navigator.clipboard.write([
          new ClipboardItem({
            "text/html": new Blob([html], { type: "text/html" }),
            "text/plain": new Blob([text], { type: "text/plain" }),
          }),
        ]);
      } else {
        await navigator.clipboard.writeText(text);
      }
      setCopyState("copied");
      window.setTimeout(() => setCopyState("idle"), 2000);
    } catch {
      setCopyState("error");
      window.setTimeout(() => setCopyState("idle"), 2500);
    }
    setMenuOpen(false);
  }

  function exportCsv() {
    downloadCsvFile(csvFilename, buildCsv());
    setMenuOpen(false);
  }

  function imageZipFilename(): string {
    const now = new Date();
    const date = [now.getFullYear(), String(now.getMonth() + 1).padStart(2, "0"), String(now.getDate()).padStart(2, "0")].join("-");
    const prefix =
      sendReportParams?.dashboard === "team"
        ? "team-dashboard"
        : csvFilename.replace(/\.csv$/i, "").replace(/[^a-z0-9._-]+/gi, "-");
    return `${prefix}-${date}.zip`;
  }

  async function buildDashboardImageZip(): Promise<Blob> {
    if (!imageSections?.length) {
      throw new Error("Dashboard image export is not available");
    }

    const zip = new JSZip();
    for (const section of imageSections) {
      const element = section.getElement();
      if (!element) {
        throw new Error(`Could not locate ${section.label} for image export`);
      }
      const image = await renderElementToPngBlob(element, "current-layout");
      zip.file(section.filename, image);
    }
    return zip.generateAsync({ type: "blob", compression: "DEFLATE" });
  }

  async function exportDashboardImages() {
    if (!imageSections?.length) return;

    setImagesState("exporting");
    setMenuOpen(false);
    try {
      const blob = await buildDashboardImageZip();
      if (!blob) throw new Error("Could not build dashboard image ZIP");
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = imageZipFilename();
      link.rel = "noopener";
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
      setImagesState("idle");
    } catch {
      setImagesState("error");
      window.setTimeout(() => setImagesState("idle"), 2500);
    }
  }

  function printDashboard() {
    const target = printTargetRef?.current;
    if (!target) return;

    setMenuOpen(false);
    target.dataset.printDashboardRoot = "true";
    document.body.classList.add("crm-print-dashboard");

    const cleanup = () => {
      document.body.classList.remove("crm-print-dashboard");
      delete target.dataset.printDashboardRoot;
      window.removeEventListener("afterprint", cleanup);
    };
    window.addEventListener("afterprint", cleanup, { once: true });

    requestAnimationFrame(() => {
      requestAnimationFrame(() => window.print());
    });
  }

  function openSendModal() {
    if (!sendReportParams) return;
    setSendError(null);
    setSendSuccess(false);
    setSendOpen(true);
    setMenuOpen(false);
  }

  async function sendReport() {
    if (!sendReportParams) return;
    const to = recipient.trim();
    if (!to) {
      setSendError("Enter at least one recipient email address");
      return;
    }
    if (!attachCsv && !attachImages) {
      setSendError("Select at least one attachment (CSV or dashboard images)");
      return;
    }

    setSending(true);
    setSendError(null);
    setSendSuccess(false);

    try {
      let imagesBlob: Blob | null = null;
      let imagesFilename: string | null = null;

      if (attachImages) {
        imagesBlob = await buildDashboardImageZip();
        if (imagesBlob.size > MAX_OUTBOUND_ATTACHMENT_BYTES) {
          const mb = (imagesBlob.size / (1024 * 1024)).toFixed(1);
          const limitMb = (MAX_OUTBOUND_ATTACHMENT_BYTES / (1024 * 1024)).toFixed(0);
          throw new Error(
            `Dashboard image ZIP is too large (${mb} MB; limit ${limitMb} MB). Try CSV only or narrow your filters.`
          );
        }
        imagesFilename = imageZipFilename();
      }

      let res: Response;
      if (imagesBlob && imagesFilename) {
        const formData = new FormData();
        formData.append("dashboard", sendReportParams.dashboard);
        formData.append("period", sendReportParams.period);
        formData.append("to", to);
        formData.append("attachCsv", attachCsv ? "true" : "false");
        formData.append("attachImages", "true");
        if (sendReportParams.marketManager) {
          formData.append("marketManager", sendReportParams.marketManager);
        }
        if (sendReportParams.region) {
          formData.append("region", sendReportParams.region);
        }
        if (sendReportParams.owner) {
          formData.append("owner", sendReportParams.owner);
        }
        formData.append("images", imagesBlob, imagesFilename);

        res = await fetch("/api/dashboard/send-report", {
          method: "POST",
          credentials: "same-origin",
          body: formData,
        });
      } else {
        res = await fetch("/api/dashboard/send-report", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({
            ...sendReportParams,
            to,
            attachCsv,
            attachImages: false,
          }),
        });
      }
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to send report");
      setSendSuccess(true);
      window.setTimeout(() => setSendOpen(false), 1500);
    } catch (error) {
      setSendError(error instanceof Error ? error.message : "Failed to send report");
    } finally {
      setSending(false);
    }
  }

  const copyLabel =
    copyState === "copied" ? "Copied" : copyState === "error" ? "Copy failed" : "Copy summary";
  const exportingVisual = imagesState === "exporting";
  const imagesLabel =
    imagesState === "exporting"
      ? "Building image ZIP…"
      : imagesState === "error"
        ? "Image ZIP failed"
        : "Export dashboard images";

  return (
    <>
      <div ref={menuRef} className="relative" data-export-exclude="true">
        <button
          type="button"
          onClick={() => setMenuOpen((open) => !open)}
          aria-expanded={menuOpen}
          disabled={exportingVisual}
          className="inline-flex items-center gap-1 rounded border border-zendesk-border bg-white px-2.5 py-1.5 text-xs font-medium text-zendesk-navy hover:bg-gray-50 disabled:opacity-60"
        >
          {label}
          <ChevronDown className="h-3.5 w-3.5" />
        </button>
        {menuOpen ? (
          <div className="absolute right-0 top-full z-30 mt-1 min-w-[11rem] rounded border border-zendesk-border bg-white py-1 shadow-lg">
            {imageSections?.length ? (
              <>
                <button
                  type="button"
                  onClick={() => void exportDashboardImages()}
                  disabled={exportingVisual}
                  title="Downloads current-layout dashboard sections as PNG files in one ZIP."
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-zendesk-navy hover:bg-gray-50 disabled:opacity-50"
                >
                  <FileArchive className="h-3.5 w-3.5 shrink-0" />
                  {imagesLabel}
                </button>
              </>
            ) : null}
            {printTargetRef ? (
              <button
                type="button"
                onClick={printDashboard}
                disabled={exportingVisual}
                title="Uses Chrome's native print renderer. Choose Save to PDF in the print dialog."
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-zendesk-navy hover:bg-gray-50 disabled:opacity-50"
              >
                <Printer className="h-3.5 w-3.5 shrink-0" />
                Print / Save PDF…
              </button>
            ) : null}
            <button
              type="button"
              onClick={exportCsv}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-zendesk-navy hover:bg-gray-50"
            >
              <Download className="h-3.5 w-3.5 shrink-0" />
              Export CSV
            </button>
            <button
              type="button"
              onClick={() => void copyReport()}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-zendesk-navy hover:bg-gray-50"
            >
              <Copy className="h-3.5 w-3.5 shrink-0" />
              {copyLabel}
            </button>
            {showEmail ? (
              <button
                type="button"
                onClick={openSendModal}
                disabled={!canSendEmail}
                title={
                  canSendEmail
                    ? "Email report with current filters"
                    : "Sign in with Google to email reports"
                }
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-zendesk-navy hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Mail className="h-3.5 w-3.5 shrink-0" />
                Email report…
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      {sendOpen && sendReportParams ? (
        <SendReportModal
          recipient={recipient}
          attachCsv={attachCsv}
          attachImages={attachImages}
          canAttachImages={canAttachImages}
          marketManagers={marketManagers}
          sending={sending}
          sendError={sendError}
          sendSuccess={sendSuccess}
          onRecipientChange={setRecipient}
          onAttachCsvChange={setAttachCsv}
          onAttachImagesChange={setAttachImages}
          onSend={() => void sendReport()}
          onClose={() => {
            if (!sending) setSendOpen(false);
          }}
        />
      ) : null}
    </>
  );
}

function SendReportModal({
  recipient,
  attachCsv,
  attachImages,
  canAttachImages,
  marketManagers,
  sending,
  sendError,
  sendSuccess,
  onRecipientChange,
  onAttachCsvChange,
  onAttachImagesChange,
  onSend,
  onClose,
}: {
  recipient: string;
  attachCsv: boolean;
  attachImages: boolean;
  canAttachImages: boolean;
  marketManagers: MarketManager[];
  sending: boolean;
  sendError: string | null;
  sendSuccess: boolean;
  onRecipientChange: (value: string) => void;
  onAttachCsvChange: (value: boolean) => void;
  onAttachImagesChange: (value: boolean) => void;
  onSend: () => void;
  onClose: () => void;
}) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !sending) onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [sending, onClose]);

  if (!mounted) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/45 p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !sending) onClose();
      }}
    >
      <div
        role="dialog"
        aria-labelledby="send-report-title"
        className="w-full max-w-md rounded-lg border border-zendesk-border bg-white shadow-xl"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-zendesk-border px-4 py-3">
          <div className="flex min-w-0 items-start gap-2">
            <Mail className="mt-0.5 h-5 w-5 shrink-0 text-zendesk-green" />
            <div>
              <h2 id="send-report-title" className="text-sm font-semibold text-zendesk-navy">
                Email dashboard report
              </h2>
              <p className="mt-0.5 text-xs text-zendesk-muted">
                Uses the current period and filter settings shown on this dashboard.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={sending}
            className="rounded p-1 text-zendesk-muted hover:bg-gray-100 disabled:opacity-50"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-3 px-4 py-4">
          <EmailRecipientInput
            label="Recipients"
            value={recipient}
            onChange={onRecipientChange}
            marketManagers={marketManagers}
            placeholder="you@company.com, teammate@company.com"
            disabled={sending}
            variant="stacked"
          />
          <p className="-mt-1 text-[11px] text-zendesk-muted">
            Separate recipients with commas or semicolons.
          </p>
          <label className="flex items-center gap-2 text-xs text-zendesk-navy">
            <input
              type="checkbox"
              checked={attachCsv}
              onChange={(e) => onAttachCsvChange(e.target.checked)}
              disabled={sending}
              className="rounded border-zendesk-border"
            />
            Attach CSV export
          </label>
          {canAttachImages ? (
            <label className="flex items-center gap-2 text-xs text-zendesk-navy">
              <input
                type="checkbox"
                checked={attachImages}
                onChange={(e) => onAttachImagesChange(e.target.checked)}
                disabled={sending}
                className="rounded border-zendesk-border"
              />
              Attach dashboard images ZIP (includes charts)
            </label>
          ) : null}
          {!attachCsv && !attachImages ? (
            <p className="text-xs text-zendesk-muted">Select CSV and/or dashboard images to attach.</p>
          ) : null}
          {sendError ? <p className="text-xs text-red-700">{sendError}</p> : null}
          {sendSuccess ? (
            <p className="text-xs font-medium text-zendesk-green">Report sent.</p>
          ) : null}
        </div>

        <div className="flex justify-end gap-2 border-t border-zendesk-border px-4 py-3">
          <button
            type="button"
            onClick={onClose}
            disabled={sending}
            className="rounded border border-zendesk-border px-3 py-1.5 text-xs text-zendesk-muted hover:bg-gray-50 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onSend}
            disabled={sending || sendSuccess}
            className="rounded bg-zendesk-green px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50"
          >
            {sending ? (attachImages ? "Building image ZIP…" : "Sending…") : "Send report"}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
