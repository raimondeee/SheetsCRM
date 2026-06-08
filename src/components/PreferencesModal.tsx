"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { DEFAULT_STATUSES } from "@/lib/types";
import {
  DEFAULT_USER_PREFERENCES,
  type UserPreferences,
  saveUserPreferences,
} from "@/lib/user-preferences";

interface PreferencesModalProps {
  preferences: UserPreferences;
  onClose: () => void;
  onSaved: (prefs: UserPreferences) => void;
}

export function PreferencesModal({ preferences, onClose, onSaved }: PreferencesModalProps) {
  const [defaultView, setDefaultView] = useState(preferences.defaultStatusFilter);
  const [sortOrder, setSortOrder] = useState(preferences.sortOrder);

  function handleSave() {
    const prefs: UserPreferences = {
      defaultStatusFilter: defaultView,
      sortOrder,
    };
    saveUserPreferences(prefs);
    onSaved(prefs);
  }

  function handleReset() {
    setDefaultView(DEFAULT_USER_PREFERENCES.defaultStatusFilter);
    setSortOrder(DEFAULT_USER_PREFERENCES.sortOrder);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-lg bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-zendesk-border px-6 py-4">
          <div>
            <h2 className="text-lg font-semibold">View preferences</h2>
            <p className="text-sm text-zendesk-muted">Saved in this browser for your account.</p>
          </div>
          <button type="button" onClick={onClose} className="rounded p-1 hover:bg-gray-100">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-5 px-6 py-4">
          <label className="block text-sm">
            <span className="font-medium">Default folder / view</span>
            <p className="mt-0.5 text-xs text-zendesk-muted">
              Which view opens when you load the CRM
            </p>
            <select
              value={defaultView}
              onChange={(e) => setDefaultView(e.target.value)}
              className="mt-2 w-full rounded border border-zendesk-border px-3 py-2 text-sm"
            >
              <option value="all">All tickets</option>
              {DEFAULT_STATUSES.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>

          <fieldset className="text-sm">
            <legend className="font-medium">Default sort order</legend>
            <p className="mt-0.5 text-xs text-zendesk-muted">
              By last response time (you can toggle this in the ticket list anytime)
            </p>
            <div className="mt-2 flex gap-4">
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  name="sortOrder"
                  checked={sortOrder === "desc"}
                  onChange={() => setSortOrder("desc")}
                />
                Newest first
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  name="sortOrder"
                  checked={sortOrder === "asc"}
                  onChange={() => setSortOrder("asc")}
                />
                Oldest first
              </label>
            </div>
          </fieldset>
        </div>

        <div className="flex justify-between border-t border-zendesk-border px-6 py-4">
          <button
            type="button"
            onClick={handleReset}
            className="rounded px-3 py-2 text-sm text-zendesk-muted hover:bg-gray-100"
          >
            Reset defaults
          </button>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded px-4 py-2 text-sm hover:bg-gray-100"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              className="rounded bg-zendesk-green px-4 py-2 text-sm font-medium text-white"
            >
              Save preferences
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
