/**
 * Top-level client shell for SheetsCRM.
 *
 * Layer: UI orchestration (single-page app)
 *
 * Owns view switching (ticket list/detail, personal/team dashboards), auth chrome,
 * auto-refresh of GET /api/tickets, follow-up background Gmail sync, preferences/setup
 * modals, calendar/wellness reminders, optimistic status updates, and ticket chimes.
 * Child components render panels; this file coordinates shared ticket state and
 * refresh side effects.
 *
 * Ticket refresh is not a pure read: the tickets API may archive stale Gmail
 * links and flag due background Gmail work. Prefer loadTickets() over ad-hoc
 * fetches so debounce / in-flight coalescing stay consistent.
 *
 * @see docs/ENGINEERING_AND_SECURITY.md — Runtime architecture
 */
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { CircleHelp, LogIn, LogOut, RefreshCw, Settings, SlidersHorizontal } from "lucide-react";
import type { CoverSheetEntry, SheetConfig, Ticket } from "@/lib/types";
import { resolveSheetConfigForTicket } from "@/lib/cover-sheets";
import { intakeAirbnbUserIdFromTicket } from "@/lib/airbnb-user-id";
import {
  columnDisplayLabel,
  getMappedUiFieldSlots,
  uiFieldDisplayLabel,
} from "@/lib/ui-field-slots";
import { DEFAULT_STATUSES } from "@/lib/types";
import { Sidebar, type AppView } from "./Sidebar";
import { TicketList } from "./TicketList";
import { TicketDetail } from "./TicketDetail";
import { TicketDetailTransition, type TicketLoadedCue } from "./TicketDetailTransition";
import { SetupModal, type SetupModalTab } from "./SetupModal";
import { BusinessHoursUpdatedModal } from "./BusinessHoursUpdatedModal";
import { PreferencesModal } from "./PreferencesModal";
import { CrmDebugLogPanel } from "./CrmDebugLogPanel";
import { CalendarReminderToast } from "./CalendarReminderToast";
import { CalendarReminderModal } from "./CalendarReminderModal";
import { WellnessContentModal } from "./WellnessContentModal";
import { PomodoroBreakModal } from "./PomodoroBreakModal";
import { UnreadInboxModal } from "./UnreadInboxModal";
import { HelpOverlay } from "./HelpOverlay";
import { appendAdminNoteToText } from "@/lib/admin-notes";
import { crmSubjectLabelFromStored } from "@/lib/email-subject";
import { applyPendingStatusTimerFields } from "@/lib/ticket-activity";
import {
  formatCrmRowRef,
  formatTicketListRefreshDetail,
  logCrmError,
  logCrmTiming,
  logCrmWarn,
  setCrmErrorLoggingEnabled,
  type TicketListRefreshReason,
} from "@/lib/crm-debug-log";
import { parseLinkedCase } from "@/lib/linked-cases";
import { usePersistedBoolean } from "@/hooks/usePersistedBoolean";
import { usePendingSendQueue } from "@/hooks/usePendingSendQueue";
import type { QueuedSendPayload } from "@/lib/queued-send";
import { usePersistedWidth, useResponsivePanelMax } from "@/hooks/usePersistedWidth";
import { useRefreshCountdown } from "@/hooks/useRefreshCountdown";
import { useCalendarReminders } from "@/hooks/useCalendarReminders";
import { useCaseBreakWellness } from "@/hooks/useCaseBreakWellness";
import { usePomodoroBreakReminders } from "@/hooks/usePomodoroBreakReminders";
import { useTicketChimeUnlock } from "@/hooks/useTicketChime";
import {
  configureNotificationSounds,
  playInboundNotificationSound,
} from "@/lib/notification-sounds";
import {
  buildTicketChimeSnapshots,
  shouldPlayTicketChime,
  type TicketChimeSnapshot,
} from "@/lib/ticket-chime";
import { ResizableColumn } from "./ResizableColumn";
import {
  dashboardFilterLabel,
  type DashboardFilter,
} from "@/lib/dashboard-filter";
import {
  buildFilteredTicketList,
  pickNextTicketAfterSend,
} from "@/lib/next-ticket-after-send";
import { isResponseSlaEligibleStatus } from "@/lib/sla-display";
import { normalizeStatusId } from "@/lib/status-mapper";
import { ticketFieldsFromCloseOutcome, type CloseOutcomeAnswers } from "@/lib/close-outcome";
import { InboxVictoryView } from "./InboxVictoryView";
import { buildContactReasonOptions } from "@/lib/contact-reasons";
import type { TicketQualityFilter } from "@/lib/ticket-search";
import type { DashboardPeriod, RollingDashboardPeriod } from "@/lib/dashboard-period";
import {
  calendarMonthKeyFromPeriod,
  dashboardPeriodFromCalendarMonthKey,
  isRollingDashboardPeriod,
} from "@/lib/dashboard-period";
import {
  DEFAULT_USER_PREFERENCES,
  fetchUserPreferences,
  migrateLegacyPreferencesIfNeeded,
  patchUserPreferences,
  type UserPreferences,
} from "@/lib/user-preferences";
import {
  filterActiveMappingWarnings,
  mappingWarningsFingerprint,
} from "@/lib/mapping-warnings";

const AUTO_REFRESH_SECONDS =
  Number(process.env.NEXT_PUBLIC_AUTO_REFRESH_SECONDS) || 60;
const AUTO_REFRESH_MS = AUTO_REFRESH_SECONDS * 1000;
const TICKET_REFRESH_DEBOUNCE_MS = 900;

const DashboardView = dynamic(
  () => import("./DashboardView").then((mod) => mod.DashboardView),
  { ssr: false, loading: () => <DashboardChunkPlaceholder label="Loading dashboard…" /> }
);
const TeamDashboardView = dynamic(
  () => import("./TeamDashboardView").then((mod) => mod.TeamDashboardView),
  { ssr: false, loading: () => <DashboardChunkPlaceholder label="Loading team dashboard…" /> }
);

function DashboardChunkPlaceholder({ label }: { label: string }) {
  return (
    <div className="flex min-w-0 flex-1 items-center justify-center bg-zendesk-bg text-sm text-zendesk-muted">
      {label}
    </div>
  );
}

/** Keep local sheet-field edits until Google Sheets catch up on refresh. */
const PENDING_SHEET_FIELD_TTL_MS = 20_000;

type PendingSheetFields = Partial<
  Pick<
    Ticket,
    | "claimNumber"
    | "reservationCode"
    | "listingId"
    | "inFavorOfHost"
    | "csInTheWrong"
    | "remediationSuccessful"
  >
>;

type LoadTicketsOptions = {
  silent?: boolean;
  reason?: TicketListRefreshReason;
};

function buildOptimisticStatusFields(ticket: Ticket, status: string, _defaultSlaHours: number) {
  const now = new Date().toISOString();
  const normalized = normalizeStatusId(status);
  let timerExtras: {
    statusChangedAt?: string;
    slaDueAt?: string | null;
  } = {};

  if (normalized === "pending" || normalized === "longterm_hold") {
    timerExtras = { statusChangedAt: now, slaDueAt: null };
  } else if (!isResponseSlaEligibleStatus(normalized)) {
    timerExtras = { slaDueAt: null };
  }

  const withStatus = applyPendingStatusTimerFields(ticket, { status, ...timerExtras });
  if (!isResponseSlaEligibleStatus(normalized)) {
    return {
      ...withStatus,
      slaDueAt: null,
      slaBreached: false,
      needsInitialResponse: false,
    };
  }
  return withStatus;
}

export function CrmShell() {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [config, setConfig] = useState<SheetConfig | null>(null);
  const [coverSheets, setCoverSheets] = useState<CoverSheetEntry[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [autoAdvanceCue, setAutoAdvanceCue] = useState<TicketLoadedCue | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [activeView, setActiveView] = useState<AppView>("tickets");
  const [dashboardFilter, setDashboardFilter] = useState<DashboardFilter | null>(null);
  const [sortBy, setSortBy] = useState<UserPreferences["sortBy"]>("submitted");
  const [sortOrder, setSortOrder] = useState<UserPreferences["sortOrder"]>("desc");
  const [dashboardPeriod, setDashboardPeriod] = useState<DashboardPeriod>("3m");
  const [lastRollingDashboardPeriod, setLastRollingDashboardPeriod] =
    useState<RollingDashboardPeriod>("3m");
  const prefsRef = useRef<UserPreferences>(DEFAULT_USER_PREFERENCES);
  const [search, setSearch] = useState("");
  const [qualityFilters, setQualityFilters] = useState<TicketQualityFilter[]>([]);
  const [setupOpen, setSetupOpen] = useState(false);
  const [setupInitialTab, setSetupInitialTab] = useState<SetupModalTab>("sheet");
  const [businessHoursUpdatedOpen, setBusinessHoursUpdatedOpen] = useState(false);
  const [marketManagersVersion, setMarketManagersVersion] = useState(0);

  function openSetup(tab: SetupModalTab = "sheet") {
    setSetupInitialTab(tab);
    setSetupOpen(true);
  }
  const [viewsCollapsed, setViewsCollapsed] = usePersistedBoolean("crm.viewsCollapsed", false);
  const [ticketListCollapsed, setTicketListCollapsed] = usePersistedBoolean(
    "crm.ticketListCollapsed",
    false
  );
  const sidebarMaxWidth = useResponsivePanelMax(160, 176);
  const ticketListMaxWidth = useResponsivePanelMax(224, 256);
  const sidebarWidthState = usePersistedWidth("crm.sidebarWidth", sidebarMaxWidth);
  const ticketListWidthState = usePersistedWidth("crm.ticketListWidth", ticketListMaxWidth);
  const [preferencesOpen, setPreferencesOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [unreadInboxOpen, setUnreadInboxOpen] = useState(false);
  const [prefsLoaded, setPrefsLoaded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [source, setSource] = useState<string>("unauthenticated");
  const [mappingWarnings, setMappingWarnings] = useState<string[]>([]);
  const rawMappingWarningsRef = useRef<string[]>([]);
  const [auth, setAuth] = useState<{
    signedIn: boolean;
    email: string | null;
    method: "oauth" | "service-account" | null;
  }>({
    signedIn: false,
    email: null,
    method: null,
  });
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(null);
  const [inboxVictory, setInboxVictory] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [errorLoggingEnabled, setErrorLoggingEnabled] = useState(false);
  const [initialResponseHours, setInitialResponseHours] = useState(
    DEFAULT_USER_PREFERENCES.initialResponseHours
  );
  const [externalTools, setExternalTools] = useState(DEFAULT_USER_PREFERENCES.externalTools);
  const [recentSendsPanelEnabled, setRecentSendsPanelEnabled] = useState(
    DEFAULT_USER_PREFERENCES.recentSendsPanelEnabled
  );
  const [calendarReminderFullscreen, setCalendarReminderFullscreen] = useState(
    DEFAULT_USER_PREFERENCES.calendarReminderFullscreen
  );
  const [caseBreaksEnabled, setCaseBreaksEnabled] = useState(
    DEFAULT_USER_PREFERENCES.caseBreaksEnabled
  );
  const [caseBreakThreshold, setCaseBreakThreshold] = useState(
    DEFAULT_USER_PREFERENCES.caseBreakThreshold
  );
  const [wellnessContentIds, setWellnessContentIds] = useState(
    DEFAULT_USER_PREFERENCES.wellnessContentIds
  );
  const [pomodoroBreaksEnabled, setPomodoroBreaksEnabled] = useState(
    DEFAULT_USER_PREFERENCES.pomodoroBreaksEnabled
  );
  const [pomodoroScheduleId, setPomodoroScheduleId] = useState(
    DEFAULT_USER_PREFERENCES.pomodoroScheduleId
  );
  const [countdownResetKey, setCountdownResetKey] = useState(0);
  const sourceRef = useRef(source);
  const initialSelectionDone = useRef(false);
  const loadTicketsInflightRef = useRef<Promise<void> | null>(null);
  const loadTicketsPendingRef = useRef<LoadTicketsOptions | null>(null);
  const refreshDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const selectedIdRef = useRef<string | null>(null);
  const ticketChimeSnapshotsRef = useRef<Map<string, TicketChimeSnapshot> | null>(null);
  const pendingSheetFieldsRef = useRef<
    Map<string, { fields: PendingSheetFields; at: number }>
  >(new Map());
  const [composeClearedRowId, setComposeClearedRowId] = useState<string | null>(null);
  const [composeRestore, setComposeRestore] = useState<QueuedSendPayload | null>(null);
  sourceRef.current = source;

  function rememberPendingSheetFields(rowId: string, fields: PendingSheetFields) {
    const prev = pendingSheetFieldsRef.current.get(rowId);
    pendingSheetFieldsRef.current.set(rowId, {
      fields: { ...prev?.fields, ...fields },
      at: Date.now(),
    });
  }

  function applyPendingSheetFields(tickets: Ticket[]): Ticket[] {
    const now = Date.now();
    return tickets.map((ticket) => {
      const pending = pendingSheetFieldsRef.current.get(ticket.rowId);
      if (!pending) return ticket;
      if (now - pending.at > PENDING_SHEET_FIELD_TTL_MS) {
        pendingSheetFieldsRef.current.delete(ticket.rowId);
        return ticket;
      }

      const remaining: PendingSheetFields = { ...pending.fields };
      (Object.keys(remaining) as (keyof PendingSheetFields)[]).forEach((key) => {
        const local = (remaining[key] ?? "").trim();
        const remote = (ticket[key] ?? "").trim();
        if (local === remote) {
          delete remaining[key];
        }
      });

      if (Object.keys(remaining).length === 0) {
        pendingSheetFieldsRef.current.delete(ticket.rowId);
        return ticket;
      }

      pendingSheetFieldsRef.current.set(ticket.rowId, {
        fields: remaining,
        at: pending.at,
      });
      return { ...ticket, ...remaining };
    });
  }

  useTicketChimeUnlock();

  const secondsUntilRefresh = useRefreshCountdown(
    AUTO_REFRESH_SECONDS,
    source !== "mock",
    countdownResetKey
  );

  // Coalesces concurrent refreshes so auto-refresh + manual Refresh share one /api/tickets trip.
  const loadTickets = useCallback(async (options?: LoadTicketsOptions) => {
    if (loadTicketsInflightRef.current) {
      loadTicketsPendingRef.current = {
        silent: options?.silent ?? true,
        reason: options?.reason ?? loadTicketsPendingRef.current?.reason ?? "after-edit",
      };
      return loadTicketsInflightRef.current;
    }

    const silent = options?.silent ?? false;
    const reason: TicketListRefreshReason = options?.reason ?? (silent ? "auto-refresh" : "initial");
    const started = performance.now();

    const run = (async () => {
      if (silent) setSyncing(true);
      else setLoading(true);
      let followUpGmail = false;

      try {
        const res = await fetch(`/api/tickets?_=${Date.now()}`, {
          cache: "no-store",
          credentials: "same-origin",
        });
        const data = await res.json();

        if (!res.ok || data.error) {
          const message = data.error ?? "Failed to load tickets";
          if (silent && sourceRef.current !== "mock") {
            setSyncError(message);
            logCrmError("Ticket list refresh failed", `${reason} — ${message}`);
            return;
          }
          throw new Error(message);
        }

        if (silent && data.source === "mock" && sourceRef.current !== "mock") {
          setSyncError("Sync failed — try signing in again");
          logCrmWarn("Ticket list refresh returned mock data while signed in");
          return;
        }

        setSyncError(null);
        const incomingTickets = (data.tickets ?? []) as Ticket[];
        const previousChimeSnapshots = ticketChimeSnapshotsRef.current;
        ticketChimeSnapshotsRef.current = buildTicketChimeSnapshots(incomingTickets);
        if (
          silent &&
          previousChimeSnapshots !== null &&
          sourceRef.current !== "mock" &&
          data.source !== "mock" &&
          shouldPlayTicketChime(previousChimeSnapshots, incomingTickets)
        ) {
          playInboundNotificationSound();
        }
        setTickets(applyPendingSheetFields(incomingTickets));
        setConfig(data.config ?? null);
        setCoverSheets(data.coverSheets ?? []);
        setSource(data.source ?? "unauthenticated");
        const incomingWarnings = Array.isArray(data.mappingWarnings)
          ? (data.mappingWarnings as string[])
          : [];
        rawMappingWarningsRef.current = incomingWarnings;
        setMappingWarnings(
          filterActiveMappingWarnings(
            incomingWarnings,
            prefsRef.current.dismissedMappingWarningsFingerprint
          )
        );
        setLastSyncedAt(new Date());
        setCountdownResetKey((k) => k + 1);
        const ticketCount = (data.tickets ?? []).length;
        logCrmTiming(
          "Ticket list refresh",
          performance.now() - started,
          formatTicketListRefreshDetail({
            reason,
            ticketCount,
            source: data.source ?? "unknown",
          })
        );
        followUpGmail = Boolean(data.backgroundGmailSyncDue) && reason !== "gmail-sync";
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to load tickets";
        if (!silent) {
          setSyncError(message);
        }
        logCrmError(
          "Ticket list refresh failed",
          `${reason} — ${message}`
        );
      } finally {
        if (silent) setSyncing(false);
        else setLoading(false);
        loadTicketsInflightRef.current = null;
        const pending = loadTicketsPendingRef.current;
        loadTicketsPendingRef.current = null;
        if (pending) {
          void loadTickets(pending);
        } else if (followUpGmail) {
          void (async () => {
            try {
              const syncRes = await fetch("/api/tickets/background-gmail-sync", {
                method: "POST",
                cache: "no-store",
                credentials: "same-origin",
              });
              const syncData = await syncRes.json();
              if (syncRes.ok && Number(syncData.synced) > 0) {
                await loadTickets({ silent: true, reason: "gmail-sync" });
              }
            } catch {
              /* Next auto-refresh retries Gmail; list is already visible. */
            }
          })();
        }
      }
    })();

    loadTicketsInflightRef.current = run;
    return run;
  }, []);

  const scheduleTicketsRefresh = useCallback(
    (options?: LoadTicketsOptions) => {
      if (refreshDebounceRef.current) clearTimeout(refreshDebounceRef.current);
      refreshDebounceRef.current = setTimeout(() => {
        void loadTickets({
          silent: true,
          reason: "after-edit",
          ...options,
        });
      }, TICKET_REFRESH_DEBOUNCE_MS);
    },
    [loadTickets]
  );

  const loadAuth = useCallback(async () => {
    const res = await fetch("/api/auth/status");
    const data = await res.json();
    setAuth({
      signedIn: data.signedIn,
      email: data.email,
      method: data.method ?? null,
    });
  }, []);

  const calendarReminders = useCalendarReminders(
    auth.signedIn && auth.method === "oauth" && source !== "mock",
    calendarReminderFullscreen ? "fullscreen" : "toast"
  );

  const caseBreakWellness = useCaseBreakWellness({
    enabled: caseBreaksEnabled,
    threshold: caseBreakThreshold,
    contentIds: wellnessContentIds,
  });

  const pomodoroBreaks = usePomodoroBreakReminders({
    enabled: pomodoroBreaksEnabled,
    scheduleId: pomodoroScheduleId,
  });

  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await migrateLegacyPreferencesIfNeeded();
      const prefs = await fetchUserPreferences();
      if (cancelled) return;
      prefsRef.current = prefs;
      configureNotificationSounds(prefs);
      setMappingWarnings(
        filterActiveMappingWarnings(
          rawMappingWarningsRef.current,
          prefs.dismissedMappingWarningsFingerprint
        )
      );
      setStatusFilter(prefs.defaultStatusFilter);
      setSortBy(prefs.sortBy);
      setSortOrder(prefs.sortOrder);
      setDashboardPeriod(prefs.dashboardPeriod);
      if (isRollingDashboardPeriod(prefs.dashboardPeriod)) {
        setLastRollingDashboardPeriod(prefs.dashboardPeriod);
      }
      setErrorLoggingEnabled(prefs.errorLoggingEnabled);
      setCrmErrorLoggingEnabled(prefs.errorLoggingEnabled);
      setInitialResponseHours(prefs.initialResponseHours);
      setExternalTools(prefs.externalTools);
      setRecentSendsPanelEnabled(prefs.recentSendsPanelEnabled);
      setCalendarReminderFullscreen(prefs.calendarReminderFullscreen);
      setCaseBreaksEnabled(prefs.caseBreaksEnabled);
      setCaseBreakThreshold(prefs.caseBreakThreshold);
      setWellnessContentIds(prefs.wellnessContentIds);
      setPomodoroBreaksEnabled(prefs.pomodoroBreaksEnabled);
      setPomodoroScheduleId(prefs.pomodoroScheduleId);
      setPrefsLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    void loadTickets({ reason: "initial" });
    loadAuth();
  }, [loadTickets, loadAuth]);

  useEffect(() => {
    if (auth.method !== "oauth" || source === "mock" || source === "unauthenticated") return;
    const idle = window.setTimeout(() => {
      void fetch("/api/mixmax/templates", { cache: "no-store", credentials: "same-origin" }).catch(
        () => {}
      );
      void fetch("/api/gmail/unread?warm=1", { cache: "no-store", credentials: "same-origin" }).catch(
        () => {}
      );
    }, 3000);
    return () => window.clearTimeout(idle);
  }, [auth.method, source]);

  useEffect(() => {
    if (source === "mock" || source === "unauthenticated") return;

    const refresh = (refreshReason: TicketListRefreshReason) => {
      if (document.visibilityState === "visible") {
        void loadTickets({ silent: true, reason: refreshReason });
      }
    };

    const intervalId = setInterval(() => refresh("auto-refresh"), AUTO_REFRESH_MS);

    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        refresh("visibility");
      }
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      clearInterval(intervalId);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [loadTickets, source]);

  useEffect(() => {
    return () => {
      if (refreshDebounceRef.current) clearTimeout(refreshDebounceRef.current);
    };
  }, []);

  useEffect(() => {
    function onBeforeUnload(event: BeforeUnloadEvent) {
      // Browser shows a generic "Leave site?" prompt (bookmark bar, refresh, close tab).
      event.preventDefault();
      event.returnValue = "";
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, []);

  async function handleSignOut() {
    await fetch("/api/auth/logout", { method: "POST" });
    await loadAuth();
    await loadTickets({ reason: "manual" });
  }

  const contactReasonOptions = useMemo(
    () => buildContactReasonOptions(tickets),
    [tickets]
  );

  const selected = tickets.find((t) => t.rowId === selectedId) ?? null;

  /** Expose selected ticket to the Nova host-ID Chrome extension (content script). */
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.sheetscrmReady = "1";
    if (selected) {
      root.dataset.sheetscrmTicketRowId = selected.rowId;
      root.dataset.sheetscrmReservationCode = selected.reservationCode?.trim() || "";
      root.dataset.sheetscrmOrigin = window.location.origin;
    } else {
      delete root.dataset.sheetscrmTicketRowId;
      delete root.dataset.sheetscrmReservationCode;
      delete root.dataset.sheetscrmOrigin;
    }
    return () => {
      delete root.dataset.sheetscrmReady;
      delete root.dataset.sheetscrmTicketRowId;
      delete root.dataset.sheetscrmReservationCode;
      delete root.dataset.sheetscrmOrigin;
    };
  }, [selected]);

  useEffect(() => {
    function onHostIdSaved(event: Event) {
      const detail = (event as CustomEvent<{ rowId?: string; hostId?: string }>).detail;
      const rowId = detail?.rowId?.trim();
      const hostId = detail?.hostId?.trim();
      if (!rowId || !hostId) return;
      setTickets((prev) =>
        prev.map((t) => {
          if (t.rowId !== rowId) return t;
          const rawKey =
            Object.keys(t.raw).find((k) => /airbnb\s*user\s*id/i.test(k)) || "Airbnb User ID";
          return {
            ...t,
            crmAirbnbUserId: hostId,
            airbnbUserIdExempt: false,
            airbnbUserId: hostId,
            raw: { ...t.raw, [rawKey]: hostId },
          };
        })
      );
    }
    window.addEventListener("sheetscrm:host-id-saved", onHostIdSaved);
    return () => window.removeEventListener("sheetscrm:host-id-saved", onHostIdSaved);
  }, []);

  const activeSheetConfig = useMemo(() => {
    if (selected) {
      return resolveSheetConfigForTicket(selected.rowId, config, coverSheets) ?? config;
    }
    return config;
  }, [selected, config, coverSheets]);

  const columnLabels = useMemo(() => {
    if (!activeSheetConfig) {
      return {
        airbnbUserId: null as string | null,
        columnD: null as string | null,
        reservationCode: null as string | null,
        claimNumber: null as string | null,
        listingId: null as string | null,
      };
    }
    const byRole = (role: SheetConfig["columns"][number]["role"]) =>
      columnDisplayLabel(activeSheetConfig.columns.find((c) => c.role === role)) || null;
    return {
      airbnbUserId: byRole("airbnbUserId"),
      columnD: byRole("email"),
      reservationCode: byRole("reservationCode"),
      claimNumber: byRole("claimNumber"),
      listingId: byRole("listingId"),
    };
  }, [activeSheetConfig]);

  const filtered = useMemo(
    () =>
      buildFilteredTicketList({
        tickets,
        statusFilter,
        search,
        sortBy,
        sortOrder,
        dashboardFilter,
        qualityFilters,
      }),
    [tickets, statusFilter, search, sortBy, sortOrder, dashboardFilter, qualityFilters]
  );

  function handleQualityFilterToggle(filter: TicketQualityFilter) {
    setQualityFilters((prev) =>
      prev.includes(filter) ? prev.filter((item) => item !== filter) : [...prev, filter]
    );
  }

  useEffect(() => {
    if (!prefsLoaded || loading || initialSelectionDone.current) return;

    initialSelectionDone.current = true;
    setSelectedId(filtered.length > 0 ? filtered[0].rowId : null);
  }, [prefsLoaded, loading, filtered]);

  function persistPreferences(patch: Partial<UserPreferences>) {
    prefsRef.current = { ...prefsRef.current, ...patch };
    void patchUserPreferences(patch).catch(() => {
      /* keep local UI state; will retry on next save */
    });
  }

  function handleSortByChange(by: UserPreferences["sortBy"]) {
    setSortBy(by);
    persistPreferences({ sortBy: by });
  }

  function handleSortOrderChange(order: UserPreferences["sortOrder"]) {
    setSortOrder(order);
    persistPreferences({ sortOrder: order });
  }

  function handleListSortCycle(next: {
    sortBy: UserPreferences["sortBy"];
    sortOrder: UserPreferences["sortOrder"];
  }) {
    setSortBy(next.sortBy);
    setSortOrder(next.sortOrder);
    persistPreferences({ sortBy: next.sortBy, sortOrder: next.sortOrder });
  }

  function handleDashboardRollingPeriodChange(period: RollingDashboardPeriod) {
    setLastRollingDashboardPeriod(period);
    setDashboardPeriod(period);
    persistPreferences({ dashboardPeriod: period });
  }

  function handleDashboardCalendarMonthChange(monthKey: string) {
    if (monthKey) {
      const period = dashboardPeriodFromCalendarMonthKey(monthKey);
      if (!period) return;
      setDashboardPeriod(period);
      persistPreferences({ dashboardPeriod: period });
      return;
    }
    setDashboardPeriod(lastRollingDashboardPeriod);
    persistPreferences({ dashboardPeriod: lastRollingDashboardPeriod });
  }

  function handlePreferencesSaved(prefs: UserPreferences) {
    prefsRef.current = prefs;
    setMappingWarnings(
      filterActiveMappingWarnings(
        rawMappingWarningsRef.current,
        prefs.dismissedMappingWarningsFingerprint
      )
    );
    configureNotificationSounds(prefs);
    setStatusFilter(prefs.defaultStatusFilter);
    setSortBy(prefs.sortBy);
    setSortOrder(prefs.sortOrder);
    setDashboardPeriod(prefs.dashboardPeriod);
    if (isRollingDashboardPeriod(prefs.dashboardPeriod)) {
      setLastRollingDashboardPeriod(prefs.dashboardPeriod);
    }
    setErrorLoggingEnabled(prefs.errorLoggingEnabled);
    setCrmErrorLoggingEnabled(prefs.errorLoggingEnabled);
    setInitialResponseHours(prefs.initialResponseHours);
    setExternalTools(prefs.externalTools);
    setRecentSendsPanelEnabled(prefs.recentSendsPanelEnabled);
    setCalendarReminderFullscreen(prefs.calendarReminderFullscreen);
    setCaseBreaksEnabled(prefs.caseBreaksEnabled);
    setCaseBreakThreshold(prefs.caseBreakThreshold);
    setWellnessContentIds(prefs.wellnessContentIds);
    setPomodoroBreaksEnabled(prefs.pomodoroBreaksEnabled);
    setPomodoroScheduleId(prefs.pomodoroScheduleId);
    setPreferencesOpen(false);
    void loadTickets({ silent: true, reason: "manual" });
  }

  async function dismissMappingWarnings() {
    const fingerprint = mappingWarningsFingerprint(rawMappingWarningsRef.current);
    prefsRef.current = {
      ...prefsRef.current,
      dismissedMappingWarningsFingerprint: fingerprint,
    };
    setMappingWarnings([]);
    try {
      await patchUserPreferences({ dismissedMappingWarningsFingerprint: fingerprint });
    } catch {
      /* banner already hidden locally */
    }
  }

  const ticketUiFields = useMemo(() => {
    if (!activeSheetConfig || !selected) return [];
    return getMappedUiFieldSlots(activeSheetConfig).map((slot) => {
      const col = activeSheetConfig.columns.find((c) => c.index === slot.columnIndex);
      return {
        slotId: slot.id,
        label: uiFieldDisplayLabel(slot, col),
        value: selected.uiFields?.[slot.id] ?? "",
      };
    });
  }, [activeSheetConfig, selected]);

  const counts = useMemo(() => {
    const map: Record<string, number> = { all: tickets.length };
    DEFAULT_STATUSES.forEach((s) => {
      map[s.id] = tickets.filter((t) => t.status === s.id).length;
    });
    return map;
  }, [tickets]);

  async function handleStatusChange(
    rowId: string,
    status: string,
    options?: { closeOutcome?: CloseOutcomeAnswers }
  ) {
    const snapshot = tickets;
    const ticket = tickets.find((t) => t.rowId === rowId);
    const closeFields = options?.closeOutcome
      ? ticketFieldsFromCloseOutcome(options.closeOutcome)
      : null;
    const optimistic = tickets.map((t) =>
      t.rowId === rowId
        ? {
            ...buildOptimisticStatusFields(t, status, prefsRef.current.defaultSlaHours),
            ...(closeFields ?? {}),
          }
        : t
    );
    setTickets(optimistic);

    const started = performance.now();
    try {
      const res = await fetch(`/api/tickets/${encodeURIComponent(rowId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rowId,
          status,
          intakeTimestamp: ticket?.timestamp,
          requesterEmail: ticket?.requesterEmail,
          ...(options?.closeOutcome ? { closeOutcome: options.closeOutcome } : {}),
        }),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        throw new Error(data.error ?? "Failed to update status");
      }

      const nextStatus = data.status ?? status;
      const rowNumber = tickets.find((t) => t.rowId === rowId)?.rowNumber;
      logCrmTiming(
        "Status update",
        performance.now() - started,
        `${formatCrmRowRef(rowNumber, rowId)} → ${nextStatus}${
          data.sheetSyncQueued ? " · sheet sync queued" : ""
        }`
      );
      const nextSheetStatus = data.sheetStatus as string | undefined;
      const nextTickets = optimistic.map((t) => {
        if (t.rowId !== rowId) return t;
        const withStatus = applyPendingStatusTimerFields(t, {
          status: nextStatus,
          statusChangedAt: data.statusChangedAt as string | null | undefined,
          slaDueAt: data.slaDueAt as string | null | undefined,
        });
        return {
          ...withStatus,
          sheetStatus: nextSheetStatus ?? withStatus.sheetStatus,
        };
      });
      setTickets(nextTickets);
      if (closeFields) rememberPendingSheetFields(rowId, closeFields);

      const advanced = advanceAfterSend(rowId, status as "pending" | "resolved", nextTickets);
      if (!advanced) {
        showInboxVictory();
      }
    } catch (error) {
      setTickets(snapshot);
      logCrmError("Status update failed", error);
      throw error;
    }
  }

  function ticketsAfterSend(
    ticketList: Ticket[],
    rowId: string,
    statusAfterSend: string
  ): Ticket[] {
    return ticketList.map((t) =>
      t.rowId === rowId
        ? buildOptimisticStatusFields(t, statusAfterSend, prefsRef.current.defaultSlaHours)
        : t
    );
  }

  function applySendHandoff(
    rowId: string,
    ticketList: Ticket[],
    options?: { showVictoryWhenDone?: boolean }
  ): boolean {
    const result = pickNextTicketAfterSend({
      tickets: ticketList,
      sentRowId: rowId,
      statusFilter,
      search,
      sortBy,
      sortOrder,
      dashboardFilter,
      qualityFilters,
    });

    if (result.kind === "victory") {
      if (options?.showVictoryWhenDone !== false) {
        showInboxVictory();
      }
      return false;
    }

    setInboxVictory(false);
    if (result.statusFilter) setStatusFilter(result.statusFilter);
    const nextTicket = ticketList.find((ticket) => ticket.rowId === result.rowId);
    if (nextTicket) {
      setAutoAdvanceCue({
        rowId: nextTicket.rowId,
        rowNumber: nextTicket.rowNumber,
        requesterName: nextTicket.requesterName,
        requesterEmail: nextTicket.requesterEmail,
      });
    }
    setSelectedId(result.rowId);
    return true;
  }

  function advanceAfterSend(
    rowId: string,
    statusAfterSend: string,
    ticketsSnapshot?: Ticket[]
  ): boolean {
    if (statusAfterSend === "unchanged") return true;
    const ticketList = ticketsAfterSend(ticketsSnapshot ?? tickets, rowId, statusAfterSend);
    return applySendHandoff(rowId, ticketList, { showVictoryWhenDone: false });
  }

  function showInboxVictory() {
    setInboxVictory(true);
    setSelectedId(null);
  }

  function restoreSentTicket(rowId: string, compose?: QueuedSendPayload) {
    setInboxVictory(false);
    setSelectedId(rowId);
    if (compose && compose.ticketRowId === rowId) {
      setComposeRestore(compose);
    }
  }

  async function handleTicketSent(
    rowId: string,
    status: "pending" | "resolved" | "unchanged",
    closeOutcome?: CloseOutcomeAnswers
  ) {
    if (status === "unchanged") {
      setComposeClearedRowId(rowId);
      return;
    }

    const closeFields = closeOutcome ? ticketFieldsFromCloseOutcome(closeOutcome) : null;
    if (closeFields) rememberPendingSheetFields(rowId, closeFields);
    const nextTickets = ticketsAfterSend(tickets, rowId, status).map((t) =>
      t.rowId === rowId && status === "resolved"
        ? { ...t, resolvedClosed: false, ...(closeFields ?? {}) }
        : t
    );
    setTickets(nextTickets);
    setComposeClearedRowId(rowId);

    if (selectedIdRef.current === rowId) {
      applySendHandoff(rowId, nextTickets);
    }
  }

  const handleGmailLinkChange = useCallback((rowId: string, gmailOpenUrl: string | null) => {
    setTickets((prev) =>
      prev.map((t) => (t.rowId === rowId ? { ...t, gmailOpenUrl } : t))
    );
  }, []);

  const handleForceNewGmailThreadChange = useCallback((rowId: string, enabled: boolean) => {
    setTickets((prev) =>
      prev.map((t) =>
        t.rowId === rowId
          ? {
              ...t,
              forceNewGmailThreadOnSend: enabled,
              gmailOpenUrl: enabled ? null : t.gmailOpenUrl,
              ...(enabled
                ? { subject: "", crmSubjectLabel: "" }
                : {}),
            }
          : t
      )
    );
  }, []);

  const handleAdminNotesChange = useCallback((rowId: string, adminNotes: string) => {
    setTickets((prev) =>
      prev.map((t) =>
        t.rowId === rowId ? { ...t, adminNotes, sheetCaseSummary: adminNotes } : t
      )
    );
  }, []);

  const handleThreadUpdate = useCallback(() => {
    scheduleTicketsRefresh({ silent: true });
  }, [scheduleTicketsRefresh]);

  const pendingSendQueue = usePendingSendQueue({
    onTicketSent: handleTicketSent,
    onAdvanceAfterSend: advanceAfterSend,
    onShowInboxVictory: showInboxVictory,
    onRestoreSentTicket: restoreSentTicket,
    onThreadUpdate: handleThreadUpdate,
    onSendSucceeded: () => {
      caseBreakWellness.recordSuccessfulSend();
    },
  });

  function handleSelectTicket(rowId: string) {
    setInboxVictory(false);
    setAutoAdvanceCue(null);
    setSelectedId(rowId);
  }

  async function handleSetStatusWithoutEmail(
    rowId: string,
    status: string,
    options?: {
      adminNote?: string;
      pendingHours?: number;
      airbnbUserId?: string;
      airbnbUserIdExempt?: boolean;
      closeTicket?: boolean;
      closeOutcome?: CloseOutcomeAnswers;
    }
  ) {
    const closeFields = options?.closeOutcome
      ? ticketFieldsFromCloseOutcome(options.closeOutcome)
      : null;
    if (source === "mock") {
      const now = new Date().toISOString();
      const nextTickets = tickets.map((t) => {
        if (t.rowId !== rowId) return t;
        const adminNotes = options?.adminNote
          ? appendAdminNoteToText(t.adminNotes, options.adminNote)
          : t.adminNotes;
        const slaHours = t.slaHours || prefsRef.current.defaultSlaHours;
        const timerFields =
          status === "pending" || status === "longterm_hold"
            ? {
                statusChangedAt: now,
                slaDueAt: null,
              }
            : {};
        const withStatus = applyPendingStatusTimerFields(t, { status, ...timerFields });
        return {
          ...withStatus,
          adminNotes,
          sheetCaseSummary: adminNotes,
          ...(closeFields ?? {}),
        };
      });
      setTickets(nextTickets);
      const advanced = advanceAfterSend(rowId, status, nextTickets);
      if (!advanced) showInboxVictory();
      return;
    }

    const snapshot = tickets;
    const ticket = tickets.find((t) => t.rowId === rowId);
    const optimistic = tickets.map((t) => {
      if (t.rowId !== rowId) return t;
      const adminNotes = options?.adminNote
        ? appendAdminNoteToText(t.adminNotes, options.adminNote)
        : t.adminNotes;
      const withStatus = buildOptimisticStatusFields(
        t,
        status,
        prefsRef.current.defaultSlaHours
      );
      return {
        ...withStatus,
        adminNotes,
        sheetCaseSummary: adminNotes,
        ...(closeFields ?? {}),
      };
    });
    setTickets(optimistic);

    const started = performance.now();
    try {
      const res = await fetch(`/api/tickets/${encodeURIComponent(rowId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rowId,
          status,
          intakeTimestamp: ticket?.timestamp,
          requesterEmail: ticket?.requesterEmail,
          ...(options?.adminNote ? { appendAdminNote: options.adminNote } : {}),
          ...(typeof options?.pendingHours === "number"
            ? { pendingReopenHours: options.pendingHours }
            : {}),
          ...(options?.closeTicket ? { closeTicket: true } : {}),
          ...(options?.closeOutcome ? { closeOutcome: options.closeOutcome } : {}),
          ...(options?.airbnbUserIdExempt
            ? { airbnbUserIdExempt: true }
            : options?.airbnbUserId
              ? { airbnbUserId: options.airbnbUserId }
              : {}),
        }),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        throw new Error(data.error || "Failed to update ticket status");
      }

      const rowNumber = tickets.find((t) => t.rowId === rowId)?.rowNumber;
      logCrmTiming(
        "Set status without email",
        performance.now() - started,
        `${formatCrmRowRef(rowNumber, rowId)} → ${(data.status as string | undefined) ?? status}${
          data.sheetSyncQueued ? " · sheet sync queued" : ""
        }`
      );

      const nextStatus = (data.status as string | undefined) ?? status;
      const nextTickets = optimistic.map((t) => {
        if (t.rowId !== rowId) return t;
        const withStatus = applyPendingStatusTimerFields(t, {
          status: nextStatus,
          statusChangedAt: data.statusChangedAt as string | null | undefined,
          slaDueAt: data.slaDueAt as string | null | undefined,
        });
        return {
          ...withStatus,
          resolvedClosed: options?.closeTicket ? true : withStatus.resolvedClosed,
          sheetStatus: (data.sheetStatus as string | undefined) ?? withStatus.sheetStatus,
          adminNotes: data.adminNotes ?? withStatus.adminNotes,
          sheetCaseSummary: data.adminNotes ?? withStatus.sheetCaseSummary,
        };
      });
      setTickets(nextTickets);
      if (closeFields) rememberPendingSheetFields(rowId, closeFields);

      const advanced = advanceAfterSend(rowId, nextStatus, nextTickets);
      if (!advanced) showInboxVictory();
    } catch (error) {
      setTickets(snapshot);
      logCrmError("Set status without email failed", error);
      throw error;
    }
  }

  async function handleAppendAdminNote(rowId: string, note: string) {
    const snapshot = tickets;
    const optimistic = tickets.map((t) => {
      if (t.rowId !== rowId) return t;
      const updated = appendAdminNoteToText(t.adminNotes, note);
      return { ...t, adminNotes: updated, sheetCaseSummary: updated };
    });
    setTickets(optimistic);

    const started = performance.now();
    try {
      const res = await fetch(`/api/tickets/${encodeURIComponent(rowId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rowId, appendAdminNote: note }),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        throw new Error(data.error || "Failed to add admin note");
      }

      const rowNumber = tickets.find((t) => t.rowId === rowId)?.rowNumber;
      const preview =
        typeof data.adminNotes === "string"
          ? data.adminNotes.split("\n").pop()?.trim().slice(0, 60)
          : note.trim().slice(0, 60);
      logCrmTiming(
        "Admin note",
        performance.now() - started,
        `${formatCrmRowRef(rowNumber, rowId)} · "${preview ?? note.trim()}"${
          data.sheetSyncQueued ? " · sheet sync queued" : ""
        }`
      );

      if (data.adminNotes) {
        setTickets((prev) =>
          prev.map((t) =>
            t.rowId === rowId
              ? { ...t, adminNotes: data.adminNotes, sheetCaseSummary: data.adminNotes }
              : t
          )
        );
      }
    } catch (error) {
      setTickets(snapshot);
      logCrmError("Admin note failed", error);
      throw error;
    }
  }

  async function handleAirbnbUserIdChange(
    rowId: string,
    airbnbUserId: string,
    options?: { exempt?: boolean }
  ) {
    const res = await fetch(`/api/tickets/${encodeURIComponent(rowId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        rowId,
        ...(options?.exempt
          ? { airbnbUserIdExempt: true }
          : { airbnbUserId }),
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.error) {
      throw new Error(data.error || "Failed to update Airbnb User ID on sheet");
    }

    setTickets((prev) =>
      prev.map((t) => {
        if (t.rowId !== rowId) return t;
        if (options?.exempt) {
          return {
            ...t,
            crmAirbnbUserId: null,
            airbnbUserIdExempt: true,
            airbnbUserId: intakeAirbnbUserIdFromTicket(t),
          };
        }
        const trimmed = airbnbUserId.trim();
        const rawKey =
          Object.keys(t.raw).find((k) => /airbnb\s*user\s*id/i.test(k)) || "Airbnb User ID";
        return {
          ...t,
          crmAirbnbUserId: trimmed || null,
          airbnbUserIdExempt: false,
          airbnbUserId: trimmed || intakeAirbnbUserIdFromTicket(t),
          raw: trimmed ? { ...t.raw, [rawKey]: trimmed } : t.raw,
        };
      })
    );
  }

  async function handleReservationCodeChange(rowId: string, reservationCode: string) {
    setTickets((prev) =>
      prev.map((t) => (t.rowId === rowId ? { ...t, reservationCode } : t))
    );
    rememberPendingSheetFields(rowId, { reservationCode });
    await fetch(`/api/tickets/${encodeURIComponent(rowId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rowId, reservationCode }),
    });
  }

  async function handleClaimNumberChange(rowId: string, claimNumber: string) {
    setTickets((prev) => prev.map((t) => (t.rowId === rowId ? { ...t, claimNumber } : t)));
    rememberPendingSheetFields(rowId, { claimNumber });
    await fetch(`/api/tickets/${encodeURIComponent(rowId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rowId, claimNumber }),
    });
  }

  async function handleListingIdChange(rowId: string, listingId: string) {
    setTickets((prev) => prev.map((t) => (t.rowId === rowId ? { ...t, listingId } : t)));
    rememberPendingSheetFields(rowId, { listingId });
    await fetch(`/api/tickets/${encodeURIComponent(rowId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rowId, listingId }),
    });
  }

  async function handleUiFieldChange(rowId: string, slotId: string, value: string) {
    await fetch(`/api/tickets/${encodeURIComponent(rowId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rowId, uiFieldSlotId: slotId, uiFieldValue: value }),
    });
    setTickets((prev) =>
      prev.map((t) => {
        if (t.rowId !== rowId) return t;
        const uiFields = { ...(t.uiFields ?? {}), [slotId]: value };
        const headerField = slotId === "ui-1" ? value : t.headerField;
        return { ...t, uiFields, headerField };
      })
    );
  }

  async function handleLinkedCaseChange(
    rowId: string,
    index: 0 | 1 | 2,
    linkedCaseUrl: string
  ) {
    const rowNumber = tickets.find((t) => t.rowId === rowId)?.rowNumber;
    const started = performance.now();
    const res = await fetch(`/api/tickets/${encodeURIComponent(rowId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rowId, linkedCaseIndex: index, linkedCaseUrl }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.error) {
      logCrmError(
        "Linked case save failed",
        `${formatCrmRowRef(rowNumber, rowId)} · case ${index + 1} — ${
          data.error ?? `HTTP ${res.status}`
        }`
      );
      throw new Error(data.error ?? "Failed to save linked case");
    }
    const linked = parseLinkedCase(linkedCaseUrl);
    const preview = linked.label || linked.url?.slice(0, 60) || "";
    logCrmTiming(
      "Linked case save",
      performance.now() - started,
      `${formatCrmRowRef(rowNumber, rowId)} · case ${index + 1}${
        preview ? ` · "${preview}"` : " · cleared"
      }`
    );
    setTickets((prev) =>
      prev.map((t) => {
        if (t.rowId !== rowId) return t;
        const linkedCases = [...t.linkedCases] as [string, string, string];
        linkedCases[index] = linkedCaseUrl;
        return { ...t, linkedCases };
      })
    );
  }

  async function handleSubjectChange(rowId: string, subject: string) {
    try {
      const res = await fetch(`/api/tickets/${encodeURIComponent(rowId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rowId, subject }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok || data.error) {
        setSyncError(data.error ?? "Could not save the subject");
        return;
      }
      setSyncError(null);
      setTickets((prev) =>
        prev.map((t) =>
          t.rowId === rowId
            ? { ...t, subject, crmSubjectLabel: crmSubjectLabelFromStored(subject) }
            : t
        )
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      setSyncError(
        message === "Failed to fetch"
          ? "Could not save the subject — the CRM server did not respond. Try again."
          : "Could not save the subject"
      );
      logCrmError("Subject save failed", error);
    }
  }

  async function handleContactReasonChange(rowId: string, contactReason: string) {
    const res = await fetch(`/api/tickets/${encodeURIComponent(rowId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rowId, contactReason }),
    });
    const data = await res.json();
    if (!res.ok || data.error) {
      setSyncError(data.error ?? "Failed to update contact reason on sheet");
      return;
    }
    setSyncError(null);
    setTickets((prev) =>
      prev.map((t) => (t.rowId === rowId ? { ...t, contactReason } : t))
    );
  }

  function handleDashboardFilter(filter: DashboardFilter) {
    setDashboardFilter(Object.keys(filter).length > 0 ? filter : null);
    setActiveView("tickets");
    setStatusFilter("all");
  }

  const activeFilterLabel = dashboardFilterLabel(dashboardFilter);

  async function handleSlaChange(rowId: string, slaHours: number) {
    const ticket = tickets.find((t) => t.rowId === rowId);
    const res = await fetch(`/api/tickets/${encodeURIComponent(rowId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        rowId,
        slaHours,
        intakeTimestamp: ticket?.timestamp,
      }),
    });
    const data = await res.json();
    const slaDueAt = (data.slaDueAt as string | null | undefined) ?? null;
    setTickets((prev) =>
      prev.map((t) =>
        t.rowId === rowId
          ? {
              ...t,
              slaHours,
              slaDueAt,
              slaBreached: slaDueAt ? new Date(slaDueAt) < new Date() : false,
            }
          : t
      )
    );
  }

  async function handleClearInitialResponseSla(rowId: string) {
    await fetch(`/api/tickets/${encodeURIComponent(rowId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rowId, clearInitialResponseSla: true }),
    });
    setTickets((prev) =>
      prev.map((t) => (t.rowId === rowId ? { ...t, needsInitialResponse: false } : t))
    );
  }

  async function handleResyncFromSheet(rowId: string) {
    const res = await fetch(`/api/tickets/${encodeURIComponent(rowId)}/resync-sheet`, {
      method: "POST",
    });
    const data = (await res.json()) as { ticket?: Ticket; error?: string };
    if (!res.ok || !data.ticket) {
      throw new Error(data.error ?? "Failed to resync from sheet");
    }
    setTickets((prev) => prev.map((t) => (t.rowId === rowId ? data.ticket! : t)));
  }

  async function handleIgnoreCoverTicket(rowId: string) {
    const snapshot = tickets;
    const optimistic = tickets.map((t) =>
      t.rowId === rowId
        ? buildOptimisticStatusFields(t, "resolved", prefsRef.current.defaultSlaHours)
        : t
    );
    setTickets(optimistic);

    try {
      const res = await fetch(`/api/tickets/${encodeURIComponent(rowId)}/ignore-cover`, {
        method: "POST",
      });
      const data = (await res.json()) as {
        error?: string;
        status?: string;
        statusChangedAt?: string | null;
        slaDueAt?: string | null;
      };
      if (!res.ok || data.error) {
        throw new Error(data.error ?? "Failed to ignore cover ticket");
      }

      const nextTickets = optimistic.map((t) => {
        if (t.rowId !== rowId) return t;
        return applyPendingStatusTimerFields(t, {
          status: data.status ?? "resolved",
          statusChangedAt: data.statusChangedAt,
          slaDueAt: data.slaDueAt,
        });
      });
      setTickets(nextTickets);

      const advanced = advanceAfterSend(rowId, "resolved", nextTickets);
      if (!advanced) {
        showInboxVictory();
      }
    } catch (error) {
      setTickets(snapshot);
      logCrmError("Ignore cover ticket failed", error);
      throw error;
    }
  }

  return (
    <div className="flex h-screen flex-col bg-white">
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-zendesk-border bg-zendesk-navy px-4 text-white">
        <div className="flex items-center gap-3">
          <span className="text-lg font-semibold tracking-tight">SheetsCRM</span>
          <span className="rounded bg-white/10 px-2 py-0.5 text-xs text-white/80">
            {source === "mock"
              ? "Demo data"
              : source === "unauthenticated"
                ? "Not signed in"
                : "Live sheet"}
          </span>
          {source === "sheets" && (
            <span className="hidden items-center gap-2 text-xs text-white/60 sm:inline-flex">
              {syncing ? (
                "Syncing…"
              ) : syncError ? (
                <span className="text-amber-200">{syncError}</span>
              ) : lastSyncedAt ? (
                <>
                  <span>Next refresh in {secondsUntilRefresh}s</span>
                  <button
                    type="button"
                    onClick={() => void loadTickets({ silent: true, reason: "manual" })}
                    className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-white/10"
                    title="Refresh now"
                  >
                    <RefreshCw className="h-3 w-3" />
                  </button>
                </>
              ) : null}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {auth.signedIn ? (
            <>
              <span className="hidden text-xs text-white/70 sm:inline">{auth.email}</span>
              <button
                type="button"
                onClick={handleSignOut}
                className="flex items-center gap-1 rounded px-2 py-1 text-xs hover:bg-white/10"
                title="Sign out"
              >
                <LogOut className="h-4 w-4" />
                Sign out
              </button>
            </>
          ) : (
            <a
              href="/api/auth/google"
              className="flex items-center gap-1 rounded bg-white/15 px-3 py-1.5 text-xs font-medium hover:bg-white/25"
            >
              <LogIn className="h-4 w-4" />
              Sign in with Google
            </a>
          )}
          <button
            type="button"
            onClick={() => setHelpOpen(true)}
            className="rounded p-2 hover:bg-white/10"
            title="CRM help"
            aria-label="Open CRM help overlay"
          >
            <CircleHelp className="h-5 w-5" />
          </button>
          <button
            type="button"
            onClick={() => setPreferencesOpen(true)}
            className="rounded p-2 hover:bg-white/10"
            title="View preferences"
            aria-label="View preferences"
          >
            <SlidersHorizontal className="h-5 w-5" />
          </button>
          <button
            type="button"
            onClick={() => openSetup("sheet")}
            className="rounded p-2 hover:bg-white/10"
            title="Sheet setup"
            aria-label="Sheet setup"
          >
            <Settings className="h-5 w-5" />
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <ResizableColumn
          width={sidebarWidthState.width}
          minWidth={sidebarWidthState.minWidth}
          maxWidth={sidebarWidthState.maxWidth}
          onWidthChange={sidebarWidthState.setWidth}
          collapsed={viewsCollapsed}
        >
          <Sidebar
            activeView={activeView}
            onViewChange={setActiveView}
            statusFilter={statusFilter}
            onStatusFilter={setStatusFilter}
            counts={counts}
            collapsed={viewsCollapsed}
            onToggleCollapsed={() => setViewsCollapsed((v) => !v)}
            fontScale={sidebarWidthState.fontScale}
            calendarEnabled={auth.signedIn && auth.method === "oauth" && source !== "mock"}
            onOpenUnreadInbox={() => setUnreadInboxOpen(true)}
          />
        </ResizableColumn>
        {activeView === "dashboard" ? (
          <DashboardView
            tickets={tickets}
            loading={loading || !prefsLoaded}
            period={dashboardPeriod}
            rollingPeriod={
              isRollingDashboardPeriod(dashboardPeriod)
                ? dashboardPeriod
                : lastRollingDashboardPeriod
            }
            calendarMonth={calendarMonthKeyFromPeriod(dashboardPeriod) ?? ""}
            onRollingPeriodChange={handleDashboardRollingPeriodChange}
            onCalendarMonthChange={handleDashboardCalendarMonthChange}
            onFilter={handleDashboardFilter}
            userEmail={auth.email}
            canSendEmail={auth.signedIn && auth.method === "oauth" && source !== "mock"}
            onRefreshTickets={() => loadTickets({ silent: true, reason: "manual" })}
          />
        ) : activeView === "team-dashboard" ? (
          <TeamDashboardView
            tickets={tickets}
            loading={loading || !prefsLoaded}
            period={dashboardPeriod}
            rollingPeriod={
              isRollingDashboardPeriod(dashboardPeriod)
                ? dashboardPeriod
                : lastRollingDashboardPeriod
            }
            calendarMonth={calendarMonthKeyFromPeriod(dashboardPeriod) ?? ""}
            onRollingPeriodChange={handleDashboardRollingPeriodChange}
            onCalendarMonthChange={handleDashboardCalendarMonthChange}
            userEmail={auth.email}
            canSendEmail={auth.signedIn && auth.method === "oauth" && source !== "mock"}
            onRefreshTickets={() => loadTickets({ silent: true, reason: "manual" })}
          />
        ) : (
          <div className="flex min-w-0 flex-1 flex-col">
        {activeFilterLabel && (
          <div className="flex shrink-0 items-center gap-2 border-b border-zendesk-border bg-amber-50 px-4 py-2 text-xs text-amber-900">
            <span>Dashboard filter: {activeFilterLabel}</span>
            <button
              type="button"
              onClick={() => setDashboardFilter(null)}
              className="rounded border border-amber-200 px-2 py-0.5 hover:bg-amber-100"
            >
              Clear
            </button>
          </div>
        )}
        {mappingWarnings.length > 0 && (
          <div className="shrink-0 border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-950">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <p className="font-medium">Column mapping warnings</p>
                <p className="mt-0.5 text-amber-900/90">
                  Headers are remapped automatically when possible after sheet columns move. Use{" "}
                  <button
                    type="button"
                    onClick={() => openSetup("sheet")}
                    className="font-medium underline hover:no-underline"
                  >
                    Setup → Detect columns
                  </button>{" "}
                  to review, or ignore if your mapping is intentional (e.g. duplicate headers).
                </p>
              </div>
              <button
                type="button"
                onClick={() => void dismissMappingWarnings()}
                className="shrink-0 rounded border border-amber-300 bg-white px-2 py-1 text-xs font-medium text-amber-950 hover:bg-amber-100"
              >
                Ignore warnings
              </button>
            </div>
            <ul className="mt-1.5 list-disc space-y-0.5 pl-4">
              {mappingWarnings.slice(0, 6).map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
            {mappingWarnings.length > 6 && (
              <p className="mt-1 text-amber-900/80">
                +{mappingWarnings.length - 6} more warning
                {mappingWarnings.length - 6 === 1 ? "" : "s"}
              </p>
            )}
          </div>
        )}
        <div className="flex min-h-0 flex-1">
        <ResizableColumn
          width={ticketListWidthState.width}
          minWidth={ticketListWidthState.minWidth}
          maxWidth={ticketListWidthState.maxWidth}
          onWidthChange={ticketListWidthState.setWidth}
          collapsed={ticketListCollapsed}
        >
          <TicketList
            tickets={filtered}
            selectedId={selectedId}
            onSelect={handleSelectTicket}
            search={search}
            onSearch={setSearch}
            loading={loading || !prefsLoaded}
            sortBy={sortBy}
            onSortByChange={handleSortByChange}
            sortOrder={sortOrder}
            onSortOrderChange={handleSortOrderChange}
            onListSortCycle={handleListSortCycle}
            qualityFilters={qualityFilters}
            onQualityFilterToggle={handleQualityFilterToggle}
            collapsed={ticketListCollapsed}
            onToggleCollapsed={() => setTicketListCollapsed((v) => !v)}
            initialResponseHours={initialResponseHours}
            fontScale={ticketListWidthState.fontScale}
            emptyMessage={
              source === "unauthenticated"
                ? "Sign in with Google to load your sheet."
                : "No tickets match this view."
            }
          />
        </ResizableColumn>
        {inboxVictory ? (
          <InboxVictoryView />
        ) : (
          <TicketDetailTransition
            ticketKey={selected?.rowId ?? null}
            loadedCue={
              autoAdvanceCue && autoAdvanceCue.rowId === selected?.rowId
                ? autoAdvanceCue
                : null
            }
            onLoadedCueComplete={() => setAutoAdvanceCue(null)}
          >
            <TicketDetail
              key={selected?.rowId ?? "none"}
              ticket={selected}
              initialResponseHours={initialResponseHours}
              contactReasonOptions={contactReasonOptions}
              onStatusChange={handleStatusChange}
              sendQueueBusy={pendingSendQueue.sendQueueBusy}
              isSending={
                pendingSendQueue.sending &&
                pendingSendQueue.sendingTicketRowId === selected?.rowId
              }
              sendError={
                pendingSendQueue.sendError &&
                pendingSendQueue.sendError.rowId === selected?.rowId
                  ? pendingSendQueue.sendError.message
                  : null
              }
              onQueueSend={pendingSendQueue.queueSend}
              pendingSendUndo={
                pendingSendQueue.pendingSend
                  ? {
                      active: true,
                      secondsLeft: pendingSendQueue.undoSecondsLeft,
                      label: pendingSendQueue.queuedSendLabel,
                      status: pendingSendQueue.pendingSendStatus,
                      attachmentCount: pendingSendQueue.queuedAttachmentCount,
                      onUndo: pendingSendQueue.undoSend,
                    }
                  : undefined
              }
              composeClearedRowId={composeClearedRowId}
              onComposeCleared={() => setComposeClearedRowId(null)}
              composeRestore={
                composeRestore && composeRestore.ticketRowId === selected?.rowId
                  ? composeRestore
                  : null
              }
              onComposeRestoreApplied={() => setComposeRestore(null)}
              onClearSendError={() => pendingSendQueue.clearSendError(selected?.rowId ?? undefined)}
              onSetStatusWithoutEmail={handleSetStatusWithoutEmail}
              onSubjectChange={handleSubjectChange}
              onContactReasonChange={handleContactReasonChange}
              onAppendAdminNote={handleAppendAdminNote}
              onAdminNotesChange={handleAdminNotesChange}
              onAirbnbUserIdChange={handleAirbnbUserIdChange}
              onReservationCodeChange={handleReservationCodeChange}
              onClaimNumberChange={handleClaimNumberChange}
              onListingIdChange={handleListingIdChange}
              onSlaChange={handleSlaChange}
              onClearInitialResponseSla={handleClearInitialResponseSla}
              onResyncFromSheet={handleResyncFromSheet}
              onIgnoreCoverTicket={handleIgnoreCoverTicket}
              onThreadUpdate={handleThreadUpdate}
              onGmailLinkChange={handleGmailLinkChange}
              onForceNewGmailThreadChange={handleForceNewGmailThreadChange}
              onLinkedCaseChange={handleLinkedCaseChange}
              externalTools={externalTools}
              recentSendsPanelEnabled={recentSendsPanelEnabled}
              ticketUiFields={ticketUiFields}
              onUiFieldChange={handleUiFieldChange}
              columnLabels={columnLabels}
              onOpenSetup={openSetup}
              marketManagersVersion={marketManagersVersion}
              sheetUrl={activeSheetConfig?.sheetUrl ?? null}
              emailSubjectPrefix={activeSheetConfig?.emailSubjectPrefix ?? null}
            />
          </TicketDetailTransition>
        )}
        </div>
        <CrmDebugLogPanel enabled={errorLoggingEnabled} />
          </div>
        )}
      </div>

      {calendarReminders.toast &&
        (calendarReminders.display === "fullscreen" ? (
          <CalendarReminderModal
            event={calendarReminders.toast}
            onDismiss={calendarReminders.dismissToast}
          />
        ) : (
          <div className="pointer-events-none fixed right-4 top-4 z-50">
            <CalendarReminderToast
              event={calendarReminders.toast}
              onDismiss={calendarReminders.dismissToast}
            />
          </div>
        ))}

      {caseBreakWellness.overlay && (
        <WellnessContentModal
          item={caseBreakWellness.overlay.item}
          milestoneCount={caseBreakWellness.overlay.milestoneCount}
          onDismiss={caseBreakWellness.dismiss}
        />
      )}

      {pomodoroBreaks.overlay && (
        <PomodoroBreakModal
          schedule={pomodoroBreaks.overlay}
          onDismiss={pomodoroBreaks.dismiss}
        />
      )}

      {pendingSendQueue.sending &&
        pendingSendQueue.sendingTicketRowId &&
        pendingSendQueue.sendingTicketRowId !== selected?.rowId && (
          <div className="pointer-events-none fixed bottom-16 right-4 z-40">
            <div className="max-w-md rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 shadow-lg">
              <p className="text-sm font-medium text-amber-950">Sending email…</p>
              {pendingSendQueue.queuedSendLabel && (
                <p className="mt-1 text-sm text-amber-900">{pendingSendQueue.queuedSendLabel}</p>
              )}
            </div>
          </div>
        )}

      {pendingSendQueue.sendError &&
        pendingSendQueue.sendError.rowId !== selected?.rowId && (
          <div className="pointer-events-none fixed bottom-16 right-4 z-40">
            <div className="pointer-events-auto max-w-md rounded-lg border border-red-200 bg-red-50 px-4 py-3 shadow-lg">
              <p className="text-sm font-medium text-red-900">Email not sent</p>
              <p className="mt-1 text-sm text-red-800">{pendingSendQueue.sendError.message}</p>
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    const rowId = pendingSendQueue.sendError?.rowId;
                    if (rowId) restoreSentTicket(rowId);
                  }}
                  className="rounded border border-red-300 bg-white px-2 py-1 text-xs font-medium text-red-900 hover:bg-red-100"
                >
                  Open ticket
                </button>
                <button
                  type="button"
                  onClick={() => pendingSendQueue.clearSendError()}
                  className="rounded px-2 py-1 text-xs text-red-800 hover:bg-red-100"
                >
                  Dismiss
                </button>
              </div>
            </div>
          </div>
        )}

      {preferencesOpen && (
        <PreferencesModal
          preferences={prefsRef.current}
          onClose={() => setPreferencesOpen(false)}
          onSaved={handlePreferencesSaved}
        />
      )}

      {businessHoursUpdatedOpen ? (
        <BusinessHoursUpdatedModal onClose={() => setBusinessHoursUpdatedOpen(false)} />
      ) : null}

      {setupOpen && (
        <SetupModal
          config={config}
          initialTab={setupInitialTab}
          onClose={() => {
            setSetupOpen(false);
            setMarketManagersVersion((version) => version + 1);
          }}
          onSaved={(savedConfig, meta) => {
            if (savedConfig) setConfig(savedConfig);
            setSetupOpen(false);
            setMarketManagersVersion((version) => version + 1);
            if (meta?.businessHoursUpdated) {
              setBusinessHoursUpdatedOpen(true);
            }
            void loadTickets({ reason: "setup" });
          }}
        />
      )}

      {unreadInboxOpen && (
        <UnreadInboxModal
          tickets={tickets}
          selectedTicketId={selectedId}
          bindToSelectedEnabled={prefsRef.current.unreadInboxBindToSelectedEnabled}
          appendToSelectedEnabled={prefsRef.current.unreadInboxAppendToSelectedEnabled}
          onClose={() => setUnreadInboxOpen(false)}
          onOpenTicket={(rowId) => {
            setUnreadInboxOpen(false);
            setInboxVictory(false);
            setSelectedId(rowId);
          }}
          onCreatedTicket={(rowId) => {
            setUnreadInboxOpen(false);
            setInboxVictory(false);
            void loadTickets({ reason: "manual" }).then(() => {
              setSelectedId(rowId);
            });
          }}
        />
      )}

      <HelpOverlay open={helpOpen} onClose={() => setHelpOpen(false)} />
    </div>
  );
}
