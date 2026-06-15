"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Eye, EyeOff, Lock, RefreshCw } from "lucide-react";

interface EnvFieldStatus {
  key: string;
  label: string;
  description: string;
  secret: boolean;
  type: "text" | "url" | "number" | "boolean" | "textarea";
  group: string;
  placeholder?: string;
  isSet: boolean;
  displayValue: string | null;
}

export function EnvSettingsPanel() {
  const [fields, setFields] = useState<EnvFieldStatus[]>([]);
  const [groups, setGroups] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [restartNote, setRestartNote] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  const [savingKey, setSavingKey] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/env");
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to load environment settings");
        return;
      }
      setFields(data.fields ?? []);
      setGroups(data.groups ?? []);
      setRestartNote(data.restartRequired ?? null);
    } catch {
      setError("Failed to load environment settings");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const fieldsByGroup = useMemo(() => {
    const map = new Map<string, EnvFieldStatus[]>();
    for (const group of groups) map.set(group, []);
    for (const field of fields) {
      const list = map.get(field.group) ?? [];
      list.push(field);
      map.set(field.group, list);
    }
    return map;
  }, [fields, groups]);

  async function saveField(field: EnvFieldStatus) {
    const value = drafts[field.key];
    if (value === undefined) return;

    setSavingKey(field.key);
    setError(null);
    try {
      const res = await fetch("/api/env", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ updates: { [field.key]: value } }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to save");
        return;
      }
      setFields(data.fields ?? []);
      setRestartNote(data.restartRequired ?? null);
      setDrafts((prev) => {
        const next = { ...prev };
        delete next[field.key];
        return next;
      });
      setRevealed((prev) => ({ ...prev, [field.key]: false }));
    } catch {
      setError("Failed to save");
    } finally {
      setSavingKey(null);
    }
  }

  async function clearField(field: EnvFieldStatus) {
    setSavingKey(field.key);
    setError(null);
    try {
      const res = await fetch("/api/env", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ updates: { [field.key]: "" } }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to clear");
        return;
      }
      setFields(data.fields ?? []);
      setDrafts((prev) => {
        const next = { ...prev };
        delete next[field.key];
        return next;
      });
    } catch {
      setError("Failed to clear");
    } finally {
      setSavingKey(null);
    }
  }

  if (loading) {
    return <p className="text-sm text-zendesk-muted">Loading environment settings…</p>;
  }

  if (error && fields.length === 0) {
    return (
      <div className="rounded border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
        {error}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="rounded border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
        <p className="font-medium">Local machine only</p>
        <p className="mt-1 text-amber-900/90">
          Values are saved to <code className="rounded bg-white/70 px-1">.env</code> in this project
          folder. Secrets are never shown again after save — only a masked preview.
        </p>
        {restartNote && <p className="mt-2 text-xs text-amber-800">{restartNote}</p>}
      </div>

      {error && (
        <p className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </p>
      )}

      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => void load()}
          className="flex items-center gap-1.5 rounded border border-zendesk-border px-3 py-1.5 text-xs text-zendesk-muted hover:bg-gray-100"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          Refresh status
        </button>
      </div>

      {groups.map((group) => {
        const groupFields = fieldsByGroup.get(group) ?? [];
        if (groupFields.length === 0) return null;

        return (
          <section key={group}>
            <h3 className="text-sm font-semibold text-gray-900">{group}</h3>
            <div className="mt-3 space-y-4">
              {groupFields.map((field) => {
                const editing = field.key in drafts;
                const isSaving = savingKey === field.key;

                return (
                  <div
                    key={field.key}
                    className="rounded-lg border border-zendesk-border bg-gray-50/50 p-4"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <p className="text-sm font-medium">{field.label}</p>
                        <p className="mt-0.5 text-xs text-zendesk-muted">{field.description}</p>
                        <p className="mt-1 font-mono text-[10px] text-zendesk-muted">{field.key}</p>
                      </div>
                      <span
                        className={`rounded px-2 py-0.5 text-[10px] font-semibold ${
                          field.isSet
                            ? "bg-green-100 text-green-800"
                            : "bg-gray-100 text-gray-600"
                        }`}
                      >
                        {field.isSet ? "Configured" : "Not set"}
                      </span>
                    </div>

                    {field.isSet && field.displayValue && !editing && (
                      <div className="mt-3 flex items-center gap-2 text-sm">
                        <Lock className="h-3.5 w-3.5 shrink-0 text-zendesk-muted" />
                        <code className="rounded bg-white px-2 py-1 text-xs text-gray-700">
                          {field.displayValue}
                        </code>
                        {field.secret && (
                          <span className="text-[10px] text-zendesk-muted">(masked)</span>
                        )}
                      </div>
                    )}

                    <div className="mt-3 flex flex-wrap items-end gap-2">
                      {field.type === "boolean" ? (
                        <select
                          value={drafts[field.key] ?? (field.isSet ? field.displayValue ?? "" : "")}
                          onChange={(e) =>
                            setDrafts((prev) => ({ ...prev, [field.key]: e.target.value }))
                          }
                          className="rounded border border-zendesk-border bg-white px-3 py-2 text-sm"
                        >
                          <option value="">—</option>
                          <option value="true">true</option>
                          <option value="false">false</option>
                        </select>
                      ) : field.type === "textarea" ? (
                        <textarea
                          value={drafts[field.key] ?? ""}
                          onChange={(e) =>
                            setDrafts((prev) => ({ ...prev, [field.key]: e.target.value }))
                          }
                          placeholder={
                            field.isSet
                              ? "Enter a new value to replace the saved key"
                              : field.placeholder ?? "Paste value…"
                          }
                          rows={4}
                          className="min-w-[min(100%,28rem)] flex-1 rounded border border-zendesk-border bg-white px-3 py-2 font-mono text-xs"
                        />
                      ) : (
                        <div className="relative min-w-[min(100%,20rem)] flex-1">
                          <input
                            type={
                              field.secret && !revealed[field.key] ? "password" : field.type === "number" ? "number" : "text"
                            }
                            value={drafts[field.key] ?? ""}
                            onChange={(e) =>
                              setDrafts((prev) => ({ ...prev, [field.key]: e.target.value }))
                            }
                            placeholder={
                              field.isSet
                                ? "Enter a new value to replace"
                                : field.placeholder ?? "Enter value…"
                            }
                            className="w-full rounded border border-zendesk-border bg-white px-3 py-2 pr-9 text-sm"
                          />
                          {field.secret && (
                            <button
                              type="button"
                              onClick={() =>
                                setRevealed((prev) => ({
                                  ...prev,
                                  [field.key]: !prev[field.key],
                                }))
                              }
                              className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-zendesk-muted hover:bg-gray-100"
                              title={revealed[field.key] ? "Hide while typing" : "Show while typing"}
                            >
                              {revealed[field.key] ? (
                                <EyeOff className="h-4 w-4" />
                              ) : (
                                <Eye className="h-4 w-4" />
                              )}
                            </button>
                          )}
                        </div>
                      )}

                      <button
                        type="button"
                        onClick={() => void saveField(field)}
                        disabled={isSaving || drafts[field.key] === undefined}
                        className="rounded bg-zendesk-green px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                      >
                        {isSaving ? "Saving…" : "Save"}
                      </button>
                      {field.isSet && (
                        <button
                          type="button"
                          onClick={() => void clearField(field)}
                          disabled={isSaving}
                          className="rounded border border-zendesk-border bg-white px-3 py-2 text-sm text-zendesk-muted hover:bg-gray-100 disabled:opacity-50"
                        >
                          Clear
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}
