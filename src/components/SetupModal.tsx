"use client";

import { useEffect, useState } from "react";
import type { SheetConfig } from "@/lib/types";
import { EXAMPLE_SHEET_URL } from "@/lib/default-sheet-config";
import {
  prepareSheetConfig,
} from "@/lib/ui-field-slots";
import { normalizeBusinessHours, type BusinessHoursConfig } from "@/lib/business-hours";
import { EnvSettingsPanel } from "./EnvSettingsPanel";
import { MarketManagersPanel } from "./MarketManagersPanel";
import { BusinessHoursPanel } from "./BusinessHoursPanel";
import { CoverSheetsPanel } from "./CoverSheetsPanel";
import { mergeAnalyzedSheetConfig, SheetMappingPanel } from "./SheetMappingPanel";
import { X } from "lucide-react";

export type SetupModalTab = "sheet" | "cover" | "managers" | "environment" | "hours";

interface SetupModalProps {
  config: SheetConfig | null;
  onClose: () => void;
  onSaved: (savedConfig?: SheetConfig, meta?: { businessHoursUpdated?: boolean }) => void;
  initialTab?: SetupModalTab;
}

export function SetupModal({
  config,
  onClose,
  onSaved,
  initialTab = "sheet",
}: SetupModalProps) {
  const [activeTab, setActiveTab] = useState<SetupModalTab>(initialTab);
  const [sheetUrl, setSheetUrl] = useState(config?.sheetUrl ?? EXAMPLE_SHEET_URL);
  const [analyzed, setAnalyzed] = useState<SheetConfig | null>(() =>
    config ? prepareSheetConfig(config) : null
  );
  const [analysisNote, setAnalysisNote] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [businessHoursDraft, setBusinessHoursDraft] = useState<BusinessHoursConfig>(() =>
    normalizeBusinessHours(config?.businessHours)
  );

  useEffect(() => {
    setBusinessHoursDraft(normalizeBusinessHours(config?.businessHours));
    if (config) {
      setAnalyzed(prepareSheetConfig(config));
      setSheetUrl(config.sheetUrl ?? EXAMPLE_SHEET_URL);
    }
  }, [config]);

  async function analyze() {
    setLoading(true);
    setAnalysisNote(null);
    try {
      const res = await fetch("/api/sheet/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sheetUrl }),
      });
      const data = await res.json();
      if (data.error) {
        setAnalysisNote(data.error);
        return;
      }
      setAnalyzed(
        prepareSheetConfig(
          mergeAnalyzedSheetConfig(config, { ...data.config, manuallyMapped: false })
        )
      );
      setAnalysisNote(
        data.analysis?.note ??
          `Analyzed "${data.config.sheetName}" — remap columns below, then save.`
      );
    } finally {
      setLoading(false);
    }
  }

  async function save() {
    const base = analyzed ?? (config ? prepareSheetConfig(config) : null);
    if (!base && !config) return;
    setSaving(true);
    setSaveError(null);
    try {
      const merged = base ?? prepareSheetConfig(config!);
      const payload: SheetConfig = prepareSheetConfig({
        ...(config ?? merged),
        ...merged,
        businessHours: businessHoursDraft,
        sheetUrl: merged.sheetUrl || config?.sheetUrl || sheetUrl,
        manuallyMapped: merged.manuallyMapped ?? config?.manuallyMapped ?? true,
        updatedAt: new Date().toISOString(),
      });
      const res = await fetch("/api/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await res.json()) as { config?: SheetConfig; error?: string };
      if (!res.ok) {
        throw new Error(data.error || "Failed to save setup");
      }
      onSaved(data.config ?? payload, activeTab === "hours" ? { businessHoursUpdated: true } : undefined);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Failed to save setup");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-lg bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-zendesk-border px-6 py-4">
          <div>
            <h2 className="text-lg font-semibold">Setup</h2>
            <p className="text-sm text-zendesk-muted">
              Connect your intake sheet, teammate coverage, local environment, and Market Manager directory.
            </p>
          </div>
          <button type="button" onClick={onClose} className="rounded p-1 hover:bg-gray-100">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex gap-1 overflow-x-auto border-b border-zendesk-border px-6 pt-3">
          <button
            type="button"
            onClick={() => setActiveTab("sheet")}
            className={`shrink-0 rounded-t px-4 py-2 text-sm font-medium ${
              activeTab === "sheet"
                ? "border border-b-white border-zendesk-border bg-white text-zendesk-green -mb-px"
                : "text-zendesk-muted hover:text-gray-900"
            }`}
          >
            Sheet mapping
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("cover")}
            className={`shrink-0 rounded-t px-4 py-2 text-sm font-medium ${
              activeTab === "cover"
                ? "border border-b-white border-zendesk-border bg-white text-zendesk-green -mb-px"
                : "text-zendesk-muted hover:text-gray-900"
            }`}
          >
            Team coverage
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("managers")}
            className={`shrink-0 rounded-t px-4 py-2 text-sm font-medium ${
              activeTab === "managers"
                ? "border border-b-white border-zendesk-border bg-white text-zendesk-green -mb-px"
                : "text-zendesk-muted hover:text-gray-900"
            }`}
          >
            Market managers
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("environment")}
            className={`shrink-0 rounded-t px-4 py-2 text-sm font-medium ${
              activeTab === "environment"
                ? "border border-b-white border-zendesk-border bg-white text-zendesk-green -mb-px"
                : "text-zendesk-muted hover:text-gray-900"
            }`}
          >
            Environment
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("hours")}
            className={`shrink-0 rounded-t px-4 py-2 text-sm font-medium ${
              activeTab === "hours"
                ? "border border-b-white border-zendesk-border bg-white text-zendesk-green -mb-px"
                : "text-zendesk-muted hover:text-gray-900"
            }`}
          >
            Business hours
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4">
          {activeTab === "environment" ? (
            <EnvSettingsPanel />
          ) : activeTab === "managers" ? (
            <MarketManagersPanel />
          ) : activeTab === "cover" ? (
            <CoverSheetsPanel onSaved={() => onSaved()} />
          ) : activeTab === "hours" ? (
            <BusinessHoursPanel
              value={businessHoursDraft}
              onChange={(businessHours) => {
                const normalized = normalizeBusinessHours(businessHours);
                setBusinessHoursDraft(normalized);
                if (analyzed) {
                  setAnalyzed({ ...analyzed, businessHours: normalized });
                }
              }}
            />
          ) : (
            <SheetMappingPanel
              sheetUrl={sheetUrl}
              onSheetUrlChange={setSheetUrl}
              analyzed={analyzed}
              onAnalyzedChange={(next) => setAnalyzed(next)}
              onAnalyze={analyze}
              loading={loading}
              analysisNote={analysisNote}
            />
          )}
        </div>

        <div className="flex flex-col items-end gap-2 border-t border-zendesk-border px-6 py-4">
          {saveError ? (
            <p className="w-full text-right text-sm text-red-700">{saveError}</p>
          ) : null}
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="rounded px-4 py-2 text-sm hover:bg-gray-100">
              Close
            </button>
            {activeTab === "sheet" || activeTab === "hours" ? (
              <button
                type="button"
                onClick={save}
                disabled={(activeTab === "sheet" && !analyzed && !config) || saving}
                className="rounded bg-zendesk-green px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
              >
                {saving ? "Saving…" : activeTab === "hours" ? "Save business hours" : "Save mapping"}
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
