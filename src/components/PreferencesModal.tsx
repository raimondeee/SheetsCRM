"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { DASHBOARD_PERIOD_OPTIONS } from "@/lib/dashboard-period";
import { SLA_HOUR_OPTIONS } from "@/lib/timer-settings";
import { DEFAULT_STATUSES } from "@/lib/types";
import {
  EXTERNAL_TOOL_SLOT_COUNT,
  type ExternalToolLink,
} from "@/lib/external-tools";
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
  const [sortBy, setSortBy] = useState(preferences.sortBy);
  const [sortOrder, setSortOrder] = useState(preferences.sortOrder);
  const [dashboardPeriod, setDashboardPeriod] = useState(preferences.dashboardPeriod);
  const [errorLoggingEnabled, setErrorLoggingEnabled] = useState(preferences.errorLoggingEnabled);
  const [pendingReopenBusinessHours, setPendingReopenBusinessHours] = useState(
    preferences.pendingReopenBusinessHours
  );
  const [longtermHoldReopenDays, setLongtermHoldReopenDays] = useState(
    preferences.longtermHoldReopenDays
  );
  const [initialResponseHours, setInitialResponseHours] = useState(
    preferences.initialResponseHours
  );
  const [defaultSlaHours, setDefaultSlaHours] = useState(preferences.defaultSlaHours);
  const [resolvedGmailLinkArchiveDays, setResolvedGmailLinkArchiveDays] = useState(
    preferences.resolvedGmailLinkArchiveDays
  );
  const [externalTools, setExternalTools] = useState<ExternalToolLink[]>(preferences.externalTools);
  const [calendarReminderFullscreen, setCalendarReminderFullscreen] = useState(
    preferences.calendarReminderFullscreen
  );
  const [unreadInboxBindToSelectedEnabled, setUnreadInboxBindToSelectedEnabled] = useState(
    preferences.unreadInboxBindToSelectedEnabled
  );
  const [unreadInboxAppendToSelectedEnabled, setUnreadInboxAppendToSelectedEnabled] = useState(
    preferences.unreadInboxAppendToSelectedEnabled
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    const prefs: UserPreferences = {
      defaultStatusFilter: defaultView,
      sortBy,
      sortOrder,
      dashboardPeriod,
      errorLoggingEnabled,
      pendingReopenBusinessHours,
      longtermHoldReopenDays,
      initialResponseHours,
      defaultSlaHours,
      resolvedGmailLinkArchiveDays,
      externalTools,
      calendarReminderFullscreen,
      unreadInboxBindToSelectedEnabled,
      unreadInboxAppendToSelectedEnabled,
    };
    setSaving(true);
    setError(null);
    try {
      const saved = await saveUserPreferences(prefs);
      onSaved(saved);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save preferences");
    } finally {
      setSaving(false);
    }
  }

  function handleReset() {
    setDefaultView(DEFAULT_USER_PREFERENCES.defaultStatusFilter);
    setSortBy(DEFAULT_USER_PREFERENCES.sortBy);
    setSortOrder(DEFAULT_USER_PREFERENCES.sortOrder);
    setDashboardPeriod(DEFAULT_USER_PREFERENCES.dashboardPeriod);
    setErrorLoggingEnabled(DEFAULT_USER_PREFERENCES.errorLoggingEnabled);
    setPendingReopenBusinessHours(DEFAULT_USER_PREFERENCES.pendingReopenBusinessHours);
    setLongtermHoldReopenDays(DEFAULT_USER_PREFERENCES.longtermHoldReopenDays);
    setInitialResponseHours(DEFAULT_USER_PREFERENCES.initialResponseHours);
    setDefaultSlaHours(DEFAULT_USER_PREFERENCES.defaultSlaHours);
    setResolvedGmailLinkArchiveDays(DEFAULT_USER_PREFERENCES.resolvedGmailLinkArchiveDays);
    setExternalTools(DEFAULT_USER_PREFERENCES.externalTools);
    setCalendarReminderFullscreen(DEFAULT_USER_PREFERENCES.calendarReminderFullscreen);
    setUnreadInboxBindToSelectedEnabled(DEFAULT_USER_PREFERENCES.unreadInboxBindToSelectedEnabled);
    setUnreadInboxAppendToSelectedEnabled(DEFAULT_USER_PREFERENCES.unreadInboxAppendToSelectedEnabled);
  }

  function updateExternalTool(index: number, field: keyof ExternalToolLink, value: string) {
    setExternalTools((prev) =>
      prev.map((tool, i) => (i === index ? { ...tool, [field]: value } : tool))
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-lg bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-zendesk-border px-6 py-4">
          <div>
            <h2 className="text-lg font-semibold">Preferences</h2>
            <p className="text-sm text-zendesk-muted">
              Saved in <code className="text-xs">data/overlay.db</code> on this machine (survives
              browser cache clears).
            </p>
          </div>
          <button type="button" onClick={onClose} className="rounded p-1 hover:bg-gray-100">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-5 px-6 py-4">
          {error && (
            <p className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
              {error}
            </p>
          )}

          <fieldset className="space-y-3 rounded border border-zendesk-border p-3">
            <legend className="px-1 text-sm font-medium">Status timers</legend>
            <p className="text-xs text-zendesk-muted">
              Control when tickets auto-reopen to Open and how response timers are calculated.
            </p>

            <label className="block text-sm">
              <span className="font-medium">Pending → Open</span>
              <p className="mt-0.5 text-xs text-zendesk-muted">
                Weekday hours (Mon–Fri, 24h/day, weekends excluded) after marking Pending with
                no customer reply
              </p>
              <input
                type="number"
                min={1}
                max={500}
                value={pendingReopenBusinessHours}
                onChange={(e) => setPendingReopenBusinessHours(Number(e.target.value))}
                className="mt-2 w-full rounded border border-zendesk-border px-3 py-2 text-sm"
              />
            </label>

            <label className="block text-sm">
              <span className="font-medium">Longterm Hold / Bugs → Open</span>
              <p className="mt-0.5 text-xs text-zendesk-muted">
                Calendar days after marking Longterm Hold with no customer reply
              </p>
              <input
                type="number"
                min={1}
                max={365}
                value={longtermHoldReopenDays}
                onChange={(e) => setLongtermHoldReopenDays(Number(e.target.value))}
                className="mt-2 w-full rounded border border-zendesk-border px-3 py-2 text-sm"
              />
            </label>

            <label className="block text-sm">
              <span className="font-medium">Initial response hours</span>
              <p className="mt-0.5 text-xs text-zendesk-muted">
                Flag tickets with no outbound reply after this many business hours since intake
                (Setup schedule — nights, weekends, and US holidays excluded; badge only — does not
                change status)
              </p>
              <input
                type="number"
                min={1}
                max={720}
                value={initialResponseHours}
                onChange={(e) => setInitialResponseHours(Number(e.target.value))}
                className="mt-2 w-full rounded border border-zendesk-border px-3 py-2 text-sm"
              />
            </label>

            <label className="block text-sm">
              <span className="font-medium">Default Response SLA hours</span>
              <p className="mt-0.5 text-xs text-zendesk-muted">
                Countdown from the customer&apos;s last message while a ticket is Open (per-ticket
                Response SLA can still be changed in the ticket header)
              </p>
              <select
                value={defaultSlaHours}
                onChange={(e) => setDefaultSlaHours(Number(e.target.value))}
                className="mt-2 w-full rounded border border-zendesk-border px-3 py-2 text-sm"
              >
                {SLA_HOUR_OPTIONS.map((hours) => (
                  <option key={hours} value={hours}>
                    {hours} hours
                  </option>
                ))}
              </select>
            </label>

            <label className="block text-sm">
              <span className="font-medium">Resolved Gmail link archive</span>
              <p className="mt-0.5 text-xs text-zendesk-muted">
                Calendar days after Send/Resolved before the Gmail thread is unlinked and background
                polling stops (Resolve &amp; Close stops polling immediately)
              </p>
              <input
                type="number"
                min={1}
                max={365}
                value={resolvedGmailLinkArchiveDays}
                onChange={(e) => setResolvedGmailLinkArchiveDays(Number(e.target.value))}
                className="mt-2 w-full rounded border border-zendesk-border px-3 py-2 text-sm"
              />
            </label>
          </fieldset>

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

          <label className="block text-sm">
            <span className="font-medium">Default dashboard period</span>
            <p className="mt-0.5 text-xs text-zendesk-muted">
              Time window for dashboard charts and reports
            </p>
            <select
              value={dashboardPeriod}
              onChange={(e) => setDashboardPeriod(e.target.value as UserPreferences["dashboardPeriod"])}
              className="mt-2 w-full rounded border border-zendesk-border px-3 py-2 text-sm"
            >
              {DASHBOARD_PERIOD_OPTIONS.map((opt) => (
                <option key={opt.id} value={opt.id}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>

          <label className="block text-sm">
            <span className="font-medium">Default sort field</span>
            <p className="mt-0.5 text-xs text-zendesk-muted">
              How tickets are ordered in the list (you can change this anytime above the list)
            </p>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as UserPreferences["sortBy"])}
              className="mt-2 w-full rounded border border-zendesk-border px-3 py-2 text-sm"
            >
              <option value="submitted">Form submission date</option>
              <option value="updated">Recently updated</option>
            </select>
          </label>

          <fieldset className="text-sm">
            <legend className="font-medium">Default sort direction</legend>
            <p className="mt-0.5 text-xs text-zendesk-muted">
              Newest or oldest first for the sort field above
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

          <fieldset className="space-y-3 rounded border border-zendesk-border p-3">
            <legend className="px-1 text-sm font-medium">External tools</legend>
            <p className="text-xs text-zendesk-muted">
              Up to {EXTERNAL_TOOL_SLOT_COUNT} shortcuts shown below Linked cases in Internal tools.
              Leave a row blank to hide it.
            </p>
            <ul className="space-y-2">
              {externalTools.map((tool, index) => (
                <li key={index} className="grid gap-1.5 sm:grid-cols-2">
                  <input
                    type="text"
                    value={tool.label}
                    onChange={(e) => updateExternalTool(index, "label", e.target.value)}
                    placeholder={`Label ${index + 1}`}
                    className="rounded border border-zendesk-border px-2 py-1.5 text-sm"
                  />
                  <input
                    type="url"
                    value={tool.url}
                    onChange={(e) => updateExternalTool(index, "url", e.target.value)}
                    placeholder="https://…"
                    className="rounded border border-zendesk-border px-2 py-1.5 text-sm"
                  />
                </li>
              ))}
            </ul>
          </fieldset>

          <fieldset className="space-y-3 rounded border border-zendesk-border p-3">
            <legend className="px-1 text-sm font-medium">Calendar reminders</legend>
            <p className="text-xs text-zendesk-muted">
              When a Google Calendar event is about to start, SheetsCRM can alert you while this
              tab is active.
            </p>
            <label className="flex cursor-pointer items-start gap-3 text-sm">
              <input
                type="checkbox"
                checked={calendarReminderFullscreen}
                onChange={(e) => setCalendarReminderFullscreen(e.target.checked)}
                className="mt-0.5"
              />
              <span>
                <span className="font-medium">Full-screen event popup</span>
                <p className="mt-0.5 text-xs text-zendesk-muted">
                  Show a full-screen reminder with the event title, start time, and a link to open
                  the event in Google Calendar. When off, a small toast appears in the top-right
                  corner instead.
                </p>
              </span>
            </label>
          </fieldset>

          <fieldset className="space-y-3 rounded border border-zendesk-border p-3">
            <legend className="px-1 text-sm font-medium">Gmail unread inbox</legend>
            <p className="text-xs text-zendesk-muted">
              Control quick-link actions shown when triaging unread Gmail threads.
            </p>
            <label className="flex cursor-pointer items-start gap-3 text-sm">
              <input
                type="checkbox"
                checked={unreadInboxBindToSelectedEnabled}
                onChange={(e) => setUnreadInboxBindToSelectedEnabled(e.target.checked)}
                className="mt-0.5"
              />
              <span>
                <span className="font-medium">Bind to selected</span>
                <p className="mt-0.5 text-xs text-zendesk-muted">
                  Show a button to set the unread thread as the primary Gmail link on the currently
                  selected ticket (only when the ticket has no Gmail link yet).
                </p>
              </span>
            </label>
            <label className="flex cursor-pointer items-start gap-3 text-sm">
              <input
                type="checkbox"
                checked={unreadInboxAppendToSelectedEnabled}
                onChange={(e) => setUnreadInboxAppendToSelectedEnabled(e.target.checked)}
                className="mt-0.5"
              />
              <span>
                <span className="font-medium">Append to selected</span>
                <p className="mt-0.5 text-xs text-zendesk-muted">
                  Show a button to import the unread thread onto the selected ticket while keeping
                  outbound replies on the ticket&apos;s primary thread.
                </p>
              </span>
            </label>
          </fieldset>

          <label className="flex cursor-pointer items-start gap-3 text-sm">
            <input
              type="checkbox"
              checked={errorLoggingEnabled}
              onChange={(e) => setErrorLoggingEnabled(e.target.checked)}
              className="mt-0.5"
            />
            <span>
              <span className="font-medium">CRM debug log</span>
              <p className="mt-0.5 text-xs text-zendesk-muted">
                Log ticket refreshes, thread sync, status changes, admin notes, linked cases, and
                failures to the debug panel at the bottom of the screen (and the browser console).
              </p>
            </span>
          </label>
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
              onClick={() => void handleSave()}
              disabled={saving}
              className="rounded bg-zendesk-green px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save preferences"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
