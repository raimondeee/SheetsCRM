"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  ArrowRightLeft,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  GripVertical,
  Paperclip,
  Search,
  Star,
  X,
} from "lucide-react";
import { prepareMixmaxTemplateHtml } from "@/lib/html-utils";
import {
  getCachedMixmaxTemplates,
  getStaleCachedMixmaxTemplates,
  setCachedMixmaxTemplates,
} from "@/lib/mixmax-templates-cache";
import {
  clearLegacyMixmaxStarredTemplateIds,
  loadLegacyMixmaxStarredTemplateIds,
  reorderMixmaxStarredTemplateIds,
  sortMixmaxTemplatesWithStarred,
  toggleMixmaxStarredTemplateId,
} from "@/lib/mixmax-starred";
import { resolveMixmaxVariables, type MixmaxTemplateContext } from "@/lib/mixmax-variables";
import { base64ToFile } from "@/lib/outbound-attachments";
import type { MixmaxSnippet } from "@/lib/mixmax";
import {
  fetchUserPreferences,
  saveMixmaxStarredTemplateIdsPreference,
} from "@/lib/user-preferences";

export type MixmaxTemplate = MixmaxSnippet;

export interface MixmaxTemplateApplyPayload {
  subject?: string;
  body?: string;
  attachmentFiles?: File[];
  attachmentWarning?: string | null;
  attachmentsLoading?: boolean;
}

interface MixmaxTemplatePickerProps {
  templateContext: MixmaxTemplateContext;
  onApply: (template: MixmaxTemplateApplyPayload) => void;
  onExpandedChange?: (expanded: boolean) => void;
}

const MIXMAX_DASHBOARD_URL = "https://app.mixmax.com/dashboard/live/all";

function SectionToggle({
  expanded,
  onToggle,
  children,
  collapseIcon = false,
  helpTourId,
}: {
  expanded: boolean;
  onToggle: () => void;
  children: ReactNode;
  collapseIcon?: boolean;
  helpTourId?: string;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="flex w-full items-start gap-1.5 text-left"
      aria-expanded={expanded}
      data-help-tour={helpTourId}
    >
      {collapseIcon ? (
        <ChevronDown className="mt-0.5 h-3.5 w-3.5 shrink-0 text-zendesk-muted" />
      ) : (
        <ChevronRight
          className={`mt-0.5 h-3.5 w-3.5 shrink-0 text-zendesk-muted transition-transform duration-200 ${
            expanded ? "rotate-90" : ""
          }`}
        />
      )}
      <span className="block text-xs font-semibold uppercase text-zendesk-muted">{children}</span>
    </button>
  );
}

export function MixmaxTemplatePicker({
  templateContext,
  onApply,
  onExpandedChange,
}: MixmaxTemplatePickerProps) {
  const initialCache = getCachedMixmaxTemplates("") ?? getStaleCachedMixmaxTemplates("");
  const [expanded, setExpanded] = useState(false);
  const [enabled, setEnabled] = useState<boolean | null>(() =>
    initialCache ? initialCache.enabled : null
  );
  const [templates, setTemplates] = useState<MixmaxTemplate[]>(
    () => initialCache?.templates ?? []
  );
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(() => initialCache?.error ?? null);
  const [applyingTemplateId, setApplyingTemplateId] = useState<string | null>(null);
  const [starredIds, setStarredIds] = useState<string[]>(() =>
    loadLegacyMixmaxStarredTemplateIds()
  );
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  const [reordering, setReordering] = useState(false);
  const starredPersistTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const starredIdsRef = useRef(starredIds);
  starredIdsRef.current = starredIds;

  const sortedTemplates = sortMixmaxTemplatesWithStarred(templates, starredIds);
  const starredIdSet = new Set(starredIds);

  function setExpandedState(open: boolean) {
    setExpanded(open);
    onExpandedChange?.(open);
    if (!open) {
      setReordering(false);
      setDraggingId(null);
      setDropTargetId(null);
    }
  }

  function toggleExpanded() {
    setExpandedState(!expanded);
  }

  function toggleReordering() {
    setReordering((prev) => {
      const next = !prev;
      if (!next) {
        setDraggingId(null);
        setDropTargetId(null);
      }
      return next;
    });
  }

  const persistStarredIds = useCallback((next: string[]) => {
    if (starredPersistTimer.current) clearTimeout(starredPersistTimer.current);
    starredPersistTimer.current = setTimeout(() => {
      void saveMixmaxStarredTemplateIdsPreference(next).catch(() => {
        /* keep local order; next successful save will sync */
      });
    }, 250);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const prefs = await fetchUserPreferences();
        if (cancelled) return;
        const fromDb = prefs.mixmaxStarredTemplateIds;
        const fromLegacy = loadLegacyMixmaxStarredTemplateIds();
        if (fromDb.length > 0) {
          setStarredIds(fromDb);
          clearLegacyMixmaxStarredTemplateIds();
          return;
        }
        if (fromLegacy.length > 0) {
          setStarredIds(fromLegacy);
          const saved = await saveMixmaxStarredTemplateIdsPreference(fromLegacy);
          if (!cancelled) {
            setStarredIds(saved);
            clearLegacyMixmaxStarredTemplateIds();
          }
        }
      } catch {
        /* keep any legacy localStorage stars already loaded */
      }
    })();
    return () => {
      cancelled = true;
      if (starredPersistTimer.current) clearTimeout(starredPersistTimer.current);
    };
  }, []);

  function updateStarredIds(next: string[]) {
    setStarredIds(next);
    persistStarredIds(next);
  }

  function toggleStarred(templateId: string, event: React.MouseEvent) {
    event.stopPropagation();
    event.preventDefault();
    updateStarredIds(toggleMixmaxStarredTemplateId(starredIdsRef.current, templateId));
  }

  function handleStarredDragStart(templateId: string, event: React.DragEvent) {
    if (!reordering) {
      event.preventDefault();
      return;
    }
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", templateId);
    setDraggingId(templateId);
  }

  function handleStarredDragOver(templateId: string, event: React.DragEvent) {
    if (!reordering) return;
    if (!draggingId || draggingId === templateId) return;
    if (!starredIdSet.has(templateId)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    if (dropTargetId !== templateId) setDropTargetId(templateId);
  }

  function handleStarredDrop(templateId: string, event: React.DragEvent) {
    event.preventDefault();
    if (!reordering) {
      setDraggingId(null);
      setDropTargetId(null);
      return;
    }
    const fromId = event.dataTransfer.getData("text/plain") || draggingId;
    if (!fromId || !starredIdSet.has(templateId)) {
      setDraggingId(null);
      setDropTargetId(null);
      return;
    }
    updateStarredIds(
      reorderMixmaxStarredTemplateIds(starredIdsRef.current, fromId, templateId)
    );
    setDraggingId(null);
    setDropTargetId(null);
  }

  function handleStarredDragEnd() {
    setDraggingId(null);
    setDropTargetId(null);
  }

  const loadTemplates = useCallback(async (query?: string, options?: { force?: boolean }) => {
    const searchQuery = query ?? "";
    const fresh = getCachedMixmaxTemplates(searchQuery);
    if (fresh && !options?.force) {
      setEnabled(fresh.enabled);
      setTemplates(fresh.templates);
      setError(fresh.error);
      setLoading(false);
      return;
    }

    const stale = getStaleCachedMixmaxTemplates(searchQuery);
    if (stale) {
      setEnabled(stale.enabled);
      setTemplates(stale.templates);
      setError(stale.error);
      // Soft refresh in background — keep showing cached rows.
      setLoading(false);
    } else {
      setLoading(true);
    }

    setError(null);
    try {
      const params = new URLSearchParams();
      if (searchQuery.trim()) params.set("search", searchQuery.trim());
      const res = await fetch(`/api/mixmax/templates?${params.toString()}`, {
        cache: "no-store",
      });
      const data = await res.json();
      const nextEnabled = Boolean(data.enabled);
      const nextTemplates = (data.templates ?? []) as MixmaxTemplate[];
      const nextError = typeof data.error === "string" ? data.error : null;

      // Don't cache failures — Mixmax auth/plan errors are often transient and
      // sticky error cache made this morning's "not authorized" linger.
      if (!res.ok || nextError) {
        setEnabled(nextEnabled);
        if (stale?.templates.length) {
          setTemplates(stale.templates);
        } else {
          setTemplates(nextTemplates);
        }
        setError(nextError || "Could not load templates");
        return;
      }

      setEnabled(nextEnabled);
      setTemplates(nextTemplates);
      setError(null);
      setCachedMixmaxTemplates(searchQuery, {
        enabled: nextEnabled,
        templates: nextTemplates,
        error: null,
      });
    } catch {
      if (!stale) {
        setError("Could not load templates");
        setEnabled(false);
      } else if (!stale.error) {
        // Keep last good list; show a soft warning.
        setError("Could not refresh templates (showing last loaded list)");
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!expanded) return;
    const delay = search.trim() ? 300 : 0;
    const timeout = setTimeout(() => {
      void loadTemplates(search);
    }, delay);
    return () => clearTimeout(timeout);
  }, [search, loadTemplates, expanded]);

  useEffect(() => {
    if (!expanded) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setExpanded(false);
        onExpandedChange?.(false);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [expanded, onExpandedChange]);

  async function applyTemplate(template: MixmaxTemplate) {
    setApplyingTemplateId(template.id);
    setError(null);

    const subject = resolveMixmaxVariables(template.title, templateContext);
    const body = resolveMixmaxVariables(
      prepareMixmaxTemplateHtml(template.source),
      templateContext
    );
    const hasAttachments = template.attachments.length > 0;

    onApply({
      subject,
      body,
      attachmentsLoading: hasAttachments,
    });
    setExpandedState(false);
    setApplyingTemplateId(null);

    if (!hasAttachments) return;

    try {
      const res = await fetch(
        `/api/mixmax/templates/${encodeURIComponent(template.id)}/attachments`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          cache: "no-store",
          body: JSON.stringify({
            to: templateContext.email,
            subject,
            body,
          }),
        }
      );
      const data = (await res.json()) as {
        attachments?: Array<{ filename: string; mimeType: string; data: string }>;
        error?: string;
      };
      if (!res.ok) {
        throw new Error(data.error || "Could not load template attachments");
      }
      const attachmentFiles = (data.attachments ?? []).map((attachment) =>
        base64ToFile(attachment.filename, attachment.mimeType, attachment.data)
      );
      onApply({
        attachmentFiles,
        attachmentsLoading: false,
      });
    } catch (attachmentError) {
      onApply({
        attachmentWarning:
          attachmentError instanceof Error
            ? attachmentError.message
            : "Could not import template attachments",
        attachmentsLoading: false,
      });
    }
  }

  const collapsedBarClass =
    "shrink-0 border-t border-zendesk-border bg-zendesk-sidebar p-3";

  function renderExpandedBody(content: ReactNode) {
    return (
      <>
        {expanded && (
          <div
            className="absolute inset-x-0 bottom-0 top-0 z-20 flex min-h-0 flex-col border-t border-zendesk-border bg-white shadow-xl"
            role="dialog"
            aria-label="Mixmax templates"
          >
            <div className="flex shrink-0 items-center gap-2 border-b border-zendesk-border px-3 py-2.5">
              <button
                type="button"
                onClick={() => setExpandedState(false)}
                className="flex min-w-0 flex-1 items-start gap-1.5 text-left"
                aria-label="Collapse Mixmax templates"
                data-help-tour="mixmax"
              >
                <ChevronDown className="mt-0.5 h-3.5 w-3.5 shrink-0 text-zendesk-muted" />
                <span className="block text-xs font-semibold uppercase text-zendesk-muted">
                  Mixmax templates
                </span>
              </button>
              <button
                type="button"
                onClick={() => setExpandedState(false)}
                className="shrink-0 rounded border border-zendesk-border p-1.5 text-zendesk-muted hover:bg-gray-100 hover:text-zendesk-navy"
                aria-label="Close Mixmax templates"
                title="Collapse (Esc)"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden p-3 pt-2">{content}</div>
            <div className="shrink-0 space-y-2 border-t border-zendesk-border bg-gray-50 px-3 py-2">
              <a
                href={MIXMAX_DASHBOARD_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center gap-1 text-xs font-medium text-blue-600 hover:underline"
              >
                Open Mixmax
                <ExternalLink className="h-3 w-3 shrink-0" />
              </a>
              <button
                type="button"
                onClick={() => setExpandedState(false)}
                className="w-full rounded border border-zendesk-border bg-white px-2 py-1.5 text-xs font-medium text-zendesk-navy hover:bg-gray-100"
              >
                Collapse templates
              </button>
            </div>
          </div>
        )}
        {!expanded && (
          <div className={collapsedBarClass}>
            <SectionToggle
              expanded={expanded}
              onToggle={toggleExpanded}
              helpTourId="mixmax"
            >
              Mixmax templates
            </SectionToggle>
          </div>
        )}
      </>
    );
  }

  if (enabled === null) {
    return (
      <>
        {expanded && (
          <div className="absolute inset-x-0 bottom-0 top-0 z-20 flex flex-col border-t border-zendesk-border bg-white p-4 shadow-xl">
            <SectionToggle
              expanded
              collapseIcon
              onToggle={() => setExpandedState(false)}
              helpTourId="mixmax"
            >
              Mixmax templates
            </SectionToggle>
            <p className="mt-2 pl-5 text-xs text-zendesk-muted">Loading Mixmax templates…</p>
          </div>
        )}
        {!expanded && (
          <div className={collapsedBarClass}>
            <SectionToggle
              expanded={expanded}
              onToggle={toggleExpanded}
              helpTourId="mixmax"
            >
              Mixmax templates
            </SectionToggle>
          </div>
        )}
      </>
    );
  }

  if (!enabled) {
    return renderExpandedBody(
      <p className="text-xs text-zendesk-muted">
        Add <code className="rounded bg-gray-100 px-1">MIXMAX_API_TOKEN</code> to{" "}
        <code className="rounded bg-gray-100 px-1">.env</code> (Mixmax Settings → Integrations) to
        browse templates here. Requires a Mixmax Growth+ plan.
      </p>
    );
  }

  return renderExpandedBody(
    <>
      <div className="flex items-center justify-between gap-2">
        <p className="text-[10px] text-zendesk-muted">Your templates only</p>
        <button
          type="button"
          onClick={toggleReordering}
          disabled={starredIds.length < 2}
          className={`inline-flex shrink-0 items-center gap-1 rounded border px-2 py-1 text-[10px] font-medium disabled:cursor-not-allowed disabled:opacity-50 ${
            reordering
              ? "border-amber-300 bg-amber-50 text-amber-950"
              : "border-zendesk-border bg-white text-zendesk-navy hover:bg-gray-50"
          }`}
          title={
            starredIds.length < 2
              ? "Star at least two templates to reorder"
              : reordering
                ? "Finish reordering"
                : "Show drag handles to reorder starred templates"
          }
        >
          <ArrowRightLeft className="h-3 w-3" />
          {reordering ? "Done" : "Reorder"}
        </button>
      </div>
      {reordering && (
        <p className="mt-1 text-[10px] text-amber-900">
          Drag starred templates by the handle to change their order.
        </p>
      )}
      <div className="relative mt-2 shrink-0">
        <Search className="absolute left-2 top-2 h-3.5 w-3.5 text-zendesk-muted" />
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search your templates…"
          className="w-full rounded border border-zendesk-border py-1.5 pl-7 pr-2 text-xs outline-none focus:border-zendesk-green"
        />
      </div>
      {error && <p className="mt-2 shrink-0 text-xs text-red-600">{error}</p>}
      <ul className="mt-2 min-h-0 flex-1 space-y-1 overflow-y-auto">
        {loading && <li className="text-xs text-zendesk-muted">Loading…</li>}
        {!loading && templates.length === 0 && (
          <li className="text-xs text-zendesk-muted">No templates found</li>
        )}
        {sortedTemplates.map((template) => {
          const starred = starredIdSet.has(template.id);
          const applying = applyingTemplateId === template.id;
          const attachmentCount = template.attachments.length;
          const isDragging = reordering && draggingId === template.id;
          const isDropTarget =
            reordering && dropTargetId === template.id && draggingId !== template.id;
          const showDragHandle = reordering && starred;
          return (
            <li
              key={template.id}
              onDragOver={
                showDragHandle ? (e) => handleStarredDragOver(template.id, e) : undefined
              }
              onDrop={showDragHandle ? (e) => handleStarredDrop(template.id, e) : undefined}
              onDragEnd={showDragHandle ? handleStarredDragEnd : undefined}
              className={`flex gap-1 rounded transition-colors ${
                isDragging ? "opacity-50" : ""
              } ${isDropTarget ? "ring-1 ring-amber-400 ring-offset-1" : ""}`}
            >
              {showDragHandle ? (
                <button
                  type="button"
                  draggable
                  onDragStart={(e) => handleStarredDragStart(template.id, e)}
                  onClick={(e) => e.preventDefault()}
                  className="flex shrink-0 cursor-grab items-center self-stretch rounded border border-transparent px-0.5 text-zendesk-muted active:cursor-grabbing"
                  title="Drag to reorder"
                  aria-label={`Reorder ${template.name}`}
                >
                  <GripVertical className="h-3.5 w-3.5" />
                </button>
              ) : null}
              <button
                type="button"
                title={starred ? "Unstar template" : "Star template"}
                aria-label={starred ? "Unstar template" : "Star template"}
                onClick={(e) => toggleStarred(template.id, e)}
                className={`shrink-0 rounded border border-zendesk-border px-1.5 py-1.5 transition-colors hover:border-amber-300 hover:bg-amber-50 ${
                  starred
                    ? "border-amber-300 bg-amber-50 text-amber-500"
                    : "bg-white text-zendesk-muted"
                }`}
              >
                <Star className="h-3.5 w-3.5" fill={starred ? "currentColor" : "none"} />
              </button>
              <button
                type="button"
                disabled={applyingTemplateId !== null}
                onClick={() => void applyTemplate(template)}
                className="min-w-0 flex-1 rounded border border-zendesk-border bg-white px-2 py-1.5 text-left text-xs text-zendesk-text hover:border-zendesk-green hover:bg-green-50 disabled:cursor-wait disabled:opacity-60"
              >
                <span className="block font-medium leading-tight">
                  {applying ? "Applying…" : template.name}
                </span>
                {template.title && template.title !== template.name && (
                  <span className="mt-0.5 block truncate text-[10px] text-zendesk-muted">
                    Subject: {template.title}
                  </span>
                )}
                {template.customShortcut && (
                  <span className="mt-0.5 block text-[10px] text-zendesk-muted">
                    /{template.customShortcut}
                  </span>
                )}
                {attachmentCount > 0 && (
                  <span className="mt-1 inline-flex items-center gap-1 rounded-full border border-amber-300 bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-900">
                    <Paperclip className="h-3 w-3 shrink-0" aria-hidden />
                    {attachmentCount} attachment{attachmentCount === 1 ? "" : "s"}
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </>
  );
}
