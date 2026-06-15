"use client";

import { useEffect, useState } from "react";
import { ChevronDown, ChevronUp, Trash2 } from "lucide-react";
import {
  clearCrmDebugLog,
  getCrmDebugLogEntries,
  subscribeCrmDebugLog,
  type CrmLogEntry,
} from "@/lib/crm-debug-log";

interface CrmDebugLogPanelProps {
  enabled: boolean;
}

export function CrmDebugLogPanel({ enabled }: CrmDebugLogPanelProps) {
  const [expanded, setExpanded] = useState(false);
  const [entries, setEntries] = useState<CrmLogEntry[]>([]);

  useEffect(() => {
    if (!enabled) return;
    setEntries(getCrmDebugLogEntries());
    return subscribeCrmDebugLog(() => setEntries(getCrmDebugLogEntries()));
  }, [enabled]);

  if (!enabled) return null;

  return (
    <div className="border-t border-zendesk-border bg-gray-50">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center justify-between px-4 py-2 text-left text-xs font-medium text-zendesk-navy hover:bg-gray-100"
      >
        <span>CRM debug log ({entries.length})</span>
        <span className="flex items-center gap-2 text-zendesk-muted">
          {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronUp className="h-3.5 w-3.5" />}
        </span>
      </button>
      {expanded && (
        <div className="max-h-40 overflow-y-auto border-t border-zendesk-border px-4 py-2">
          <div className="mb-2 flex justify-end">
            <button
              type="button"
              onClick={() => clearCrmDebugLog()}
              className="inline-flex items-center gap-1 rounded px-2 py-1 text-[10px] text-zendesk-muted hover:bg-gray-100"
            >
              <Trash2 className="h-3 w-3" />
              Clear
            </button>
          </div>
          {entries.length === 0 ? (
            <p className="text-[11px] text-zendesk-muted">No entries yet. CRM actions will appear here.</p>
          ) : (
            <ul className="space-y-1">
              {entries.map((entry) => (
                <li key={entry.id} className="font-mono text-[10px] leading-snug">
                  <span
                    className={
                      entry.level === "error"
                        ? "text-red-700"
                        : entry.level === "warn"
                          ? "text-amber-800"
                          : "text-zendesk-muted"
                    }
                  >
                    {new Date(entry.at).toLocaleTimeString()}
                  </span>{" "}
                  <span className="text-zendesk-navy">{entry.message}</span>
                  {entry.durationMs != null && (
                    <span className="text-zendesk-muted"> ({entry.durationMs}ms)</span>
                  )}
                  {entry.detail && (
                    <span className="text-zendesk-muted"> — {entry.detail}</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
