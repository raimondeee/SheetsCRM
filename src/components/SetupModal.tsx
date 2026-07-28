/**
 * Setup modal tabs: sheet column mapping, cover sheets, market managers,
 * localhost-only .env editor, and business hours. Analyze → POST /api/sheet/analyze;
 * save sheet config → /api/config.
 */
"use client";

import { useEffect, useRef, useState } from "react";
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
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    contentRef.current?.scrollTo({ top: 0 });
  }, [activeTab]);

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
          mergeAnalyzedSheetConfig(
            analyzed ?? config,
            { ...data.config, manuallyMapped: false },
            { forceRemapRoles: true }
          )
        )
      );
      setAnalysisNote(
        data.analysis?.note ??
          `Analyzed "${data.config.sheetName}" — roles rematched from current headers. Save mapping to keep.`
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

  const tabs: { id: SetupModalTab; label: string }[] = [
    { id: "sheet", label: "Sheet mapping" },
    { id: "cover", label: "Team coverage" },
    { id: "managers", label: "Market managers" },
    { id: "environment", label: "Environment" },
    { id: "hours", label: "Business hours" },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-lg bg-white shadow-xl">
        <div className="shrink-0 border-b border-zendesk-border px-6 py-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold">Setup</h2>
              <p className="text-sm text-zendesk-muted">
                Connect your intake sheet, teammate coverage, local environment, and Market Manager
                directory.
              </p>
            </div>
            <button type="button" onClick={onClose} className="rounded p-1 hover:bg-gray-100">
              <X className="h-5 w-5" />
            </button>
          </div>

          <div
            role="tablist"
            aria-label="Setup sections"
            className="mt-4 flex gap-1 overflow-x-auto pb-px"
          >
            {tabs.map((tab) => {
              const selected = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  onClick={() => setActiveTab(tab.id)}
                  className={`shrink-0 rounded-t border px-4 py-2 text-sm font-medium ${
                    selected
                      ? "border-zendesk-border border-b-white bg-white text-zendesk-green"
                      : "border-transparent text-zendesk-muted hover:text-gray-900"
                  }`}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>
        </div>

        <div ref={contentRef} className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
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

        <div className="flex shrink-0 flex-col items-end gap-2 border-t border-zendesk-border px-6 py-4">
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
