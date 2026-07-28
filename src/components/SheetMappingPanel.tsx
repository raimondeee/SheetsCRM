"use client";

import { useEffect, useMemo, useState } from "react";
import type { ColumnMapping, ColumnRole, SheetConfig } from "@/lib/types";
import {
  COLUMN_ROLE_OPTIONS,
  CRM_ROLE_DESTINATIONS,
  getMappingSummary,
  RECOMMENDED_ROLES,
  roleDestination,
  roleLabel,
} from "@/lib/column-roles";
import {
  columnDisplayLabel,
  ensureUiFieldSlots,
  getVisibleUiFieldSlots,
} from "@/lib/ui-field-slots";
import { rowKeyMappingWarning } from "@/lib/config-repair";
import { mappingWarningsFingerprint } from "@/lib/mapping-warnings";
import { patchUserPreferences } from "@/lib/user-preferences";
import { ArrowRight, RotateCcw, Search, X } from "lucide-react";

interface SheetMappingPanelProps {
  sheetUrl: string;
  onSheetUrlChange: (url: string) => void;
  analyzed: SheetConfig | null;
  onAnalyzedChange: (config: SheetConfig) => void;
  onAnalyze: () => void | Promise<void>;
  loading?: boolean;
  analysisNote?: string | null;
  compact?: boolean;
  /** Shown under Detect notes (covers say “Save team coverage”). */
  persistHint?: string;
}

interface MappingDiffRow {
  role: ColumnRole;
  beforeLetter: string | null;
  beforeHeader: string | null;
  afterLetter: string | null;
  afterHeader: string | null;
  changed: boolean;
}

interface DetectProposal {
  before: SheetConfig;
  after: SheetConfig;
  warnings: string[];
  diffs: MappingDiffRow[];
}

function roleMappingSnapshot(
  config: SheetConfig,
  role: ColumnRole
): { letter: string | null; header: string | null } {
  const col = config.columns.find((c) => c.role === role);
  if (!col) return { letter: null, header: null };
  return {
    letter: col.letter?.toUpperCase() ?? null,
    header: (col.sheetHeader || col.header || "").trim() || null,
  };
}

function buildMappingDiffs(before: SheetConfig, after: SheetConfig): MappingDiffRow[] {
  const roles = new Set<ColumnRole>([
    ...RECOMMENDED_ROLES,
    "timestamp",
    "subject",
    "description",
    "userEmailed",
  ]);
  for (const col of [...before.columns, ...after.columns]) {
    if (col.role !== "unknown") roles.add(col.role);
  }

  const rows: MappingDiffRow[] = [];
  for (const role of roles) {
    const prev = roleMappingSnapshot(before, role);
    const next = roleMappingSnapshot(after, role);
    if (!prev.letter && !next.letter) continue;
    const changed =
      prev.letter !== next.letter ||
      (prev.header ?? "").toLowerCase() !== (next.header ?? "").toLowerCase();
    rows.push({
      role,
      beforeLetter: prev.letter,
      beforeHeader: prev.header,
      afterLetter: next.letter,
      afterHeader: next.header,
      changed,
    });
  }

  return rows.sort((a, b) => {
    if (a.changed !== b.changed) return a.changed ? -1 : 1;
    return roleLabel(a.role).localeCompare(roleLabel(b.role));
  });
}

function formatMappingCell(letter: string | null, header: string | null): string {
  if (!letter) return "— not mapped —";
  return header ? `${letter} · ${header}` : letter;
}

export function SheetMappingPanel({
  sheetUrl,
  onSheetUrlChange,
  analyzed,
  onAnalyzedChange,
  onAnalyze,
  loading = false,
  analysisNote = null,
  compact = false,
  persistHint = "Save mapping to keep these letters permanently.",
}: SheetMappingPanelProps) {
  const [columnSearch, setColumnSearch] = useState("");
  const [showUnmappedOnly, setShowUnmappedOnly] = useState(false);
  const [showHiddenColumns, setShowHiddenColumns] = useState(false);
  const [showUnusedUiFields, setShowUnusedUiFields] = useState(false);
  const [detecting, setDetecting] = useState(false);
  const [detectError, setDetectError] = useState<string | null>(null);
  const [detectProposal, setDetectProposal] = useState<DetectProposal | null>(null);
  const [showUnchangedDiffs, setShowUnchangedDiffs] = useState(false);

  useEffect(() => {
    if (!loading) return;
    setDetectProposal(null);
    setDetectError(null);
  }, [loading]);

  const changedDiffs = useMemo(
    () => detectProposal?.diffs.filter((row) => row.changed) ?? [],
    [detectProposal]
  );
  const visibleDiffs = useMemo(() => {
    if (!detectProposal) return [];
    return showUnchangedDiffs
      ? detectProposal.diffs
      : detectProposal.diffs.filter((row) => row.changed);
  }, [detectProposal, showUnchangedDiffs]);

  const mappingSummary = useMemo(
    () => (analyzed ? getMappingSummary(analyzed) : null),
    [analyzed]
  );

  const rowKeyWarning = useMemo(
    () => (analyzed ? rowKeyMappingWarning(analyzed) : null),
    [analyzed]
  );

  const visibleUiFieldSlots = useMemo(() => {
    if (!analyzed) return [];
    return getVisibleUiFieldSlots(analyzed, showUnusedUiFields);
  }, [analyzed, showUnusedUiFields]);

  const visibleColumns = useMemo(() => {
    if (!analyzed) return [];
    const q = columnSearch.trim().toLowerCase();
    return analyzed.columns
      .filter((col) => {
        if (col.hidden && !showHiddenColumns) return false;
        if (showUnmappedOnly && col.role !== "unknown") return false;
        if (!q) return true;
        return (
          col.letter.toLowerCase().includes(q) ||
          col.header.toLowerCase().includes(q) ||
          roleLabel(col.role).toLowerCase().includes(q)
        );
      })
      .sort((a, b) => a.index - b.index);
  }, [analyzed, columnSearch, showUnmappedOnly, showHiddenColumns]);

  function updateRole(index: number, role: ColumnMapping["role"]) {
    if (!analyzed) return;
    onAnalyzedChange({
      ...analyzed,
      columns: analyzed.columns.map((c) =>
        c.index === index ? { ...c, role } : c.role === role && role !== "unknown" ? { ...c, role: "unknown" } : c
      ),
      manuallyMapped: true,
    });
  }

  function hideColumn(index: number) {
    if (!analyzed) return;
    const col = analyzed.columns.find((c) => c.index === index);
    if (!col || col.role !== "unknown") return;
    onAnalyzedChange({
      ...analyzed,
      columns: analyzed.columns.map((c) =>
        c.index === index ? { ...c, hidden: true } : c
      ),
      manuallyMapped: true,
    });
  }

  function restoreColumn(index: number) {
    if (!analyzed) return;
    onAnalyzedChange({
      ...analyzed,
      columns: analyzed.columns.map((c) =>
        c.index === index ? { ...c, hidden: false } : c
      ),
      manuallyMapped: true,
    });
  }

  function updateColumnHeader(index: number, header: string) {
    if (!analyzed) return;
    const previous = analyzed.columns.find((c) => c.index === index);
    const slots = ensureUiFieldSlots(analyzed).map((slot) => {
      if (slot.columnIndex !== index) return slot;
      const sheetHeader = previous?.sheetHeader?.trim() ?? previous?.header?.trim() ?? "";
      if (
        !slot.label.trim() ||
        slot.label.trim() === sheetHeader ||
        slot.label.startsWith("Header field ")
      ) {
        return { ...slot, label: header };
      }
      return slot;
    });
    onAnalyzedChange({
      ...analyzed,
      columns: analyzed.columns.map((c) => (c.index === index ? { ...c, header } : c)),
      uiFieldSlots: slots,
      manuallyMapped: true,
    });
  }

  function restoreSheetHeaders() {
    if (!analyzed) return;
    onAnalyzedChange({
      ...analyzed,
      columns: analyzed.columns.map((c) => ({
        ...c,
        header: c.sheetHeader?.trim() || c.header,
      })),
      manuallyMapped: true,
    });
  }

  function updateUiSlotLabel(slotId: string, label: string) {
    if (!analyzed) return;
    const slots = ensureUiFieldSlots(analyzed);
    onAnalyzedChange({
      ...analyzed,
      uiFieldSlots: slots.map((s) => (s.id === slotId ? { ...s, label } : s)),
      manuallyMapped: true,
    });
  }

  function updateUiSlotColumn(slotId: string, columnIndex: number | null) {
    if (!analyzed) return;
    const slots = ensureUiFieldSlots(analyzed).map((s) => {
      if (s.id === slotId) return { ...s, columnIndex };
      if (columnIndex != null && s.columnIndex === columnIndex) {
        return { ...s, columnIndex: null };
      }
      return s;
    });
    onAnalyzedChange({
      ...analyzed,
      uiFieldSlots: slots,
      manuallyMapped: true,
    });
  }

  async function detectColumns() {
    if (!analyzed && !sheetUrl.trim()) return;
    setDetecting(true);
    setDetectError(null);
    setDetectProposal(null);
    setShowUnchangedDiffs(false);
    try {
      const before = analyzed;
      const res = await fetch("/api/sheet/detect-columns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          sheetUrl,
          config: before ?? undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to detect columns");
      const after = data.config as SheetConfig;
      const warnings = Array.isArray(data.warnings) ? (data.warnings as string[]) : [];

      if (!before) {
        // First-time detect with no draft — apply directly so the table can render.
        onAnalyzedChange(after);
        setDetectProposal({
          before: after,
          after,
          warnings:
            warnings.length > 0
              ? warnings
              : ["Initial mapping detected from headers. Review roles below, then save."],
          diffs: [],
        });
        return;
      }

      const diffs = buildMappingDiffs(before, after);
      setDetectProposal({
        before,
        after,
        warnings,
        diffs,
      });
    } catch (err) {
      setDetectError(err instanceof Error ? err.message : "Failed to detect columns");
    } finally {
      setDetecting(false);
    }
  }

  function acceptDetectProposal() {
    if (!detectProposal) return;
    onAnalyzedChange({
      ...detectProposal.after,
      manuallyMapped: true,
    });
    setDetectProposal(null);
  }

  async function keepCurrentMapping() {
    const warnings = detectProposal?.warnings ?? [];
    setDetectProposal(null);
    setDetectError(null);
    if (warnings.length === 0) return;
    try {
      await patchUserPreferences({
        dismissedMappingWarningsFingerprint: mappingWarningsFingerprint(warnings),
      });
    } catch {
      /* local discard still stands */
    }
  }

  return (
    <div className={compact ? "space-y-4" : ""}>
      <label className="block text-sm font-medium">Google Sheet URL</label>
      <input
        type="url"
        value={sheetUrl}
        onChange={(e) => onSheetUrlChange(e.target.value)}
        className="mt-1 w-full rounded border border-zendesk-border px-3 py-2 text-sm"
        placeholder="https://docs.google.com/spreadsheets/d/..."
      />
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => void onAnalyze()}
          disabled={loading || detecting}
          className="rounded bg-zendesk-teal px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {loading ? "Analyzing…" : "Analyze sheet"}
        </button>
        <button
          type="button"
          onClick={() => void detectColumns()}
          disabled={loading || detecting || (!analyzed && !sheetUrl.trim())}
          className="rounded border border-zendesk-border bg-white px-4 py-2 text-sm font-medium text-zendesk-navy hover:bg-gray-50 disabled:opacity-50"
          title="Propose rematching CRM roles from current header names — review before/after, then accept"
        >
          {detecting ? "Detecting…" : "Detect columns"}
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
      {detectError && (
        <p className="mt-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {detectError}
        </p>
      )}
      {detectProposal && (
        <div className="mt-3 space-y-3 rounded border border-amber-200 bg-amber-50 px-3 py-3 text-amber-950">
          <div>
            <p className="text-sm font-semibold">Proposed column mapping</p>
            <p className="mt-0.5 text-xs text-amber-900/90">
              Review before/after below. Accept applies the proposal to this draft only —{" "}
              {persistHint} Use <strong>Keep current mapping</strong> when duplicate/similar
              headers make the suggestion wrong (also dismisses matching CRM warnings).
            </p>
          </div>

          {detectProposal.warnings.length > 0 && (
            <ul className="list-disc space-y-0.5 pl-4 text-xs text-amber-950">
              {detectProposal.warnings.slice(0, 6).map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          )}

          {changedDiffs.length === 0 && detectProposal.diffs.length > 0 ? (
            <p className="text-xs text-amber-900">
              No role letter changes detected. Headers already match the current mapping.
            </p>
          ) : detectProposal.diffs.length === 0 ? (
            <p className="text-xs text-amber-900">
              Mapping loaded from headers. Review the table below, then save.
            </p>
          ) : (
            <div className="overflow-x-auto rounded border border-amber-200 bg-white">
              <table className="min-w-full text-left text-xs">
                <thead className="bg-amber-100/70 text-[11px] uppercase tracking-wide text-amber-900">
                  <tr>
                    <th className="px-2 py-1.5 font-semibold">Field</th>
                    <th className="px-2 py-1.5 font-semibold">Before</th>
                    <th className="px-2 py-1.5 font-semibold" aria-hidden>
                      <ArrowRight className="h-3.5 w-3.5" />
                    </th>
                    <th className="px-2 py-1.5 font-semibold">After</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleDiffs.map((row) => (
                    <tr
                      key={row.role}
                      className={
                        row.changed
                          ? "border-t border-amber-100 bg-amber-50/40"
                          : "border-t border-gray-100 text-zendesk-muted"
                      }
                    >
                      <td className="px-2 py-1.5 font-medium text-zendesk-navy">
                        {roleLabel(row.role)}
                      </td>
                      <td className="px-2 py-1.5">
                        {formatMappingCell(row.beforeLetter, row.beforeHeader)}
                      </td>
                      <td className="px-2 py-1.5 text-zendesk-muted">
                        {row.changed ? "→" : ""}
                      </td>
                      <td
                        className={`px-2 py-1.5 ${
                          row.changed ? "font-medium text-zendesk-navy" : ""
                        }`}
                      >
                        {formatMappingCell(row.afterLetter, row.afterHeader)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            {detectProposal.diffs.some((row) => !row.changed) && (
              <button
                type="button"
                onClick={() => setShowUnchangedDiffs((v) => !v)}
                className="rounded border border-amber-300 bg-white px-2 py-1 text-xs text-amber-950 hover:bg-amber-100"
              >
                {showUnchangedDiffs ? "Hide unchanged" : "Show unchanged"}
              </button>
            )}
            <div className="ml-auto flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void keepCurrentMapping()}
                className="rounded border border-zendesk-border bg-white px-3 py-1.5 text-xs font-medium text-zendesk-navy hover:bg-gray-50"
              >
                Keep current mapping
              </button>
              <button
                type="button"
                onClick={acceptDetectProposal}
                className="rounded bg-zendesk-navy px-3 py-1.5 text-xs font-medium text-white hover:bg-zendesk-navy/90"
              >
                Accept proposal
              </button>
            </div>
          </div>
        </div>
      )}

      {analyzed && mappingSummary && (
        <div className="mt-6">
          <h3 className="text-sm font-semibold">Email subject prefix</h3>
          <p className="mt-1 text-xs text-zendesk-muted">
            Optional fixed text shown before the editable subject when composing. Not mapped from a
            sheet column. Turn it off if you want agents to type the full subject only.
          </p>
          <label className="mt-2 flex items-center gap-2 text-sm text-zendesk-navy">
            <input
              type="checkbox"
              checked={analyzed.emailSubjectPrefix !== ""}
              onChange={(e) =>
                onAnalyzedChange({
                  ...analyzed,
                  emailSubjectPrefix: e.target.checked
                    ? analyzed.emailSubjectPrefix || undefined
                    : "",
                  manuallyMapped: true,
                })
              }
              className="rounded border-zendesk-border"
            />
            Use subject line prefix
          </label>
          {analyzed.emailSubjectPrefix !== "" && (
            <>
              <input
                type="text"
                value={analyzed.emailSubjectPrefix ?? ""}
                onChange={(e) =>
                  onAnalyzedChange({
                    ...analyzed,
                    emailSubjectPrefix: e.target.value,
                    manuallyMapped: true,
                  })
                }
                className="mt-2 w-full rounded border border-zendesk-border px-3 py-2 text-sm"
                placeholder="Form Submission Response - "
              />
              <p className="mt-1 text-[11px] text-zendesk-muted">
                Preview:{" "}
                <span className="font-medium text-zendesk-navy">
                  {(analyzed.emailSubjectPrefix?.trim() || "Form Submission Response -").replace(
                    /\s+$/,
                    ""
                  )}{" "}
                  <span className="font-normal text-zendesk-muted">your subject…</span>
                </span>
              </p>
              <p className="mt-1 text-[11px] text-zendesk-muted">
                Leave the text blank to use the default (“Form Submission Response - ”).
              </p>
            </>
          )}
          {analyzed.emailSubjectPrefix === "" && (
            <p className="mt-2 text-xs text-zendesk-muted">
              Prefix off — compose will use only the subject the agent types.
            </p>
          )}
        </div>
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
                      title={
                        col
                          ? `${col.letter}: ${col.header}${roleDestination(role) ? ` · ${roleDestination(role)}` : ""}`
                          : roleDestination(role) ?? "Not mapped"
                      }
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
          {rowKeyWarning && (
            <p className="mt-2 rounded bg-red-50 px-3 py-2 text-xs text-red-800 ring-1 ring-red-200">
              {rowKeyWarning}
            </p>
          )}
          <details className="mt-4 rounded border border-zendesk-border bg-gray-50/80 px-3 py-2">
            <summary className="cursor-pointer text-xs font-semibold text-zendesk-navy">
              CRM field guide — where each role appears
            </summary>
            <ul className="mt-2 space-y-1.5 text-xs text-zendesk-muted">
              {COLUMN_ROLE_OPTIONS.filter((opt) => opt.value !== "unknown").map((opt) => (
                <li key={opt.value}>
                  <span className="font-medium text-zendesk-navy">{opt.label}</span>
                  {CRM_ROLE_DESTINATIONS[opt.value] ? (
                    <span> — {CRM_ROLE_DESTINATIONS[opt.value]}</span>
                  ) : null}
                </li>
              ))}
            </ul>
            <p className="mt-3 text-[11px] text-zendesk-muted">
              Built-in Internal tools sidebar (not sheet-mapped): Salesforce search (form header
              User ID by default), Linked cases, and Preferences → External tools shortcuts.
            </p>
          </details>
        </div>
      )}

      {analyzed && (
        <div className="mt-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="text-sm font-semibold">Column mapping</h3>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2">
            <div className="relative min-w-[14rem] max-w-sm flex-1">
              <Search className="absolute left-2 top-2 h-4 w-4 text-zendesk-muted" />
              <input
                type="search"
                value={columnSearch}
                onChange={(e) => setColumnSearch(e.target.value)}
                placeholder="Filter by letter, header, or role…"
                className="w-full rounded border border-zendesk-border py-1.5 pl-8 pr-3 text-sm outline-none focus:border-zendesk-green"
              />
            </div>
            <label className="flex items-center gap-2 text-xs text-zendesk-muted">
              <input
                type="checkbox"
                checked={showUnmappedOnly}
                onChange={(e) => setShowUnmappedOnly(e.target.checked)}
                className="rounded border-zendesk-border"
              />
              Show unmapped only
            </label>
            <label className="flex items-center gap-2 text-xs text-zendesk-muted">
              <input
                type="checkbox"
                checked={showHiddenColumns}
                onChange={(e) => setShowHiddenColumns(e.target.checked)}
                className="rounded border-zendesk-border"
              />
              Show hidden columns
            </label>
            <label className="flex items-center gap-2 text-xs text-zendesk-muted">
              <input
                type="checkbox"
                checked={showUnusedUiFields}
                onChange={(e) => setShowUnusedUiFields(e.target.checked)}
                className="rounded border-zendesk-border"
              />
              Show unused fields
            </label>
            <button
              type="button"
              onClick={restoreSheetHeaders}
              className="rounded border border-zendesk-border px-2.5 py-1 text-xs text-zendesk-muted hover:bg-gray-100 hover:text-zendesk-navy"
            >
              Restore sheet headers
            </button>
          </div>
              <p className="mt-2 text-xs text-zendesk-muted">
                <strong>Col</strong> is the column letter on <em>this</em> sheet.{" "}
                <strong>CRM field</strong> is where that column&apos;s value appears in SheetsCRM
                (ticket header, Details, Conversation, sidebar tools). Map each agent column
                independently — letters in the dropdown describe CRM destinations, not your sheet
                layout.
              </p>
          <div className={`mt-3 overflow-y-auto rounded border border-zendesk-border ${compact ? "max-h-[32vh]" : "max-h-[40vh]"}`}>
            <table className="w-full text-left text-sm">
              <thead className="sticky top-0 bg-gray-50 text-xs text-zendesk-muted">
                <tr className="border-b">
                      <th className="px-3 py-2">Col</th>
                      <th className="px-3 py-2">Sheet header / display label</th>
                      <th className="px-3 py-2">Maps to in CRM</th>
                  <th className="w-10 px-2 py-2" aria-label="Hide column" />
                </tr>
              </thead>
              <tbody>
                {visibleColumns.map((col) => (
                  <tr
                    key={col.index}
                    className={`border-b border-zendesk-border/60 ${
                      col.hidden
                        ? "bg-gray-100/80 opacity-75"
                        : col.role !== "unknown"
                          ? "bg-green-50/40"
                          : ""
                    }`}
                  >
                    <td className="px-3 py-2 font-mono text-xs">{col.letter}</td>
                    <td className="px-3 py-2">
                      <input
                        type="text"
                        value={col.header}
                        onChange={(e) => updateColumnHeader(col.index, e.target.value)}
                        disabled={col.hidden}
                        title={
                          col.sheetHeader && col.sheetHeader !== col.header
                            ? `Sheet header: ${col.sheetHeader}`
                            : undefined
                        }
                        className="w-full min-w-[8rem] rounded border border-zendesk-border px-2 py-1 text-xs disabled:opacity-50"
                      />
                    </td>
                    <td className="px-3 py-2">
                      <select
                        value={col.role}
                        onChange={(e) =>
                          updateRole(col.index, e.target.value as ColumnMapping["role"])
                        }
                        disabled={col.hidden}
                        className="w-full max-w-xs rounded border border-zendesk-border px-2 py-1 text-xs disabled:opacity-50"
                      >
                            {COLUMN_ROLE_OPTIONS.map((opt) => (
                              <option key={opt.value} value={opt.value} title={opt.hint}>
                                {opt.label}
                              </option>
                            ))}
                      </select>
                    </td>
                    <td className="px-2 py-2 text-center">
                      {col.hidden ? (
                        <button
                          type="button"
                          onClick={() => restoreColumn(col.index)}
                          title="Restore column"
                          aria-label={`Restore column ${col.letter}`}
                          className="rounded p-1 text-zendesk-muted hover:bg-gray-100 hover:text-zendesk-navy"
                        >
                          <RotateCcw className="h-3.5 w-3.5" />
                        </button>
                      ) : col.role === "unknown" ? (
                        <button
                          type="button"
                          onClick={() => hideColumn(col.index)}
                          title="Hide unmapped column"
                          aria-label={`Hide column ${col.letter}`}
                          className="rounded p-1 text-zendesk-muted hover:bg-red-50 hover:text-red-700"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {visibleColumns.length === 0 && (
              <p className="p-4 text-sm text-zendesk-muted">No columns match this filter.</p>
            )}
          </div>

          <div className="mt-5">
            <h4 className="text-sm font-semibold">Ticket header fields</h4>
            <p className="mt-1 text-xs text-zendesk-muted">
              Map extra editable fields under the ticket subject. Unused slots stay hidden unless
              &ldquo;Show unused fields&rdquo; is checked.
            </p>
            <div className="mt-2 overflow-hidden rounded border border-zendesk-border">
              <table className="w-full text-left text-sm">
                <thead className="bg-gray-50 text-xs text-zendesk-muted">
                  <tr className="border-b">
                    <th className="px-3 py-2">Slot</th>
                    <th className="px-3 py-2">Display label</th>
                    <th className="px-3 py-2">Sheet column</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleUiFieldSlots.map((slot, index) => (
                    <tr
                      key={slot.id}
                      className={`border-b border-zendesk-border/60 ${
                        slot.columnIndex == null ? "bg-gray-50/80" : "bg-green-50"
                      }`}
                    >
                      <td className="px-3 py-2 font-mono text-xs text-zendesk-muted">
                        {index + 1}
                      </td>
                      <td className="px-3 py-2">
                        <input
                          type="text"
                          value={slot.label}
                          onChange={(e) => updateUiSlotLabel(slot.id, e.target.value)}
                          className="w-full min-w-[8rem] rounded border border-zendesk-border px-2 py-1 text-xs"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <select
                          value={slot.columnIndex ?? ""}
                          onChange={(e) => {
                            const raw = e.target.value;
                            updateUiSlotColumn(
                              slot.id,
                              raw === "" ? null : Number(raw)
                            );
                          }}
                          className="w-full max-w-xs rounded border border-zendesk-border px-2 py-1 text-xs"
                        >
                          <option value="">— Unmapped —</option>
                          {analyzed.columns
                            .filter((col) => col.role !== "marketManager")
                            .map((col) => (
                              <option key={col.index} value={col.index}>
                                {col.letter}: {columnDisplayLabel(col, col.letter)}
                              </option>
                            ))}
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {visibleUiFieldSlots.length === 0 && (
                <p className="p-4 text-sm text-zendesk-muted">
                  No mapped header fields. Check &ldquo;Show unused fields&rdquo; to configure
                  slots.
                </p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Merge a fresh Analyze/Detect result onto an existing draft.
 *
 * Roles are matched by header text (not column index) so deleted/reordered
 * columns do not keep the old letter's role. Pass `forceRemapRoles: true` from
 * the Analyze button so header patterns always win over a prior manual map.
 */
export function mergeAnalyzedSheetConfig(
  existing: SheetConfig | null,
  fresh: SheetConfig,
  options?: { forceRemapRoles?: boolean }
): SheetConfig {
  const forceRemapRoles = options?.forceRemapRoles === true;
  const prevByHeader = new Map<string, NonNullable<SheetConfig["columns"]>[number]>();
  for (const col of existing?.columns ?? []) {
    const key = (col.sheetHeader || col.header || "").trim().toLowerCase();
    if (key) prevByHeader.set(key, col);
  }

  const mergedColumns = fresh.columns.map((col) => {
    const headerKey = (col.header || "").trim().toLowerCase();
    const prevSameHeader = headerKey ? prevByHeader.get(headerKey) : undefined;
    const prevSameIndex = existing?.columns.find((c) => c.index === col.index);
    const headerCustomized = Boolean(
      prevSameHeader?.sheetHeader &&
        prevSameHeader.header.trim() !== prevSameHeader.sheetHeader.trim()
    );

    // Analyze (force): always take roles from live headers.
    // Soft merge: keep a manual role only when the same header text still exists
    // (header may have moved to a new letter/index).
    let role = col.role;
    if (
      !forceRemapRoles &&
      existing?.manuallyMapped &&
      prevSameHeader &&
      prevSameHeader.role !== "unknown"
    ) {
      role = prevSameHeader.role;
    }

    return {
      ...col,
      sheetHeader: col.header,
      header: headerCustomized ? prevSameHeader!.header : col.header,
      role,
      hidden: prevSameHeader?.hidden ?? (role === "unknown" ? prevSameIndex?.hidden : false),
    };
  });

  const nextByHeader = new Map<string, (typeof mergedColumns)[number]>();
  for (const col of mergedColumns) {
    const key = (col.sheetHeader || col.header || "").trim().toLowerCase();
    if (key) nextByHeader.set(key, col);
  }

  const prevByIndex = new Map((existing?.columns ?? []).map((col) => [col.index, col]));
  const uiFieldSlots = (existing?.uiFieldSlots ?? fresh.uiFieldSlots)?.map((slot) => {
    if (slot.columnIndex == null) return slot;
    const prevCol = prevByIndex.get(slot.columnIndex);
    const key = (prevCol?.sheetHeader || prevCol?.header || "").trim().toLowerCase();
    if (!key) return { ...slot, columnIndex: null };
    const nextCol = nextByHeader.get(key);
    return nextCol ? { ...slot, columnIndex: nextCol.index } : { ...slot, columnIndex: null };
  });

  return {
    ...fresh,
    columns: mergedColumns,
    uiFieldSlots,
    emailSubjectPrefix: existing?.emailSubjectPrefix ?? fresh.emailSubjectPrefix,
    manuallyMapped: forceRemapRoles ? false : (existing?.manuallyMapped ?? false),
  };
}
