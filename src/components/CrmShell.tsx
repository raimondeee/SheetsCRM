"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LogIn, LogOut, RefreshCw, Settings, SlidersHorizontal } from "lucide-react";
import type { SheetConfig, Ticket } from "@/lib/types";
import { EXAMPLE_COLUMN_POSITIONS } from "@/lib/default-sheet-config";
import {
  columnDisplayLabel,
  getMappedUiFieldSlots,
  uiFieldDisplayLabel,
} from "@/lib/ui-field-slots";
import { DEFAULT_STATUSES } from "@/lib/types";
import { Sidebar, type AppView } from "./Sidebar";
import { TicketList } from "./TicketList";
import { TicketDetail } from "./TicketDetail";
import { TicketDetailTransition } from "./TicketDetailTransition";
import { DashboardView } from "./DashboardView";
import { SetupModal, type SetupModalTab } from "./SetupModal";
import { PreferencesModal } from "./PreferencesModal";
import { CrmDebugLogPanel } from "./CrmDebugLogPanel";
import { CalendarReminderToast } from "./CalendarReminderToast";
import { UnreadInboxModal } from "./UnreadInboxModal";
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
import { usePersistedWidth, useResponsivePanelMax } from "@/hooks/usePersistedWidth";
import { useRefreshCountdown } from "@/hooks/useRefreshCountdown";
import { useCalendarReminders } from "@/hooks/useCalendarReminders";
import { useTicketChimeUnlock } from "@/hooks/useTicketChime";
import {
  buildTicketChimeSnapshots,
  playTicketChime,
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
  saveUserPreferences,
  type UserPreferences,
} from "@/lib/user-preferences";

const AUTO_REFRESH_SECONDS =
  Number(process.env.NEXT_PUBLIC_AUTO_REFRESH_SECONDS) || 60;
const AUTO_REFRESH_MS = AUTO_REFRESH_SECONDS * 1000;
const TICKET_REFRESH_DEBOUNCE_MS = 900;

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
  const [selectedId, setSelectedId] = useState<string | null>(null);
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
  const [unreadInboxOpen, setUnreadInboxOpen] = useState(false);
  const [prefsLoaded, setPrefsLoaded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [source, setSource] = useState<string>("mock");
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
  const [countdownResetKey, setCountdownResetKey] = useState(0);
  const sourceRef = useRef(source);
  const initialSelectionDone = useRef(false);
  const loadTicketsInflightRef = useRef<Promise<void> | null>(null);
  const loadTicketsPendingRef = useRef<LoadTicketsOptions | null>(null);
  const refreshDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const selectedIdRef = useRef<string | null>(null);
  const ticketChimeSnapshotsRef = useRef<Map<string, TicketChimeSnapshot> | null>(null);
  const [composeClearedRowId, setComposeClearedRowId] = useState<string | null>(null);
  sourceRef.current = source;

  useTicketChimeUnlock();

  const secondsUntilRefresh = useRefreshCountdown(
    AUTO_REFRESH_SECONDS,
    source !== "mock",
    countdownResetKey
  );

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
          playTicketChime();
        }
        setTickets(incomingTickets);
        setConfig(data.config ?? null);
        setSource(data.source ?? "mock");
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
    auth.signedIn && auth.method === "oauth" && source !== "mock"
  );

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
    if (source === "mock") return;

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

  async function handleSignOut() {
    await fetch("/api/auth/logout", { method: "POST" });
    await loadAuth();
    await loadTickets({ reason: "manual" });
  }

  const contactReasonOptions = useMemo(
    () => buildContactReasonOptions(tickets),
    [tickets]
  );

  const columnLabels = useMemo(() => {
    if (!config) {
      return {
        airbnbUserId: null as string | null,
        columnD: null as string | null,
        reservationCode: null as string | null,
        listingId: null as string | null,
      };
    }
    const byRole = (role: SheetConfig["columns"][number]["role"]) =>
      columnDisplayLabel(config.columns.find((c) => c.role === role)) || null;
    const byIndex = (index: number) =>
      columnDisplayLabel(config.columns.find((c) => c.index === index)) || null;
    return {
      airbnbUserId: byRole("airbnbUserId"),
      columnD: byIndex(EXAMPLE_COLUMN_POSITIONS.email.index),
      reservationCode: byRole("reservationCode"),
      listingId: byRole("listingId"),
    };
  }, [config]);

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

  function persistPreferences(next: UserPreferences) {
    prefsRef.current = next;
    void saveUserPreferences(next).catch(() => {
      /* keep local UI state; will retry on next save */
    });
  }

  function handleSortByChange(by: UserPreferences["sortBy"]) {
    setSortBy(by);
    persistPreferences({ ...prefsRef.current, sortBy: by });
  }

  function handleSortOrderChange(order: UserPreferences["sortOrder"]) {
    setSortOrder(order);
    persistPreferences({ ...prefsRef.current, sortOrder: order });
  }

  function handleDashboardRollingPeriodChange(period: RollingDashboardPeriod) {
    setLastRollingDashboardPeriod(period);
    setDashboardPeriod(period);
    persistPreferences({ ...prefsRef.current, dashboardPeriod: period });
  }

  function handleDashboardCalendarMonthChange(monthKey: string) {
    if (monthKey) {
      const period = dashboardPeriodFromCalendarMonthKey(monthKey);
      if (!period) return;
      setDashboardPeriod(period);
      persistPreferences({ ...prefsRef.current, dashboardPeriod: period });
      return;
    }
    setDashboardPeriod(lastRollingDashboardPeriod);
    persistPreferences({
      ...prefsRef.current,
      dashboardPeriod: lastRollingDashboardPeriod,
    });
  }

  function handlePreferencesSaved(prefs: UserPreferences) {
    prefsRef.current = prefs;
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
    setPreferencesOpen(false);
    void loadTickets({ silent: true, reason: "manual" });
  }

  const selected = tickets.find((t) => t.rowId === selectedId) ?? null;

  const ticketUiFields = useMemo(() => {
    if (!config || !selected) return [];
    return getMappedUiFieldSlots(config).map((slot) => {
      const col = config.columns.find((c) => c.index === slot.columnIndex);
      return {
        slotId: slot.id,
        label: uiFieldDisplayLabel(slot, col),
        value: selected.uiFields?.[slot.id] ?? "",
      };
    });
  }, [config, selected]);

  const counts = useMemo(() => {
    const map: Record<string, number> = { all: tickets.length };
    DEFAULT_STATUSES.forEach((s) => {
      map[s.id] = tickets.filter((t) => t.status === s.id).length;
    });
    return map;
  }, [tickets]);

  async function handleStatusChange(rowId: string, status: string) {
    const snapshot = tickets;
    const ticket = tickets.find((t) => t.rowId === rowId);
    const optimistic = tickets.map((t) =>
      t.rowId === rowId
        ? buildOptimisticStatusFields(t, status, prefsRef.current.defaultSlaHours)
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
    setSelectedId(result.rowId);
    return true;
  }

  function advanceAfterSend(
    rowId: string,
    statusAfterSend: string,
    ticketsSnapshot?: Ticket[]
  ): boolean {
    const ticketList = ticketsAfterSend(ticketsSnapshot ?? tickets, rowId, statusAfterSend);
    return applySendHandoff(rowId, ticketList, { showVictoryWhenDone: false });
  }

  function showInboxVictory() {
    setInboxVictory(true);
    setSelectedId(null);
  }

  function restoreSentTicket(rowId: string) {
    setInboxVictory(false);
    setSelectedId(rowId);
  }

  async function handleTicketSent(rowId: string, status: "pending" | "resolved") {
    const nextTickets = ticketsAfterSend(tickets, rowId, status);
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
  });

  function handleSelectTicket(rowId: string) {
    setInboxVictory(false);
    setSelectedId(rowId);
  }

  async function handleSetStatusWithoutEmail(
    rowId: string,
    status: string,
    options?: { adminNote?: string; pendingHours?: number; airbnbUserId?: string }
  ) {
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
          ...(options?.airbnbUserId ? { airbnbUserId: options.airbnbUserId } : {}),
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
          sheetStatus: (data.sheetStatus as string | undefined) ?? withStatus.sheetStatus,
          adminNotes: data.adminNotes ?? withStatus.adminNotes,
          sheetCaseSummary: data.adminNotes ?? withStatus.sheetCaseSummary,
        };
      });
      setTickets(nextTickets);

      const advanced = advanceAfterSend(rowId, nextStatus, nextTickets);
      if (!advanced) showInboxVictory();
    } catch (error) {
      setTickets(snapshot);
      logCrmError("Set status without email failed", error);
      throw error;
    }
  }

  async function handleAppendAdminNote(rowId: string, note: string) {
    if (source === "mock") {
      setTickets((prev) =>
        prev.map((t) => {
          if (t.rowId !== rowId) return t;
          const updated = appendAdminNoteToText(t.adminNotes, note);
          return { ...t, adminNotes: updated, sheetCaseSummary: updated };
        })
      );
      return;
    }

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

  async function handleAirbnbUserIdChange(rowId: string, airbnbUserId: string) {
    const res = await fetch(`/api/tickets/${encodeURIComponent(rowId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rowId, airbnbUserId }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.error) {
      throw new Error(data.error || "Failed to update Column AD");
    }

    setTickets((prev) =>
      prev.map((t) => {
        if (t.rowId !== rowId) return t;
        const rawKey =
          Object.keys(t.raw).find((k) => /airbnb\s*user\s*id/i.test(k)) || "Column AD";
        return {
          ...t,
          airbnbUserId,
          raw: { ...t.raw, [rawKey]: airbnbUserId, "Column AD": airbnbUserId },
        };
      })
    );
  }

  async function handleReservationCodeChange(rowId: string, reservationCode: string) {
    await fetch(`/api/tickets/${encodeURIComponent(rowId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rowId, reservationCode }),
    });
    setTickets((prev) =>
      prev.map((t) => (t.rowId === rowId ? { ...t, reservationCode } : t))
    );
  }

  async function handleListingIdChange(rowId: string, listingId: string) {
    await fetch(`/api/tickets/${encodeURIComponent(rowId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rowId, listingId }),
    });
    setTickets((prev) => prev.map((t) => (t.rowId === rowId ? { ...t, listingId } : t)));
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
    await fetch(`/api/tickets/${encodeURIComponent(rowId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rowId, subject }),
    });
    setTickets((prev) =>
      prev.map((t) =>
        t.rowId === rowId
          ? { ...t, subject, crmSubjectLabel: crmSubjectLabelFromStored(subject) }
          : t
      )
    );
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

  return (
    <div className="flex h-screen flex-col bg-white">
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-zendesk-border bg-zendesk-navy px-4 text-white">
        <div className="flex items-center gap-3">
          <span className="text-lg font-semibold tracking-tight">SheetsCRM</span>
          <span className="rounded bg-white/10 px-2 py-0.5 text-xs text-white/80">
            {source === "mock" ? "Demo data" : "Live sheet"}
          </span>
          {source !== "mock" && (
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
            qualityFilters={qualityFilters}
            onQualityFilterToggle={handleQualityFilterToggle}
            collapsed={ticketListCollapsed}
            onToggleCollapsed={() => setTicketListCollapsed((v) => !v)}
            initialResponseHours={initialResponseHours}
            fontScale={ticketListWidthState.fontScale}
          />
        </ResizableColumn>
        {inboxVictory ? (
          <InboxVictoryView />
        ) : (
          <TicketDetailTransition ticketKey={selected?.rowId ?? null}>
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
              onClearSendError={() => pendingSendQueue.clearSendError(selected?.rowId ?? undefined)}
              onSetStatusWithoutEmail={handleSetStatusWithoutEmail}
              onSubjectChange={handleSubjectChange}
              onContactReasonChange={handleContactReasonChange}
              onAppendAdminNote={handleAppendAdminNote}
              onAdminNotesChange={handleAdminNotesChange}
              onAirbnbUserIdChange={handleAirbnbUserIdChange}
              onReservationCodeChange={handleReservationCodeChange}
              onListingIdChange={handleListingIdChange}
              onSlaChange={handleSlaChange}
              onClearInitialResponseSla={handleClearInitialResponseSla}
              onThreadUpdate={handleThreadUpdate}
              onGmailLinkChange={handleGmailLinkChange}
              onLinkedCaseChange={handleLinkedCaseChange}
              externalTools={externalTools}
              ticketUiFields={ticketUiFields}
              onUiFieldChange={handleUiFieldChange}
              columnLabels={columnLabels}
              onOpenSetup={openSetup}
              marketManagersVersion={marketManagersVersion}
              sheetUrl={config?.sheetUrl ?? null}
            />
          </TicketDetailTransition>
        )}
        </div>
        <CrmDebugLogPanel enabled={errorLoggingEnabled} />
          </div>
        )}
      </div>

      {calendarReminders.toast && (
        <div className="pointer-events-none fixed right-4 top-4 z-50">
          <CalendarReminderToast
            event={calendarReminders.toast}
            onDismiss={calendarReminders.dismissToast}
          />
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

      {setupOpen && (
        <SetupModal
          config={config}
          initialTab={setupInitialTab}
          onClose={() => {
            setSetupOpen(false);
            setMarketManagersVersion((version) => version + 1);
          }}
          onSaved={() => {
            setSetupOpen(false);
            setMarketManagersVersion((version) => version + 1);
            void loadTickets({ reason: "setup" });
          }}
        />
      )}

      {unreadInboxOpen && (
        <UnreadInboxModal
          tickets={tickets}
          selectedTicketId={selectedId}
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
    </div>
  );
}
