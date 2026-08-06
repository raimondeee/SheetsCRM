"use client";

import { useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";
import type { CountItem } from "@/lib/dashboard-stats";
import {
  normalizeTeamStatusMappings,
  teamStatusMappingKey,
  type TeamStatusMappings,
} from "@/lib/team-dashboard-sources";
import { TEAM_STATUS_BUCKET_OPTIONS } from "@/lib/team-metrics";

const KEEP_AS_IS = "__keep__";
const CUSTOM_BUCKET = "__custom__";

interface TeamStatusMappingModalProps {
  open: boolean;
  onClose: () => void;
  rawStatuses: CountItem[];
  statusMappings: TeamStatusMappings;
  onSaved: (mappings: TeamStatusMappings) => void;
}

export function TeamStatusMappingModal({
  open,
  onClose,
  rawStatuses,
  statusMappings,
  onSaved,
}: TeamStatusMappingModalProps) {
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [customBuckets, setCustomBuckets] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const nextDraft: Record<string, string> = {};
    const nextCustom: Record<string, string> = {};
    for (const item of rawStatuses) {
      const key = teamStatusMappingKey(item.name);
      const mapped = statusMappings[key]?.trim();
      if (!mapped) {
        nextDraft[item.name] = KEEP_AS_IS;
        continue;
      }
      const isKnown = TEAM_STATUS_BUCKET_OPTIONS.some(
        (bucket) => bucket.toLowerCase() === mapped.toLowerCase()
      );
      if (isKnown) {
        const canonical =
          TEAM_STATUS_BUCKET_OPTIONS.find(
            (bucket) => bucket.toLowerCase() === mapped.toLowerCase()
          ) ?? mapped;
        nextDraft[item.name] = canonical;
      } else {
        nextDraft[item.name] = CUSTOM_BUCKET;
        nextCustom[item.name] = mapped;
      }
    }
    setDraft(nextDraft);
    setCustomBuckets(nextCustom);
    setError(null);
  }, [open, rawStatuses, statusMappings]);

  const bucketChoices = useMemo(() => {
    const extras = new Set<string>();
    for (const value of Object.values(statusMappings)) {
      const trimmed = value.trim();
      if (
        trimmed &&
        !TEAM_STATUS_BUCKET_OPTIONS.some((b) => b.toLowerCase() === trimmed.toLowerCase())
      ) {
        extras.add(trimmed);
      }
    }
    for (const value of Object.values(customBuckets)) {
      const trimmed = value.trim();
      if (
        trimmed &&
        !TEAM_STATUS_BUCKET_OPTIONS.some((b) => b.toLowerCase() === trimmed.toLowerCase())
      ) {
        extras.add(trimmed);
      }
    }
    return [...TEAM_STATUS_BUCKET_OPTIONS, ...[...extras].sort((a, b) => a.localeCompare(b))];
  }, [statusMappings, customBuckets]);

  if (!open) return null;

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      // Preserve mappings for statuses outside the current period/filters.
      const nextMappings: TeamStatusMappings = { ...statusMappings };
      for (const item of rawStatuses) {
        const choice = draft[item.name] ?? KEEP_AS_IS;
        const key = teamStatusMappingKey(item.name);
        if (choice === KEEP_AS_IS) {
          delete nextMappings[key];
          continue;
        }
        const bucket =
          choice === CUSTOM_BUCKET
            ? (customBuckets[item.name] ?? "").trim()
            : choice.trim();
        if (!bucket) {
          throw new Error(`Enter a bucket name for "${item.name}".`);
        }
        nextMappings[key] = bucket;
      }

      const resGet = await fetch("/api/dashboard/team-sources", {
        cache: "no-store",
        credentials: "same-origin",
      });
      const getData = await resGet.json();
      if (!resGet.ok) throw new Error(getData.error || "Failed to load team sources");

      const config = {
        ...getData.config,
        statusMappings: normalizeTeamStatusMappings(nextMappings),
      };

      const resPut = await fetch("/api/dashboard/team-sources", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ config }),
      });
      const putData = await resPut.json();
      if (!resPut.ok) throw new Error(putData.error || "Failed to save status mappings");

      onSaved(normalizeTeamStatusMappings(putData.config?.statusMappings ?? nextMappings));
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save status mappings");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="team-status-mapping-title"
        className="flex max-h-[85vh] w-full max-w-2xl flex-col rounded-lg border border-zendesk-border bg-white shadow-xl"
      >
        <div className="flex items-start justify-between gap-3 border-b border-zendesk-border px-4 py-3">
          <div>
            <h2
              id="team-status-mapping-title"
              className="text-sm font-semibold text-zendesk-navy"
            >
              Map case statuses
            </h2>
            <p className="mt-0.5 text-xs text-zendesk-muted">
              Roll regional spellings into shared buckets (e.g. Pending on MC → Pending).
              Saved with team dashboard sources on this machine.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-zendesk-muted hover:bg-gray-100 hover:text-zendesk-navy"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          {rawStatuses.length === 0 ? (
            <p className="text-sm text-zendesk-muted">
              No status values in the current period filters.
            </p>
          ) : (
            <table className="w-full text-left text-xs">
              <thead className="sticky top-0 bg-white text-[11px] uppercase tracking-wide text-zendesk-muted">
                <tr className="border-b border-zendesk-border">
                  <th className="py-2 pr-3 font-semibold">Sheet status</th>
                  <th className="py-2 pr-3 font-semibold">Count</th>
                  <th className="py-2 font-semibold">Bucket</th>
                </tr>
              </thead>
              <tbody>
                {rawStatuses.map((item) => {
                  const choice = draft[item.name] ?? KEEP_AS_IS;
                  return (
                    <tr key={item.name} className="border-b border-zendesk-border/60 align-top">
                      <td className="py-2 pr-3 font-medium text-zendesk-navy" title={item.name}>
                        <span className="line-clamp-2 break-all">{item.name}</span>
                      </td>
                      <td className="py-2 pr-3 tabular-nums text-zendesk-muted">
                        {item.value.toLocaleString()}
                      </td>
                      <td className="py-2">
                        <select
                          value={choice}
                          onChange={(e) => {
                            const value = e.target.value;
                            setDraft((prev) => ({ ...prev, [item.name]: value }));
                            if (value !== CUSTOM_BUCKET) {
                              setCustomBuckets((prev) => {
                                const next = { ...prev };
                                delete next[item.name];
                                return next;
                              });
                            }
                          }}
                          className="w-full rounded border border-zendesk-border bg-white px-2 py-1.5 text-xs text-zendesk-navy"
                        >
                          <option value={KEEP_AS_IS}>Keep as-is</option>
                          {bucketChoices.map((bucket) => (
                            <option key={bucket} value={bucket}>
                              {bucket}
                            </option>
                          ))}
                          <option value={CUSTOM_BUCKET}>Custom…</option>
                        </select>
                        {choice === CUSTOM_BUCKET ? (
                          <input
                            type="text"
                            value={customBuckets[item.name] ?? ""}
                            onChange={(e) =>
                              setCustomBuckets((prev) => ({
                                ...prev,
                                [item.name]: e.target.value,
                              }))
                            }
                            placeholder="Bucket name"
                            className="mt-1 w-full rounded border border-zendesk-border px-2 py-1.5 text-xs text-zendesk-navy"
                          />
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          {error ? <p className="mt-3 text-xs text-red-600">{error}</p> : null}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-zendesk-border px-4 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-zendesk-border px-3 py-1.5 text-xs font-medium text-zendesk-navy hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={saving || rawStatuses.length === 0}
            className="rounded bg-zendesk-navy px-3 py-1.5 text-xs font-medium text-white hover:bg-zendesk-navy/90 disabled:opacity-60"
          >
            {saving ? "Saving…" : "Save mappings"}
          </button>
        </div>
      </div>
    </div>
  );
}
