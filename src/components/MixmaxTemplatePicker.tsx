"use client";

import { useCallback, useEffect, useState } from "react";
import { Search } from "lucide-react";
import { stripHtmlToText } from "@/lib/html-utils";
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
}

export function MixmaxTemplatePicker({ templateContext, onApply }: MixmaxTemplatePickerProps) {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [templates, setTemplates] = useState<MixmaxTemplate[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    const delay = search.trim() ? 300 : 0;
    const timeout = setTimeout(() => loadTemplates(search), delay);
    return () => clearTimeout(timeout);
  }, [search, loadTemplates]);

  if (enabled === null) {
    return (
      <div className="mt-6 rounded border border-zendesk-border bg-white p-3">
        <p className="text-xs text-zendesk-muted">Loading Mixmax templates…</p>
      </div>
    );
  }

  if (!enabled) {
    return (
      <div className="mt-6 rounded border border-dashed border-zendesk-border bg-white p-3">
        <h3 className="text-xs font-semibold uppercase text-zendesk-muted">Mixmax templates</h3>
        <p className="mt-2 text-xs text-zendesk-muted">
          Add <code className="rounded bg-gray-100 px-1">MIXMAX_API_TOKEN</code> to{" "}
          <code className="rounded bg-gray-100 px-1">.env</code> (Mixmax Settings → Integrations) to
          browse templates here. Requires a Mixmax Growth+ plan.
        </p>
      </div>
    );
  }

  return (
    <div className="mt-6">
      <h3 className="text-xs font-semibold uppercase text-zendesk-muted">Mixmax templates</h3>
      <p className="mt-1 text-[10px] text-zendesk-muted">Your templates only</p>
      <div className="relative mt-2">
        <Search className="absolute left-2 top-2 h-3.5 w-3.5 text-zendesk-muted" />
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search your templates…"
          className="w-full rounded border border-zendesk-border py-1.5 pl-7 pr-2 text-xs outline-none focus:border-zendesk-green"
        />
      </div>
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
      <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto">
        {loading && <li className="text-xs text-zendesk-muted">Loading…</li>}
        {!loading && templates.length === 0 && (
          <li className="text-xs text-zendesk-muted">No templates found</li>
        )}
        {templates.map((template) => (
          <li key={template.id}>
            <button
              type="button"
              onClick={() => {
                const subject = resolveMixmaxVariables(template.title, templateContext);
                const body = resolveMixmaxVariables(
                  stripHtmlToText(template.source),
                  templateContext
                );
                onApply({ subject, body });
              }}
              className="w-full rounded border border-zendesk-border bg-white px-2 py-1.5 text-left text-xs hover:border-zendesk-green hover:bg-green-50/50"
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
        ))}
      </ul>
      <p className="mt-2 text-[10px] text-zendesk-muted">
        Fills {"{{first name}}"} and similar placeholders from the ticket name on the intake sheet.
        Use &quot;Open in Gmail&quot; for remaining Mixmax compose features.
      </p>
    </div>
  );
}
