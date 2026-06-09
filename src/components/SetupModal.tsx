"use client";

import { useMemo, useState } from "react";
import type { ColumnMapping, SheetConfig } from "@/lib/types";
import { EXAMPLE_SHEET_URL } from "@/lib/default-sheet-config";
import {
  COLUMN_ROLE_OPTIONS,
  getMappingSummary,
  RECOMMENDED_ROLES,
  roleLabel,
} from "@/lib/column-roles";
import { MarketManagersPanel } from "./MarketManagersPanel";
import { Search, X } from "lucide-react";

interface SetupModalProps {
  config: SheetConfig | null;
  onClose: () => void;
  onSaved: () => void;
}

export function SetupModal({ config, onClose, onSaved }: SetupModalProps) {
  const [activeTab, setActiveTab] = useState<"sheet" | "managers">("sheet");
  const [sheetUrl, setSheetUrl] = useState(config?.sheetUrl ?? EXAMPLE_SHEET_URL);
  const [analyzed, setAnalyzed] = useState<SheetConfig | null>(config);
  const [analysisNote, setAnalysisNote] = useState<string | null>(null);
  const [columnSearch, setColumnSearch] = useState("");
  const [showUnmappedOnly, setShowUnmappedOnly] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const mappingSummary = useMemo(
    () => (analyzed ? getMappingSummary(analyzed) : null),
    [analyzed]
  );

  const visibleColumns = useMemo(() => {
    if (!analyzed) return [];
    const q = columnSearch.trim().toLowerCase();
    return analyzed.columns
      .filter((col) => {
        if (showUnmappedOnly && col.role !== "unknown") return false;
        if (!q) return true;
        return (
          col.letter.toLowerCase().includes(q) ||
          col.header.toLowerCase().includes(q) ||
          roleLabel(col.role).toLowerCase().includes(q)
        );
      })
      .sort((a, b) => a.index - b.index);
  }, [analyzed, columnSearch, showUnmappedOnly]);

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
      setAnalyzed({ ...data.config, manuallyMapped: false });
      setAnalysisNote(
        data.analysis?.note ??
          `Analyzed "${data.config.sheetName}" — remap columns below, then save.`
      );
    } finally {
      setLoading(false);
    }
  }

  async function save() {
    if (!analyzed) return;
    setSaving(true);
    try {
      const payload: SheetConfig = {
        ...analyzed,
        sheetUrl,
        manuallyMapped: true,
        updatedAt: new Date().toISOString(),
      };
      await fetch("/api/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  function updateRole(index: number, role: ColumnMapping["role"]) {
    if (!analyzed) return;
    setAnalyzed({
      ...analyzed,
      columns: analyzed.columns.map((c) =>
        c.index === index ? { ...c, role } : c.role === role && role !== "unknown" ? { ...c, role: "unknown" } : c
      ),
      manuallyMapped: true,
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-lg bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-zendesk-border px-6 py-4">
          <div>
            <h2 className="text-lg font-semibold">Setup</h2>
            <p className="text-sm text-zendesk-muted">
              Connect your intake sheet and manage the Market Manager email directory.
            </p>
          </div>
          <button type="button" onClick={onClose} className="rounded p-1 hover:bg-gray-100">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex gap-1 border-b border-zendesk-border px-6 pt-3">
          <button
            type="button"
            onClick={() => setActiveTab("sheet")}
            className={`rounded-t px-4 py-2 text-sm font-medium ${
              activeTab === "sheet"
                ? "border border-b-white border-zendesk-border bg-white text-zendesk-green -mb-px"
                : "text-zendesk-muted hover:text-gray-900"
            }`}
          >
            Sheet mapping
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("managers")}
            className={`rounded-t px-4 py-2 text-sm font-medium ${
              activeTab === "managers"
                ? "border border-b-white border-zendesk-border bg-white text-zendesk-green -mb-px"
                : "text-zendesk-muted hover:text-gray-900"
            }`}
          >
            Market managers
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4">
          {activeTab === "managers" ? (
            <MarketManagersPanel />
          ) : (
            <>
          <label className="block text-sm font-medium">Google Sheet URL</label>
          <input
            type="url"
            value={sheetUrl}
            onChange={(e) => setSheetUrl(e.target.value)}
            className="mt-1 w-full rounded border border-zendesk-border px-3 py-2 text-sm"
            placeholder="https://docs.google.com/spreadsheets/d/..."
          />
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={analyze}
              disabled={loading}
              className="rounded bg-zendesk-teal px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {loading ? "Analyzing…" : "Analyze sheet"}
            </button>
            {analyzed && (
              <span className="self-center text-xs text-zendesk-muted">
                Tab: <strong>{analyzed.sheetName}</strong>
              </span>
            )}
          </div>

          {analysisNote && (
            <p className="mt-3 rounded bg-amber-50 px-3 py-2 text-sm text-amber-800">{analysisNote}</p>
          )}

          {analyzed && mappingSummary && (
            <div className="mt-6">
              <h3 className="text-sm font-semibold">Mapping status</h3>
              <div className="mt-2 flex flex-wrap gap-2">
                {RECOMMENDED_ROLES.map((role) => {
                  const col = analyzed.columns.find((c) => c.role === role);
                  const ok = Boolean(col);
                  return (
                    <span
                      key={role}
                      className={`rounded px-2 py-0.5 text-xs ${
                        ok
                          ? "bg-green-50 text-green-800 ring-1 ring-green-200"
                          : "bg-gray-100 text-zendesk-muted"
                      }`}
                      title={col ? `${col.letter}: ${col.header}` : "Not mapped"}
                    >
                      {roleLabel(role)}
                      {col ? ` (${col.letter})` : ""}
                    </span>
                  );
                })}
              </div>
              {mappingSummary.missing.length > 0 && (
                <p className="mt-2 text-xs text-amber-700">
                  Unmapped recommended fields:{" "}
                  {mappingSummary.missing.map((r) => roleLabel(r)).join(", ")}
                </p>
              )}
            </div>
          )}

          {analyzed && (
            <div className="mt-6">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h3 className="text-sm font-semibold">Column mapping</h3>
                <label className="flex items-center gap-2 text-xs text-zendesk-muted">
                  <input
                    type="checkbox"
                    checked={showUnmappedOnly}
                    onChange={(e) => setShowUnmappedOnly(e.target.checked)}
                    className="rounded border-zendesk-border"
                  />
                  Show unmapped only
                </label>
              </div>
              <div className="relative mt-2 max-w-sm">
                <Search className="absolute left-2 top-2 h-4 w-4 text-zendesk-muted" />
                <input
                  type="search"
                  value={columnSearch}
                  onChange={(e) => setColumnSearch(e.target.value)}
                  placeholder="Filter by letter, header, or role…"
                  className="w-full rounded border border-zendesk-border py-1.5 pl-8 pr-3 text-sm outline-none focus:border-zendesk-green"
                />
              </div>
              <p className="mt-2 text-xs text-zendesk-muted">
                Each column letter is independent — H/I/N/U/AD are defaults for the example sheet only.
                Assign the role that matches each header on this agent&apos;s sheet.
              </p>
              <div className="mt-3 max-h-[40vh] overflow-y-auto rounded border border-zendesk-border">
                <table className="w-full text-left text-sm">
                  <thead className="sticky top-0 bg-gray-50 text-xs text-zendesk-muted">
                    <tr className="border-b">
                      <th className="px-3 py-2">Col</th>
                      <th className="px-3 py-2">Header (row 1)</th>
                      <th className="px-3 py-2">CRM field</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleColumns.map((col) => (
                      <tr
                        key={col.index}
                        className={`border-b border-zendesk-border/60 ${
                          col.role !== "unknown" ? "bg-green-50/40" : ""
                        }`}
                      >
                        <td className="px-3 py-2 font-mono text-xs">{col.letter}</td>
                        <td className="px-3 py-2">{col.header || "—"}</td>
                        <td className="px-3 py-2">
                          <select
                            value={col.role}
                            onChange={(e) =>
                              updateRole(col.index, e.target.value as ColumnMapping["role"])
                            }
                            className="w-full max-w-xs rounded border border-zendesk-border px-2 py-1 text-xs"
                          >
                            {COLUMN_ROLE_OPTIONS.map((opt) => (
                              <option key={opt.value} value={opt.value}>
                                {opt.label}
                              </option>
                            ))}
                          </select>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {visibleColumns.length === 0 && (
                  <p className="p-4 text-sm text-zendesk-muted">No columns match this filter.</p>
                )}
              </div>
            </div>
          )}
            </>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-zendesk-border px-6 py-4">
          <button type="button" onClick={onClose} className="rounded px-4 py-2 text-sm hover:bg-gray-100">
            Close
          </button>
          {activeTab === "sheet" && (
            <button
              type="button"
              onClick={save}
              disabled={!analyzed || saving}
              className="rounded bg-zendesk-green px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save mapping"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
