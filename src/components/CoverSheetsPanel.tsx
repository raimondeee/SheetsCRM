"use client";

import { useEffect, useMemo, useState } from "react";
import type { CoverSheetEntry, SheetConfig } from "@/lib/types";
import { EXAMPLE_SHEET_URL } from "@/lib/default-sheet-config";
import { createDefaultCoverSheetEntries } from "@/lib/cover-sheets";
import { prepareSheetConfig } from "@/lib/ui-field-slots";
import { ChevronDown } from "lucide-react";
import { mergeAnalyzedSheetConfig, SheetMappingPanel } from "./SheetMappingPanel";

interface EntryDraft {
  sheetUrl: string;
  analyzed: SheetConfig | null;
  analysisNote: string | null;
  loading: boolean;
}

function buildEntryDraft(entry: CoverSheetEntry): EntryDraft {
  const config = entry.config ? prepareSheetConfig(entry.config) : null;
  return {
    sheetUrl: config?.sheetUrl ?? "",
    analyzed: config,
    analysisNote: null,
    loading: false,
  };
}

function entryTitle(entry: CoverSheetEntry, draft: EntryDraft): string {
  const label = entry.label.trim();
  if (label) return label;
  if (draft.analyzed?.sheetName?.trim()) return draft.analyzed.sheetName.trim();
  return "Unnamed sheet";
}

export function CoverSheetsPanel({ onSaved }: { onSaved?: () => void }) {
  const [entries, setEntries] = useState<CoverSheetEntry[]>(() =>
    createDefaultCoverSheetEntries()
  );
  const [drafts, setDrafts] = useState<Record<string, EntryDraft>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const res = await fetch("/api/cover-sheets");
        const data = await res.json();
        if (cancelled || data.error) return;
        const loaded = (data.entries ?? createDefaultCoverSheetEntries()) as CoverSheetEntry[];
        setEntries(loaded);
        setDrafts(
          Object.fromEntries(loaded.map((entry) => [entry.id, buildEntryDraft(entry)]))
        );
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const enabledCount = useMemo(
    () => entries.filter((entry) => entry.enabled).length,
    [entries]
  );

  function updateEntry(id: string, patch: Partial<CoverSheetEntry>) {
    setEntries((prev) => prev.map((entry) => (entry.id === id ? { ...entry, ...patch } : entry)));
  }

  function updateDraft(id: string, patch: Partial<EntryDraft>) {
    setDrafts((prev) => ({
      ...prev,
      [id]: { ...(prev[id] ?? buildEntryDraft(entries.find((entry) => entry.id === id)!)), ...patch },
    }));
  }

  async function analyzeEntry(entry: CoverSheetEntry) {
    const draft = drafts[entry.id] ?? buildEntryDraft(entry);
    const sheetUrl = draft.sheetUrl.trim();
    if (!sheetUrl) {
      updateDraft(entry.id, { analysisNote: "Enter a Google Sheet URL first." });
      return;
    }

    updateDraft(entry.id, { loading: true, analysisNote: null });
    try {
      const res = await fetch("/api/sheet/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sheetUrl }),
      });
      const data = await res.json();
      if (data.error) {
        updateDraft(entry.id, { analysisNote: data.error, loading: false });
        return;
      }
      const merged = prepareSheetConfig(
        mergeAnalyzedSheetConfig(draft.analyzed, {
          ...data.config,
          id: entry.id,
          manuallyMapped: false,
        })
      );
      updateDraft(entry.id, {
        analyzed: merged,
        analysisNote:
          data.analysis?.note ??
          `Analyzed "${data.config.sheetName}" — remap columns below, then save.`,
        loading: false,
      });
    } catch (error) {
      updateDraft(entry.id, {
        analysisNote: error instanceof Error ? error.message : "Failed to analyze sheet",
        loading: false,
      });
    }
  }

  async function save() {
    setSaving(true);
    setSaveError(null);
    setMessage(null);
    try {
      const payload: CoverSheetEntry[] = entries.map((entry) => {
        const draft = drafts[entry.id] ?? buildEntryDraft(entry);
        const analyzed = draft.analyzed
          ? prepareSheetConfig({
              ...draft.analyzed,
              id: entry.id,
              sheetUrl: draft.sheetUrl.trim() || draft.analyzed.sheetUrl,
              manuallyMapped: draft.analyzed.manuallyMapped ?? true,
              updatedAt: new Date().toISOString(),
            })
          : null;
        return {
          id: entry.id,
          label: entry.label.trim(),
          enabled: entry.enabled,
          config: analyzed,
        };
      });

      const res = await fetch("/api/cover-sheets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entries: payload }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to save team coverage");
      }

      const saved = (data.entries ?? payload) as CoverSheetEntry[];
      setEntries(saved);
      setDrafts(
        Object.fromEntries(saved.map((entry) => [entry.id, buildEntryDraft(entry)]))
      );
      setMessage(`Saved ${saved.filter((entry) => entry.enabled).length} enabled cover sheet(s).`);
      onSaved?.();
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Failed to save team coverage");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <p className="text-sm text-zendesk-muted">Loading team coverage…</p>;
  }

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold">Team coverage</h3>
        <p className="mt-1 text-sm text-zendesk-muted">
          Add up to 10 teammate intake sheets. Enabled sheets merge into your inbox with a banner
          showing which agent or team each ticket belongs to. Analyze and map each sheet
          independently.
        </p>
        <p className="mt-2 text-xs text-zendesk-muted">
          {enabledCount} of {entries.length} slots enabled.
        </p>
      </div>

      <div className="space-y-2">
        {entries.map((entry) => {
          const draft = drafts[entry.id] ?? buildEntryDraft(entry);
          const isExpanded = expanded[entry.id] ?? false;
          const title = entryTitle(entry, draft);
          const mapped = Boolean(draft.analyzed?.columns?.some((col) => col.role !== "unknown"));

          return (
            <section
              key={entry.id}
              className="overflow-hidden rounded border border-zendesk-border bg-white"
            >
              <div className="flex items-center gap-3 px-3 py-2.5">
                <label className="flex shrink-0 items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={entry.enabled}
                    onChange={(e) => updateEntry(entry.id, { enabled: e.target.checked })}
                    className="rounded border-zendesk-border"
                    aria-label={`Enable ${title}`}
                  />
                  <span className="sr-only">Enable</span>
                </label>
                <button
                  type="button"
                  onClick={() =>
                    setExpanded((prev) => ({ ...prev, [entry.id]: !isExpanded }))
                  }
                  className="flex min-w-0 flex-1 items-center gap-2 text-left"
                  aria-expanded={isExpanded}
                >
                  <ChevronDown
                    className={`h-4 w-4 shrink-0 text-zendesk-muted transition-transform ${
                      isExpanded ? "rotate-180" : ""
                    }`}
                  />
                  <span className="truncate font-medium text-zendesk-navy">{title}</span>
                  {!entry.enabled && (
                    <span className="shrink-0 rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-zendesk-muted">
                      Disabled
                    </span>
                  )}
                  {entry.enabled && !mapped && (
                    <span className="shrink-0 rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-800">
                      Needs mapping
                    </span>
                  )}
                </button>
              </div>

              {isExpanded && (
                <div className="border-t border-zendesk-border px-3 py-4">
                  <label className="block text-sm font-medium">Agent / team name</label>
                  <input
                    type="text"
                    value={entry.label}
                    onChange={(e) => updateEntry(entry.id, { label: e.target.value })}
                    placeholder="e.g. Alex — West Coast"
                    className="mt-1 w-full rounded border border-zendesk-border px-3 py-2 text-sm"
                  />
                  <div className="mt-4">
                    <SheetMappingPanel
                      compact
                      sheetUrl={draft.sheetUrl || EXAMPLE_SHEET_URL}
                      onSheetUrlChange={(sheetUrl) => updateDraft(entry.id, { sheetUrl })}
                      analyzed={draft.analyzed}
                      onAnalyzedChange={(analyzed) =>
                        updateDraft(entry.id, { analyzed, analysisNote: null })
                      }
                      onAnalyze={() => analyzeEntry(entry)}
                      loading={draft.loading}
                      analysisNote={draft.analysisNote}
                    />
                  </div>
                </div>
              )}
            </section>
          );
        })}
      </div>

      {message ? <p className="text-sm text-green-700">{message}</p> : null}
      {saveError ? <p className="text-sm text-red-700">{saveError}</p> : null}

      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => void save()}
          disabled={saving}
          className="rounded bg-zendesk-green px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save team coverage"}
        </button>
      </div>
    </div>
  );
}
