"use client";

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Link2, X } from "lucide-react";
import { parseLinkedCase, serializeLinkedCaseFields } from "@/lib/linked-cases";

interface LinkedCaseEditModalProps {
  slot: number;
  value: string;
  onSave: (value: string) => void | Promise<void>;
  onClose: () => void;
}

export function LinkedCaseEditModal({ slot, value, onSave, onClose }: LinkedCaseEditModalProps) {
  const parsed = parseLinkedCase(value);
  const [mounted, setMounted] = useState(false);
  const [label, setLabel] = useState(parsed.label);
  const [url, setUrl] = useState(parsed.url ?? "");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const save = useCallback(async () => {
    if (saving) return;
    const next = serializeLinkedCaseFields(label, url);
    if (next === value.trim()) {
      onClose();
      return;
    }
    setSaving(true);
    try {
      await onSave(next);
      onClose();
    } finally {
      setSaving(false);
    }
  }, [label, onClose, onSave, saving, url, value]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !saving) void save();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [save, saving]);

  if (!mounted) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/45 p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !saving) void save();
      }}
    >
      <div
        role="dialog"
        aria-labelledby="linked-case-edit-title"
        className="w-full max-w-md rounded-lg border border-zendesk-border bg-white shadow-xl"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-zendesk-border px-4 py-3">
          <div className="flex min-w-0 items-start gap-2">
            <Link2 className="mt-0.5 h-5 w-5 shrink-0 text-zendesk-teal" />
            <div>
              <h2 id="linked-case-edit-title" className="text-sm font-semibold text-zendesk-navy">
                Edit linked case {slot}
              </h2>
              <p className="mt-0.5 text-xs text-zendesk-muted">Name and URL for this shortcut.</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => void save()}
            disabled={saving}
            className="rounded p-1 text-zendesk-muted hover:bg-gray-100 disabled:opacity-50"
            aria-label="Close and save"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-3 px-4 py-4">
          <label className="block">
            <span className="text-xs font-medium text-zendesk-navy">Name</span>
            <input
              type="text"
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              placeholder="Safety"
              autoFocus
              disabled={saving}
              className="mt-1 w-full rounded border border-zendesk-border px-2.5 py-1.5 text-sm text-zendesk-navy outline-none focus:border-zendesk-green disabled:opacity-50"
            />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-zendesk-navy">URL</span>
            <input
              type="url"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder="https://…"
              disabled={saving}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !saving) void save();
              }}
              className="mt-1 w-full rounded border border-zendesk-border px-2.5 py-1.5 text-sm text-zendesk-navy outline-none focus:border-zendesk-green disabled:opacity-50"
            />
          </label>
        </div>

        <div className="flex justify-end border-t border-zendesk-border bg-gray-50/60 px-4 py-3">
          <button
            type="button"
            onClick={() => void save()}
            disabled={saving}
            className="rounded border border-zendesk-green bg-zendesk-green px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
