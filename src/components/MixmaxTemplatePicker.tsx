"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight, ExternalLink, Search, Star, X } from "lucide-react";
import { prepareMixmaxTemplateHtml } from "@/lib/html-utils";
import {
  loadMixmaxStarredTemplateIds,
  saveMixmaxStarredTemplateIds,
  sortMixmaxTemplatesWithStarred,
} from "@/lib/mixmax-starred";
import { resolveMixmaxVariables, type MixmaxTemplateContext } from "@/lib/mixmax-variables";

export interface MixmaxTemplate {
  id: string;
  name: string;
  title: string;
  source: string;
  customShortcut?: string;
}

interface MixmaxTemplatePickerProps {
  templateContext: MixmaxTemplateContext;
  onApply: (template: { subject: string; body: string }) => void;
  onExpandedChange?: (expanded: boolean) => void;
}

const MIXMAX_DASHBOARD_URL = "https://app.mixmax.com/dashboard/live/all";

function SectionToggle({
  expanded,
  onToggle,
  children,
  collapseIcon = false,
}: {
  expanded: boolean;
  onToggle: () => void;
  children: ReactNode;
  collapseIcon?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="flex w-full items-start gap-1.5 text-left"
      aria-expanded={expanded}
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
  const [expanded, setExpanded] = useState(false);
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [templates, setTemplates] = useState<MixmaxTemplate[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [starredIds, setStarredIds] = useState<Set<string>>(() => loadMixmaxStarredTemplateIds());

  const sortedTemplates = sortMixmaxTemplatesWithStarred(templates, starredIds);

  function setExpandedState(open: boolean) {
    setExpanded(open);
    onExpandedChange?.(open);
  }

  function toggleExpanded() {
    setExpandedState(!expanded);
  }

  function toggleStarred(templateId: string, event: React.MouseEvent) {
    event.stopPropagation();
    event.preventDefault();
    setStarredIds((prev) => {
      const next = new Set(prev);
      if (next.has(templateId)) next.delete(templateId);
      else next.add(templateId);
      saveMixmaxStarredTemplateIds(next);
      return next;
    });
  }

  const loadTemplates = useCallback(async (query?: string) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (query?.trim()) params.set("search", query.trim());
      const res = await fetch(`/api/mixmax/templates?${params.toString()}`, {
        cache: "no-store",
      });
      const data = await res.json();
      setEnabled(Boolean(data.enabled));
      setTemplates(data.templates ?? []);
      if (data.error) setError(data.error);
    } catch {
      setError("Could not load templates");
      setEnabled(false);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!expanded) return;
    const delay = search.trim() ? 300 : 0;
    const timeout = setTimeout(() => loadTemplates(search), delay);
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
            <SectionToggle expanded={expanded} onToggle={toggleExpanded}>
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
            <SectionToggle expanded collapseIcon onToggle={() => setExpandedState(false)}>
              Mixmax templates
            </SectionToggle>
            <p className="mt-2 pl-5 text-xs text-zendesk-muted">Loading Mixmax templates…</p>
          </div>
        )}
        {!expanded && (
          <div className={collapsedBarClass}>
            <SectionToggle expanded={expanded} onToggle={toggleExpanded}>
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
      <p className="text-[10px] text-zendesk-muted">Your templates only</p>
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
          const starred = starredIds.has(template.id);
          return (
            <li key={template.id} className="flex gap-1">
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
                onClick={() => {
                  const subject = resolveMixmaxVariables(template.title, templateContext);
                  const body = resolveMixmaxVariables(
                    prepareMixmaxTemplateHtml(template.source),
                    templateContext
                  );
                  onApply({ subject, body });
                }}
                className="min-w-0 flex-1 rounded border border-zendesk-border bg-white px-2 py-1.5 text-left text-xs hover:border-zendesk-green hover:bg-green-50"
              >
                <span className="block font-medium leading-tight">{template.name}</span>
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
              </button>
            </li>
          );
        })}
      </ul>
    </>
  );
}
