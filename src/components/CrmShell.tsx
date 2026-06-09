"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LogIn, LogOut, RefreshCw, Settings, SlidersHorizontal } from "lucide-react";
import type { SheetConfig, Ticket } from "@/lib/types";
import { DEFAULT_STATUSES } from "@/lib/types";
import { Sidebar, type AppView } from "./Sidebar";
import { TicketList } from "./TicketList";
import { TicketDetail } from "./TicketDetail";
import { DashboardView } from "./DashboardView";
import { SetupModal } from "./SetupModal";
import { PreferencesModal } from "./PreferencesModal";
import { appendAdminNoteToText } from "@/lib/admin-notes";
import { useRefreshCountdown } from "@/hooks/useRefreshCountdown";
import {
  dashboardFilterLabel,
  type DashboardFilter,
} from "@/lib/dashboard-filter";
import {
  buildFilteredTicketList,
  pickNextTicketAfterSend,
} from "@/lib/next-ticket-after-send";
import { InboxVictoryView } from "./InboxVictoryView";
import { buildContactReasonOptions } from "@/lib/contact-reasons";
import {
  loadUserPreferences,
  saveUserPreferences,
  type UserPreferences,
} from "@/lib/user-preferences";

const AUTO_REFRESH_SECONDS =
  Number(process.env.NEXT_PUBLIC_AUTO_REFRESH_SECONDS) || 60;
const AUTO_REFRESH_MS = AUTO_REFRESH_SECONDS * 1000;

export function CrmShell() {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [config, setConfig] = useState<SheetConfig | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [activeView, setActiveView] = useState<AppView>("tickets");
  const [dashboardFilter, setDashboardFilter] = useState<DashboardFilter | null>(null);
  const [sortOrder, setSortOrder] = useState<UserPreferences["sortOrder"]>("desc");
  const [search, setSearch] = useState("");
  const [setupOpen, setSetupOpen] = useState(false);
  const [preferencesOpen, setPreferencesOpen] = useState(false);
  const [prefsLoaded, setPrefsLoaded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [source, setSource] = useState<string>("mock");
  const [auth, setAuth] = useState<{ signedIn: boolean; email: string | null }>({
    signedIn: false,
    email: null,
  });
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(null);
  const [inboxVictory, setInboxVictory] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [countdownResetKey, setCountdownResetKey] = useState(0);
  const sourceRef = useRef(source);
  const initialSelectionDone = useRef(false);
  sourceRef.current = source;

  const secondsUntilRefresh = useRefreshCountdown(
    AUTO_REFRESH_SECONDS,
    source !== "mock",
    countdownResetKey
  );

  const loadTickets = useCallback(async (options?: { silent?: boolean }) => {
    const silent = options?.silent ?? false;
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
          return;
        }
        throw new Error(message);
      }

      if (silent && data.source === "mock" && sourceRef.current !== "mock") {
        setSyncError("Sync failed — try signing in again");
        return;
      }

      setSyncError(null);
      setTickets(data.tickets ?? []);
      setConfig(data.config ?? null);
      setSource(data.source ?? "mock");
      setLastSyncedAt(new Date());
      setCountdownResetKey((k) => k + 1);
    } catch (err) {
      if (!silent) {
        setSyncError(err instanceof Error ? err.message : "Failed to load tickets");
      }
    } finally {
      if (silent) setSyncing(false);
      else setLoading(false);
    }
  }, []);

  const loadAuth = useCallback(async () => {
    const res = await fetch("/api/auth/status");
    const data = await res.json();
    setAuth({ signedIn: data.signedIn, email: data.email });
  }, []);

  useEffect(() => {
    const prefs = loadUserPreferences();
    setStatusFilter(prefs.defaultStatusFilter);
    setSortOrder(prefs.sortOrder);
    setPrefsLoaded(true);
  }, []);

  useEffect(() => {
    loadTickets();
    loadAuth();
  }, [loadTickets, loadAuth]);

  useEffect(() => {
    if (source === "mock") return;

    const refresh = () => {
      if (document.visibilityState === "visible") {
        loadTickets({ silent: true });
      }
    };

    const intervalId = setInterval(refresh, AUTO_REFRESH_MS);

    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        refresh();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      clearInterval(intervalId);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [loadTickets, source]);

  async function handleSignOut() {
    await fetch("/api/auth/logout", { method: "POST" });
    await loadAuth();
    await loadTickets();
  }

  const contactReasonOptions = useMemo(
    () => buildContactReasonOptions(tickets),
    [tickets]
  );

  const filtered = useMemo(
    () =>
      buildFilteredTicketList({
        tickets,
        statusFilter,
        search,
        sortOrder,
        dashboardFilter,
      }),
    [tickets, statusFilter, search, sortOrder, dashboardFilter]
  );

  useEffect(() => {
    if (!prefsLoaded || loading || initialSelectionDone.current) return;

    initialSelectionDone.current = true;
    setSelectedId(filtered.length > 0 ? filtered[0].rowId : null);
  }, [prefsLoaded, loading, filtered]);

  function handleSortOrderChange(order: UserPreferences["sortOrder"]) {
    setSortOrder(order);
    const prefs = loadUserPreferences();
    saveUserPreferences({ ...prefs, sortOrder: order });
  }

  function handlePreferencesSaved(prefs: UserPreferences) {
    setStatusFilter(prefs.defaultStatusFilter);
    setSortOrder(prefs.sortOrder);
    setPreferencesOpen(false);
  }

  const selected = tickets.find((t) => t.rowId === selectedId) ?? null;

  const counts = useMemo(() => {
    const map: Record<string, number> = { all: tickets.length };
    DEFAULT_STATUSES.forEach((s) => {
      map[s.id] = tickets.filter((t) => t.status === s.id).length;
    });
    return map;
  }, [tickets]);

  async function handleStatusChange(rowId: string, status: string) {
    await fetch(`/api/tickets/${encodeURIComponent(rowId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rowId, status }),
    });
    setTickets((prev) => prev.map((t) => (t.rowId === rowId ? { ...t, status } : t)));
  }

  function advanceAfterSend(rowId: string): boolean {
    const sentIndexInFiltered = filtered.findIndex((t) => t.rowId === rowId);
    const result = pickNextTicketAfterSend({
      tickets,
      sentRowId: rowId,
      sentIndexInFiltered,
      statusFilter,
      search,
      sortOrder,
      dashboardFilter,
    });

    if (result.kind === "victory") {
      return false;
    }

    setInboxVictory(false);
    if (result.statusFilter) setStatusFilter(result.statusFilter);
    setSelectedId(result.rowId);
    return true;
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
    await fetch(`/api/tickets/${encodeURIComponent(rowId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rowId, status }),
    });

    setTickets((prev) => prev.map((t) => (t.rowId === rowId ? { ...t, status } : t)));
  }

  function handleSelectTicket(rowId: string) {
    setInboxVictory(false);
    setSelectedId(rowId);
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

    const res = await fetch(`/api/tickets/${encodeURIComponent(rowId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rowId, appendAdminNote: note }),
    });
    const data = await res.json();
    if (data.adminNotes) {
      setTickets((prev) =>
        prev.map((t) =>
          t.rowId === rowId
            ? { ...t, adminNotes: data.adminNotes, sheetCaseSummary: data.adminNotes }
            : t
        )
      );
    } else {
      await loadTickets({ silent: true });
    }
  }

  async function handleAirbnbUserIdChange(rowId: string, airbnbUserId: string) {
    await fetch(`/api/tickets/${encodeURIComponent(rowId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rowId, airbnbUserId }),
    });
    setTickets((prev) => prev.map((t) => (t.rowId === rowId ? { ...t, airbnbUserId } : t)));
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

  async function handleSubjectChange(rowId: string, subject: string) {
    await fetch(`/api/tickets/${encodeURIComponent(rowId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rowId, subject }),
    });
    setTickets((prev) => prev.map((t) => (t.rowId === rowId ? { ...t, subject } : t)));
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
    const slaDueAt = new Date(Date.now() + slaHours * 60 * 60 * 1000).toISOString();
    await fetch(`/api/tickets/${encodeURIComponent(rowId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rowId, slaHours }),
    });
    setTickets((prev) =>
      prev.map((t) =>
        t.rowId === rowId
          ? {
              ...t,
              slaHours,
              slaDueAt,
              slaBreached: new Date(slaDueAt) < new Date(),
            }
          : t
      )
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
                    onClick={() => loadTickets({ silent: true })}
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
            onClick={() => setSetupOpen(true)}
            className="rounded p-2 hover:bg-white/10"
            title="Sheet setup"
            aria-label="Sheet setup"
          >
            <Settings className="h-5 w-5" />
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <Sidebar
          activeView={activeView}
          onViewChange={setActiveView}
          statusFilter={statusFilter}
          onStatusFilter={setStatusFilter}
          counts={counts}
        />
        {activeView === "dashboard" ? (
          <DashboardView
            tickets={tickets}
            loading={loading || !prefsLoaded}
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
        <TicketList
          tickets={filtered}
          selectedId={selectedId}
          onSelect={handleSelectTicket}
          search={search}
          onSearch={setSearch}
          loading={loading || !prefsLoaded}
          sortOrder={sortOrder}
          onSortOrderChange={handleSortOrderChange}
          refreshLabel={
            source !== "mock" && lastSyncedAt && !syncing
              ? `Refreshes in ${secondsUntilRefresh}s`
              : undefined
          }
        />
        {inboxVictory ? (
          <InboxVictoryView />
        ) : (
          <TicketDetail
            ticket={selected}
            contactReasonOptions={contactReasonOptions}
            onStatusChange={handleStatusChange}
            onAdvanceAfterSend={advanceAfterSend}
            onShowInboxVictory={showInboxVictory}
            onRestoreSentTicket={restoreSentTicket}
            onTicketSent={handleTicketSent}
            onSubjectChange={handleSubjectChange}
            onContactReasonChange={handleContactReasonChange}
            onAppendAdminNote={handleAppendAdminNote}
            onAirbnbUserIdChange={handleAirbnbUserIdChange}
            onReservationCodeChange={handleReservationCodeChange}
            onListingIdChange={handleListingIdChange}
            onSlaChange={handleSlaChange}
            onThreadUpdate={() => loadTickets({ silent: true })}
          />
        )}
        </div>
          </div>
        )}
      </div>

      {preferencesOpen && (
        <PreferencesModal
          preferences={loadUserPreferences()}
          onClose={() => setPreferencesOpen(false)}
          onSaved={handlePreferencesSaved}
        />
      )}

      {setupOpen && (
        <SetupModal
          config={config}
          onClose={() => setSetupOpen(false)}
          onSaved={() => {
            setSetupOpen(false);
            loadTickets();
          }}
        />
      )}
    </div>
  );
}
