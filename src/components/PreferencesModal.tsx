"use client";

import { useEffect, useRef, useState } from "react";
import { Play, Trash2, Upload, X } from "lucide-react";
import { DASHBOARD_PERIOD_OPTIONS } from "@/lib/dashboard-period";
import { SLA_HOUR_OPTIONS } from "@/lib/timer-settings";
import { DEFAULT_STATUSES } from "@/lib/types";
import {
  EXTERNAL_TOOL_SLOT_COUNT,
  type ExternalToolLink,
} from "@/lib/external-tools";
import {
  BUILTIN_CALENDAR_SOUNDS,
  BUILTIN_INBOUND_SOUNDS,
  BUILTIN_OUTBOUND_SOUNDS,
  DEFAULT_CALENDAR_SOUND_ID,
  DEFAULT_INBOUND_SOUND_ID,
  DEFAULT_OUTBOUND_SOUND_ID,
  MAX_CUSTOM_SOUND_BYTES,
  MAX_CUSTOM_SOUNDS,
  SOUND_CALENDAR_ID,
  SOUND_CLASSIC_ID,
  SOUND_OFF_ID,
  playSoundById,
  type CustomSoundRecord,
  type SoundChannel,
} from "@/lib/notification-sounds";
import {
  DEFAULT_USER_PREFERENCES,
  type UserPreferences,
  patchUserPreferences,
} from "@/lib/user-preferences";
import {
  fetchAttachmentFolderStatus,
  openAttachmentFolderInFinder,
  pickAttachmentDownloadsRoot,
  resetAttachmentDownloadsRoot,
  type AttachmentFolderStatus,
} from "@/lib/attachment-download-folder";
import {
  POMODORO_SCHEDULES,
  WELLNESS_CONTENT_SOURCES,
  type WellnessContentSourceId,
} from "@/lib/wellness-content";
import type { CaseBreakThreshold } from "@/lib/wellness-preferences";

interface PreferencesModalProps {
  preferences: UserPreferences;
  onClose: () => void;
  onSaved: (prefs: UserPreferences) => void;
}

function customPreferenceId(id: string): string {
  return `custom:${id}`;
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
  const [resolvedGmailPollHours, setResolvedGmailPollHours] = useState(
    preferences.resolvedGmailPollHours
  );
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
  const [recentSendsPanelEnabled, setRecentSendsPanelEnabled] = useState(
    preferences.recentSendsPanelEnabled
  );
  const [inboundSoundId, setInboundSoundId] = useState(preferences.inboundSoundId);
  const [outboundSoundId, setOutboundSoundId] = useState(preferences.outboundSoundId);
  const [calendarSoundId, setCalendarSoundId] = useState(preferences.calendarSoundId);
  const [caseBreaksEnabled, setCaseBreaksEnabled] = useState(preferences.caseBreaksEnabled);
  const [caseBreakThreshold, setCaseBreakThreshold] = useState<CaseBreakThreshold>(
    preferences.caseBreakThreshold
  );
  const [wellnessContentIds, setWellnessContentIds] = useState(preferences.wellnessContentIds);
  const [pomodoroBreaksEnabled, setPomodoroBreaksEnabled] = useState(
    preferences.pomodoroBreaksEnabled
  );
  const [pomodoroScheduleId, setPomodoroScheduleId] = useState(preferences.pomodoroScheduleId);
  const [customSounds, setCustomSounds] = useState<CustomSoundRecord[]>([]);
  const [soundsLoading, setSoundsLoading] = useState(true);
  const [soundError, setSoundError] = useState<string | null>(null);
  const [uploadingSound, setUploadingSound] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [attachmentFolderStatus, setAttachmentFolderStatus] =
    useState<AttachmentFolderStatus | null>(null);
  const [attachmentFolderBusy, setAttachmentFolderBusy] = useState(false);
  const [attachmentFolderError, setAttachmentFolderError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/sounds", { cache: "no-store", credentials: "same-origin" });
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok) {
          setSoundError(data.error || "Failed to load sounds");
          return;
        }
        setCustomSounds(Array.isArray(data.custom) ? data.custom : []);
      } catch {
        if (!cancelled) setSoundError("Failed to load sounds");
      } finally {
        if (!cancelled) setSoundsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void fetchAttachmentFolderStatus()
      .then((status) => {
        if (!cancelled) setAttachmentFolderStatus(status);
      })
      .catch(() => {
        /* optional — Preferences still usable */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function openConfiguredAttachmentFolder() {
    setAttachmentFolderError(null);
    setAttachmentFolderBusy(true);
    try {
      await openAttachmentFolderInFinder();
    } catch (err) {
      setAttachmentFolderError(
        err instanceof Error
          ? err.message
          : "Could not open attachment folder in Finder. Run Install or Open SheetsCRM.command once to install the folder helper."
      );
    } finally {
      setAttachmentFolderBusy(false);
    }
  }

  async function changeAttachmentFolder() {
    setAttachmentFolderError(null);
    setAttachmentFolderBusy(true);
    try {
      const status = await pickAttachmentDownloadsRoot();
      setAttachmentFolderStatus(status);
    } catch (err) {
      if (err instanceof Error && err.name === "AttachmentFolderPickCancelled") return;
      setAttachmentFolderError(
        err instanceof Error ? err.message : "Could not change attachment folder"
      );
    } finally {
      setAttachmentFolderBusy(false);
    }
  }

  async function useDefaultAttachmentFolder() {
    setAttachmentFolderError(null);
    setAttachmentFolderBusy(true);
    try {
      const status = await resetAttachmentDownloadsRoot();
      setAttachmentFolderStatus(status);
    } catch (err) {
      setAttachmentFolderError(
        err instanceof Error ? err.message : "Could not reset attachment folder"
      );
    } finally {
      setAttachmentFolderBusy(false);
    }
  }

  async function handleSave() {
    // Omit mixmaxStarredTemplateIds — Mixmax picker owns that field via its own PATCH.
    const prefs = {
      defaultStatusFilter: defaultView,
      sortBy,
      sortOrder,
      dashboardPeriod,
      errorLoggingEnabled,
      pendingReopenBusinessHours,
      longtermHoldReopenDays,
      initialResponseHours,
      defaultSlaHours,
      resolvedGmailPollHours,
      resolvedGmailLinkArchiveDays,
      externalTools,
      calendarReminderFullscreen,
      unreadInboxBindToSelectedEnabled,
      unreadInboxAppendToSelectedEnabled,
      recentSendsPanelEnabled,
      inboundSoundId,
      outboundSoundId,
      calendarSoundId,
      caseBreaksEnabled,
      caseBreakThreshold,
      wellnessContentIds,
      pomodoroBreaksEnabled,
      pomodoroScheduleId,
    } satisfies Partial<UserPreferences>;
    setSaving(true);
    setError(null);
    try {
      const saved = await patchUserPreferences(prefs);
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
    setResolvedGmailPollHours(DEFAULT_USER_PREFERENCES.resolvedGmailPollHours);
    setResolvedGmailLinkArchiveDays(DEFAULT_USER_PREFERENCES.resolvedGmailLinkArchiveDays);
    setExternalTools(DEFAULT_USER_PREFERENCES.externalTools);
    setCalendarReminderFullscreen(DEFAULT_USER_PREFERENCES.calendarReminderFullscreen);
    setUnreadInboxBindToSelectedEnabled(DEFAULT_USER_PREFERENCES.unreadInboxBindToSelectedEnabled);
    setUnreadInboxAppendToSelectedEnabled(DEFAULT_USER_PREFERENCES.unreadInboxAppendToSelectedEnabled);
    setRecentSendsPanelEnabled(DEFAULT_USER_PREFERENCES.recentSendsPanelEnabled);
    setInboundSoundId(DEFAULT_USER_PREFERENCES.inboundSoundId);
    setOutboundSoundId(DEFAULT_USER_PREFERENCES.outboundSoundId);
    setCalendarSoundId(DEFAULT_USER_PREFERENCES.calendarSoundId);
    setCaseBreaksEnabled(DEFAULT_USER_PREFERENCES.caseBreaksEnabled);
    setCaseBreakThreshold(DEFAULT_USER_PREFERENCES.caseBreakThreshold);
    setWellnessContentIds(DEFAULT_USER_PREFERENCES.wellnessContentIds);
    setPomodoroBreaksEnabled(DEFAULT_USER_PREFERENCES.pomodoroBreaksEnabled);
    setPomodoroScheduleId(DEFAULT_USER_PREFERENCES.pomodoroScheduleId);
  }

  function toggleWellnessContentId(id: WellnessContentSourceId) {
    setWellnessContentIds((prev) =>
      prev.includes(id) ? prev.filter((entry) => entry !== id) : [...prev, id]
    );
  }

  function updateExternalTool(index: number, field: keyof ExternalToolLink, value: string) {
    setExternalTools((prev) =>
      prev.map((tool, i) => (i === index ? { ...tool, [field]: value } : tool))
    );
  }

  function previewSound(soundId: string) {
    void playSoundById(soundId, { customSounds });
  }

  async function handleUploadSound(file: File | undefined) {
    if (!file) return;
    setSoundError(null);
    setUploadingSound(true);
    try {
      const body = new FormData();
      body.append("file", file);
      const res = await fetch("/api/sounds", {
        method: "POST",
        body,
        credentials: "same-origin",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Upload failed");
      setCustomSounds(Array.isArray(data.custom) ? data.custom : []);
    } catch (err) {
      setSoundError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploadingSound(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function handleDeleteCustomSound(id: string) {
    setSoundError(null);
    try {
      const res = await fetch("/api/sounds", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
        credentials: "same-origin",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to delete sound");
      setCustomSounds(Array.isArray(data.custom) ? data.custom : []);
      const prefId = customPreferenceId(id);
      if (inboundSoundId === prefId) setInboundSoundId(DEFAULT_USER_PREFERENCES.inboundSoundId);
      if (outboundSoundId === prefId) setOutboundSoundId(DEFAULT_USER_PREFERENCES.outboundSoundId);
      if (calendarSoundId === prefId) setCalendarSoundId(DEFAULT_USER_PREFERENCES.calendarSoundId);
    } catch (err) {
      setSoundError(err instanceof Error ? err.message : "Failed to delete sound");
    }
  }

  function renderSoundSelect(
    channel: SoundChannel,
    value: string,
    onChange: (id: string) => void
  ) {
    const builtins =
      channel === "calendar"
        ? BUILTIN_CALENDAR_SOUNDS
        : channel === "inbound"
          ? BUILTIN_INBOUND_SOUNDS
          : BUILTIN_OUTBOUND_SOUNDS;
    const fallback =
      channel === "calendar"
        ? DEFAULT_CALENDAR_SOUND_ID
        : channel === "inbound"
          ? DEFAULT_INBOUND_SOUND_ID
          : DEFAULT_OUTBOUND_SOUND_ID;
    const allBuiltins = [
      ...BUILTIN_INBOUND_SOUNDS,
      ...BUILTIN_OUTBOUND_SOUNDS,
      ...BUILTIN_CALENDAR_SOUNDS,
    ];
    const known =
      value === SOUND_OFF_ID ||
      value === SOUND_CLASSIC_ID ||
      value === SOUND_CALENDAR_ID ||
      allBuiltins.some((s) => s.id === value) ||
      customSounds.some((s) => customPreferenceId(s.id) === value);
    const selectValue = known ? value : fallback;

    return (
      <div className="flex gap-2">
        <select
          value={selectValue}
          onChange={(e) => onChange(e.target.value)}
          className="min-w-0 flex-1 rounded border border-zendesk-border px-3 py-2 text-sm"
        >
          <optgroup label="Built-in">
            {builtins.map((sound) => (
              <option key={sound.id} value={sound.id}>
                {sound.label}
              </option>
            ))}
          </optgroup>
          {customSounds.length > 0 && (
            <optgroup label="Custom">
              {customSounds.map((sound) => (
                <option key={sound.id} value={customPreferenceId(sound.id)}>
                  {sound.name}
                </option>
              ))}
            </optgroup>
          )}
          {known &&
            !builtins.some((s) => s.id === selectValue) &&
            selectValue !== SOUND_OFF_ID &&
            selectValue !== SOUND_CLASSIC_ID &&
            selectValue !== SOUND_CALENDAR_ID &&
            !customSounds.some((s) => customPreferenceId(s.id) === selectValue) && (
              <optgroup label="Current">
                <option value={selectValue}>
                  {allBuiltins.find((s) => s.id === selectValue)?.label ?? "Saved sound"}
                </option>
              </optgroup>
            )}
          <optgroup label="Other">
            {channel === "calendar" && (
              <>
                <option value={SOUND_CALENDAR_ID}>Generated calendar chime</option>
                <option value={SOUND_CLASSIC_ID}>Classic chime</option>
              </>
            )}
            {channel === "inbound" && (
              <option value={SOUND_CLASSIC_ID}>Classic chime</option>
            )}
            <option value={SOUND_OFF_ID}>Off</option>
          </optgroup>
        </select>
        <button
          type="button"
          onClick={() => previewSound(selectValue)}
          disabled={selectValue === SOUND_OFF_ID}
          title="Preview sound"
          aria-label="Preview sound"
          className="inline-flex shrink-0 items-center gap-1.5 rounded border border-zendesk-border px-3 py-2 text-sm hover:bg-gray-50 disabled:opacity-40"
        >
          <Play className="h-3.5 w-3.5" />
          Play
        </button>
      </div>
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
            <legend className="px-1 text-sm font-medium">Notification sounds</legend>
            <p className="text-xs text-zendesk-muted">
              Choose sounds for inbound tickets, outbound sends, and calendar popups. Preview before
              saving.
            </p>

            {soundError && (
              <p className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
                {soundError}
              </p>
            )}

            <label className="block text-sm">
              <span className="font-medium">Inbound notifications</span>
              <p className="mt-0.5 text-xs text-zendesk-muted">
                Plays when a new ticket arrives or a customer replies while Pending
              </p>
              <div className="mt-2">
                {renderSoundSelect("inbound", inboundSoundId, setInboundSoundId)}
              </div>
            </label>

            <label className="block text-sm">
              <span className="font-medium">Outbound sends</span>
              <p className="mt-0.5 text-xs text-zendesk-muted">
                Plays when you queue a Send / Pending or Send / Resolved reply
              </p>
              <div className="mt-2">
                {renderSoundSelect("outbound", outboundSoundId, setOutboundSoundId)}
              </div>
            </label>

            <label className="block text-sm">
              <span className="font-medium">Calendar popup</span>
              <p className="mt-0.5 text-xs text-zendesk-muted">
                Plays when a calendar reminder toast or full-screen popup appears
              </p>
              <div className="mt-2">
                {renderSoundSelect("calendar", calendarSoundId, setCalendarSoundId)}
              </div>
            </label>

            <div className="space-y-2 border-t border-zendesk-border pt-3">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-medium">Custom sounds</p>
                  <p className="text-xs text-zendesk-muted">
                    MP3, WAV, or OGG · max {Math.round(MAX_CUSTOM_SOUND_BYTES / 1024)} KB · up to{" "}
                    {MAX_CUSTOM_SOUNDS} files
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploadingSound || customSounds.length >= MAX_CUSTOM_SOUNDS}
                  className="inline-flex items-center gap-1.5 rounded border border-zendesk-border px-3 py-1.5 text-sm hover:bg-gray-50 disabled:opacity-40"
                >
                  <Upload className="h-3.5 w-3.5" />
                  {uploadingSound ? "Uploading…" : "Upload"}
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".mp3,.wav,.ogg,audio/mpeg,audio/wav,audio/ogg"
                  className="hidden"
                  onChange={(e) => void handleUploadSound(e.target.files?.[0])}
                />
              </div>

              {soundsLoading ? (
                <p className="text-xs text-zendesk-muted">Loading custom sounds…</p>
              ) : customSounds.length === 0 ? (
                <p className="text-xs text-zendesk-muted">No custom sounds yet.</p>
              ) : (
                <ul className="space-y-1.5">
                  {customSounds.map((sound) => (
                    <li
                      key={sound.id}
                      className="flex items-center gap-2 rounded border border-zendesk-border px-2 py-1.5 text-sm"
                    >
                      <span className="min-w-0 flex-1 truncate">{sound.name}</span>
                      <span className="shrink-0 text-xs text-zendesk-muted">
                        {Math.ceil(sound.sizeBytes / 1024)} KB
                      </span>
                      <button
                        type="button"
                        onClick={() => previewSound(customPreferenceId(sound.id))}
                        title="Preview"
                        aria-label={`Preview ${sound.name}`}
                        className="rounded p-1 hover:bg-gray-100"
                      >
                        <Play className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleDeleteCustomSound(sound.id)}
                        title="Delete"
                        aria-label={`Delete ${sound.name}`}
                        className="rounded p-1 text-red-600 hover:bg-red-50"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </fieldset>

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
              <span className="font-medium">Resolved Gmail poll frequency</span>
              <p className="mt-0.5 text-xs text-zendesk-muted">
                How often (in hours) to check Gmail for customer replies on Resolved tickets that
                still have a linked thread (Resolve &amp; Close does not poll)
              </p>
              <input
                type="number"
                min={1}
                max={168}
                value={resolvedGmailPollHours}
                onChange={(e) => setResolvedGmailPollHours(Number(e.target.value))}
                className="mt-2 w-full rounded border border-zendesk-border px-3 py-2 text-sm"
              />
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
            <legend className="px-1 text-sm font-medium">Health & productivity</legend>
            <p className="text-xs text-zendesk-muted">
              Optional break prompts after case sends and timed movement reminders (from the office
              break schedule). All features are off until you enable them.
            </p>

            <label className="flex cursor-pointer items-start gap-3 text-sm">
              <input
                type="checkbox"
                checked={caseBreaksEnabled}
                onChange={(e) => setCaseBreaksEnabled(e.target.checked)}
                className="mt-0.5"
              />
              <span>
                <span className="font-medium">Case milestone overlays</span>
                <p className="mt-0.5 text-xs text-zendesk-muted">
                  After every 5 or 10 successful sends (Send only, Send/Pending, or Send/Resolved),
                  show a cyan/blue content break. Riddle answers stay hidden until Reveal.
                </p>
              </span>
            </label>

            {caseBreaksEnabled && (
              <div className="ml-7 space-y-3 border-l border-zendesk-border pl-3">
                <fieldset className="text-sm">
                  <legend className="font-medium">Show after</legend>
                  <div className="mt-2 flex gap-4">
                    <label className="flex items-center gap-2">
                      <input
                        type="radio"
                        name="caseBreakThreshold"
                        checked={caseBreakThreshold === 5}
                        onChange={() => setCaseBreakThreshold(5)}
                      />
                      5 cases
                    </label>
                    <label className="flex items-center gap-2">
                      <input
                        type="radio"
                        name="caseBreakThreshold"
                        checked={caseBreakThreshold === 10}
                        onChange={() => setCaseBreakThreshold(10)}
                      />
                      10 cases
                    </label>
                  </div>
                </fieldset>

                <fieldset className="text-sm">
                  <legend className="font-medium">Content packs</legend>
                  <p className="mt-0.5 text-xs text-zendesk-muted">
                    Choose one or more JSON packs to rotate through. At least one is required for
                    overlays to appear.
                  </p>
                  <ul className="mt-2 max-h-48 space-y-1.5 overflow-y-auto pr-1">
                    {WELLNESS_CONTENT_SOURCES.map((source) => (
                      <li key={source.id}>
                        <label className="flex cursor-pointer items-start gap-2">
                          <input
                            type="checkbox"
                            checked={wellnessContentIds.includes(source.id)}
                            onChange={() => toggleWellnessContentId(source.id)}
                            className="mt-0.5"
                          />
                          <span>
                            <span className="font-medium">{source.label}</span>
                            <p className="text-xs text-zendesk-muted">{source.description}</p>
                          </span>
                        </label>
                      </li>
                    ))}
                  </ul>
                </fieldset>
              </div>
            )}

            <label className="flex cursor-pointer items-start gap-3 text-sm">
              <input
                type="checkbox"
                checked={pomodoroBreaksEnabled}
                onChange={(e) => setPomodoroBreaksEnabled(e.target.checked)}
                className="mt-0.5"
              />
              <span>
                <span className="font-medium">Movement / Pomodoro reminders</span>
                <p className="mt-0.5 text-xs text-zendesk-muted">
                  Emerald overlay prompts to stand and move on a work/break schedule. Runs while this
                  tab is active.
                </p>
              </span>
            </label>

            {pomodoroBreaksEnabled && (
              <div className="ml-7 space-y-2 border-l border-zendesk-border pl-3">
                <label className="block text-sm">
                  <span className="font-medium">Break schedule</span>
                  <select
                    value={pomodoroScheduleId}
                    onChange={(e) =>
                      setPomodoroScheduleId(
                        e.target.value as typeof pomodoroScheduleId
                      )
                    }
                    className="mt-2 w-full rounded border border-zendesk-border px-3 py-2 text-sm"
                  >
                    {POMODORO_SCHEDULES.map((schedule) => (
                      <option key={schedule.id} value={schedule.id}>
                        {schedule.label} — {schedule.nickname} ({schedule.movement})
                      </option>
                    ))}
                  </select>
                </label>
                {POMODORO_SCHEDULES.filter((s) => s.id === pomodoroScheduleId).map((schedule) => (
                  <p key={schedule.id} className="text-xs text-zendesk-muted">
                    {schedule.benefit} · {schedule.dailyActivity}
                  </p>
                ))}
              </div>
            )}
          </fieldset>

          <fieldset className="space-y-3 rounded border border-zendesk-border p-3">
            <legend className="px-1 text-sm font-medium">Attachment downloads</legend>
            <p className="text-xs text-zendesk-muted">
              Ticket attachments save into{" "}
              <code className="text-[11px]">Row {"{n}"}</code> under this folder. Default is{" "}
              <code className="text-[11px]">
                {attachmentFolderStatus?.defaultDisplayRoot ??
                  "~/Documents/SheetsCRM-Attachments"}
              </code>
              . Change it if you prefer another location on this Mac — downloads and the ticket{" "}
              <span className="font-medium">Folder</span> button both use the path below.
            </p>
            <p className="text-sm">
              <span className="font-medium">Current folder: </span>
              <span className="font-mono text-xs">
                {attachmentFolderStatus?.displayRoot ?? "Loading…"}
              </span>
              {attachmentFolderStatus && !attachmentFolderStatus.isDefault ? (
                <span className="ml-1 text-xs text-zendesk-muted">(custom)</span>
              ) : attachmentFolderStatus?.isDefault ? (
                <span className="ml-1 text-xs text-zendesk-muted">(default)</span>
              ) : null}
            </p>
            {attachmentFolderError && (
              <p className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
                {attachmentFolderError}
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void openConfiguredAttachmentFolder()}
                disabled={attachmentFolderBusy}
                className="rounded border border-zendesk-border bg-white px-3 py-1.5 text-sm hover:bg-gray-50 disabled:opacity-50"
              >
                Open in Finder…
              </button>
              <button
                type="button"
                onClick={() => void changeAttachmentFolder()}
                disabled={attachmentFolderBusy}
                className="rounded border border-zendesk-border bg-white px-3 py-1.5 text-sm hover:bg-gray-50 disabled:opacity-50"
              >
                Change folder…
              </button>
              {attachmentFolderStatus && !attachmentFolderStatus.isDefault ? (
                <button
                  type="button"
                  onClick={() => void useDefaultAttachmentFolder()}
                  disabled={attachmentFolderBusy}
                  className="rounded border border-zendesk-border bg-white px-3 py-1.5 text-sm hover:bg-gray-50 disabled:opacity-50"
                >
                  Use default
                </button>
              ) : null}
            </div>
          </fieldset>

          <fieldset className="space-y-3 rounded border border-zendesk-border p-3">
            <legend className="px-1 text-sm font-medium">Ticket right rail</legend>
            <p className="text-xs text-zendesk-muted">
              Optional panels on the ticket detail sidebar. Send history is still recorded even when
              the Recent sends button is hidden.
            </p>
            <label className="flex cursor-pointer items-start gap-3 text-sm">
              <input
                type="checkbox"
                checked={recentSendsPanelEnabled}
                onChange={(e) => setRecentSendsPanelEnabled(e.target.checked)}
                className="mt-0.5"
              />
              <span>
                <span className="font-medium">Show Recent sends</span>
                <p className="mt-0.5 text-xs text-zendesk-muted">
                  Display the Recent sends archive panel under Trust escalations. Outbound emails are
                  always saved to this browser archive regardless of this setting.
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
