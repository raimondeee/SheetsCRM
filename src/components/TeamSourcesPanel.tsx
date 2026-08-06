"use client";

import { useCallback, useEffect, useState } from "react";
import { Plus, ScanSearch, Trash2, X } from "lucide-react";
import type {
  TeamDashboardSourcesFile,
  TeamTabColumnLetters,
  TeamTabSourceConfig,
} from "@/lib/team-dashboard-sources";
import { parseSheetUrl } from "@/lib/types";

interface TeamSourcesPanelProps {
  open: boolean;
  onClose: () => void;
  onSaved?: () => void;
}

function emptySource(): TeamTabSourceConfig {
  return {
    id: `region-${Date.now().toString(36)}`,
    region: "",
    sheetName: "",
    gid: "",
    enabled: true,
    sheetUrl: "",
    spreadsheetId: "",
    columns: { timestamp: "A", status: "B", owner: "C", category: "D", userId: "" },
  };
}

export function TeamSourcesPanel({ open, onClose, onSaved }: TeamSourcesPanelProps) {
  const [config, setConfig] = useState<TeamDashboardSourcesFile | null>(null);
  const [pathHint, setPathHint] = useState("./data/team-dashboard-sources.json");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [detecting, setDetecting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);
  const [detectNotes, setDetectNotes] = useState<Record<string, string[]>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/dashboard/team-sources", {
        cache: "no-store",
        credentials: "same-origin",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load sources");
      setConfig(data.config as TeamDashboardSourcesFile);
      if (typeof data.path === "string") setPathHint(data.path);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load sources");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    void load();
  }, [open, load]);

  async function handleSave() {
    if (!config) return;
    setSaving(true);
    setError(null);
    setSavedMessage(null);
    try {
      const res = await fetch("/api/dashboard/team-sources", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ config }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to save sources");
      setConfig(data.config as TeamDashboardSourcesFile);
      setSavedMessage("Sources saved. Refresh the dashboard to reload sheet data.");
      onSaved?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save sources");
    } finally {
      setSaving(false);
    }
  }

  function updateSource(index: number, patch: Partial<TeamTabSourceConfig>) {
    setConfig((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        sources: prev.sources.map((source, i) =>
          i === index ? { ...source, ...patch } : source
        ),
      };
    });
  }

  function updateColumns(
    index: number,
    field: keyof TeamTabSourceConfig["columns"],
    value: string
  ) {
    setConfig((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        sources: prev.sources.map((source, i) =>
          i === index
            ? { ...source, columns: { ...source.columns, [field]: value } }
            : source
        ),
      };
    });
  }

  async function detectSourceColumns(index: number) {
    if (!config) return;
    const source = config.sources[index];
    if (!source) return;
    const key = source.id || String(index);
    setDetecting(key);
    setError(null);
    try {
      const spreadsheetId =
        source.spreadsheetId?.trim() || config.spreadsheetId.trim();
      const res = await fetch("/api/dashboard/team-sources/detect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          id: source.id,
          region: source.region,
          spreadsheetId,
          sheetName: source.sheetName,
          gid: source.gid,
          columns: source.columns,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to detect columns");
      const columns = data.columns as TeamTabColumnLetters;
      updateSource(index, { columns });
      const warnings = Array.isArray(data.warnings)
        ? (data.warnings as string[])
        : [];
      setDetectNotes((prev) => ({
        ...prev,
        [key]:
          warnings.length > 0
            ? warnings
            : [
                `Matched headers → Timestamp ${columns.timestamp}, Status ${columns.status}, MM ${columns.owner}, Contact Reason ${columns.category}.`,
              ],
      }));
      setSavedMessage(
        "Column letters updated from sheet headers. Save sources to keep them."
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to detect columns");
    } finally {
      setDetecting(null);
    }
  }

  async function detectAllColumns() {
    if (!config) return;
    setDetecting("all");
    setError(null);
    try {
      const res = await fetch("/api/dashboard/team-sources/detect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ all: true }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to detect columns");
      const results = (data.results ?? []) as Array<{
        sourceId: string;
        columns: TeamTabColumnLetters;
        health?: { warnings?: string[] };
      }>;
      const byId = new Map(results.map((row) => [row.sourceId, row]));
      const notes: Record<string, string[]> = {};
      for (const [sourceId, hit] of byId) {
        const warnings = hit.health?.warnings ?? [];
        notes[sourceId] =
          warnings.length > 0
            ? warnings
            : [
                `Matched headers → Timestamp ${hit.columns.timestamp}, Status ${hit.columns.status}, MM ${hit.columns.owner}, Contact Reason ${hit.columns.category}.`,
              ];
      }
      setConfig((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          sources: prev.sources.map((source) => {
            const hit = byId.get(source.id);
            return hit ? { ...source, columns: hit.columns } : source;
          }),
        };
      });
      setDetectNotes(notes);
      setSavedMessage(
        "Column letters updated from sheet headers for enabled sources. Save sources to keep them."
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to detect columns");
    } finally {
      setDetecting(null);
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-lg bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-zendesk-border px-5 py-3">
          <div>
            <h2 className="text-lg font-semibold text-zendesk-navy">Regional source sheets</h2>
            <p className="text-xs text-zendesk-muted">
              Configure spreadsheet tabs that feed the Team dashboard. Saved to{" "}
              <code className="text-[11px]">{pathHint}</code>
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-zendesk-muted hover:bg-gray-100"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
          {error && (
            <p className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
              {error}
            </p>
          )}
          {savedMessage && (
            <p className="rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
              {savedMessage}
            </p>
          )}
          {loading || !config ? (
            <p className="text-sm text-zendesk-muted">Loading…</p>
          ) : (
            <>
              <label className="block text-sm">
                  <span className="font-medium">Default spreadsheet ID</span>
                <input
                  type="text"
                  value={config.spreadsheetId}
                  onChange={(e) =>
                    setConfig((prev) =>
                      prev ? { ...prev, spreadsheetId: e.target.value } : prev
                    )
                  }
                  className="mt-1 w-full rounded border border-zendesk-border px-3 py-2 text-sm"
                  placeholder="Used only when a source does not have its own sheet link"
                />
              </label>

              <div className="space-y-3">
                {config.sources.map((source, index) => (
                  <fieldset
                    key={`${source.id}-${index}`}
                    className="space-y-2 rounded border border-zendesk-border p-3"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <legend className="px-1 text-sm font-medium">
                        Source {index + 1}
                      </legend>
                      <label className="mr-auto flex items-center gap-1.5 text-xs text-zendesk-navy">
                        <input
                          type="checkbox"
                          checked={source.enabled !== false}
                          onChange={(e) => updateSource(index, { enabled: e.target.checked })}
                          className="rounded border-zendesk-border"
                        />
                        Include in Team Dashboard
                      </label>
                      <button
                        type="button"
                        onClick={() =>
                          setConfig((prev) =>
                            prev
                              ? {
                                  ...prev,
                                  sources: prev.sources.filter((_, i) => i !== index),
                                }
                              : prev
                          )
                        }
                        className="inline-flex items-center gap-1 rounded border border-red-200 px-2 py-1 text-xs text-red-700 hover:bg-red-50"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        Remove
                      </button>
                    </div>
                    <div className="grid gap-2 sm:grid-cols-2">
                      <label className="block text-xs">
                        <span className="font-medium">Team / region name</span>
                        <input
                          value={source.region}
                          onChange={(e) => updateSource(index, { region: e.target.value })}
                          className="mt-1 w-full rounded border border-zendesk-border px-2 py-1.5 text-sm"
                        />
                      </label>
                      <label className="block text-xs">
                        <span className="font-medium">Direct Google Sheet link</span>
                        <input
                          value={source.sheetUrl ?? ""}
                          onChange={(e) => {
                            const sheetUrl = e.target.value;
                            const parsed = parseSheetUrl(sheetUrl);
                            updateSource(index, {
                              sheetUrl,
                              spreadsheetId: parsed?.spreadsheetId ?? source.spreadsheetId,
                              gid: parsed?.gid ?? source.gid,
                            });
                          }}
                          className="mt-1 w-full rounded border border-zendesk-border px-2 py-1.5 text-sm"
                          placeholder="https://docs.google.com/spreadsheets/d/..."
                        />
                      </label>
                      <label className="block text-xs">
                        <span className="font-medium">Source id</span>
                        <input
                          value={source.id}
                          onChange={(e) => updateSource(index, { id: e.target.value })}
                          className="mt-1 w-full rounded border border-zendesk-border px-2 py-1.5 text-sm"
                        />
                      </label>
                      <label className="block text-xs">
                        <span className="font-medium">Sheet tab name</span>
                        <input
                          value={source.sheetName}
                          onChange={(e) => updateSource(index, { sheetName: e.target.value })}
                          className="mt-1 w-full rounded border border-zendesk-border px-2 py-1.5 text-sm"
                        />
                      </label>
                      <label className="block text-xs">
                        <span className="font-medium">Tab gid</span>
                        <input
                          value={source.gid}
                          onChange={(e) => updateSource(index, { gid: e.target.value })}
                          className="mt-1 w-full rounded border border-zendesk-border px-2 py-1.5 text-sm"
                        />
                      </label>
                    </div>
                    <p className="text-xs text-zendesk-muted">
                      The dashboard reads this sheet only. Add a second source with the same team name
                      when a team uses separate language tabs. Letters are a fallback — Detect columns
                      matches header names, and reporting also remaps from headers at load time.
                    </p>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="grid min-w-0 flex-1 grid-cols-2 gap-2 sm:grid-cols-5">
                        {(
                          [
                            ["timestamp", "Timestamp"],
                            ["status", "Status"],
                            ["owner", "MM"],
                            ["category", "Contact Reason"],
                            ["userId", "User ID"],
                          ] as const
                        ).map(([field, label]) => (
                          <label key={field} className="block text-xs">
                            <span className="font-medium">{label}</span>
                            <input
                              value={source.columns[field] ?? ""}
                              onChange={(e) => updateColumns(index, field, e.target.value)}
                              className="mt-1 w-full rounded border border-zendesk-border px-2 py-1.5 text-sm uppercase"
                            />
                          </label>
                        ))}
                      </div>
                      <button
                        type="button"
                        disabled={Boolean(detecting)}
                        onClick={() => void detectSourceColumns(index)}
                        className="inline-flex shrink-0 items-center gap-1 rounded border border-zendesk-border px-2 py-1.5 text-xs hover:bg-gray-50 disabled:opacity-50"
                      >
                        <ScanSearch className="h-3.5 w-3.5" />
                        {detecting === (source.id || String(index))
                          ? "Detecting…"
                          : "Detect columns"}
                      </button>
                    </div>
                    {(detectNotes[source.id] ?? []).length > 0 && (
                      <ul className="space-y-1 rounded border border-amber-200 bg-amber-50 px-2 py-1.5 text-xs text-amber-950">
                        {(detectNotes[source.id] ?? []).map((note) => (
                          <li key={note}>{note}</li>
                        ))}
                      </ul>
                    )}
                  </fieldset>
                ))}
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() =>
                    setConfig((prev) =>
                      prev ? { ...prev, sources: [...prev.sources, emptySource()] } : prev
                    )
                  }
                  className="inline-flex items-center gap-1.5 rounded border border-zendesk-border px-3 py-2 text-sm hover:bg-gray-50"
                >
                  <Plus className="h-4 w-4" />
                  Add source sheet
                </button>
                <button
                  type="button"
                  disabled={Boolean(detecting) || config.sources.length === 0}
                  onClick={() => void detectAllColumns()}
                  className="inline-flex items-center gap-1.5 rounded border border-zendesk-border px-3 py-2 text-sm hover:bg-gray-50 disabled:opacity-50"
                >
                  <ScanSearch className="h-4 w-4" />
                  {detecting === "all" ? "Detecting…" : "Detect all columns"}
                </button>
              </div>
            </>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-zendesk-border px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-zendesk-border px-4 py-2 text-sm hover:bg-gray-50"
          >
            Close
          </button>
          <button
            type="button"
            disabled={!config || saving}
            onClick={() => void handleSave()}
            className="rounded bg-zendesk-navy px-4 py-2 text-sm font-medium text-white hover:bg-zendesk-navy/90 disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save sources"}
          </button>
        </div>
      </div>
    </div>
  );
}
