"use client";

import { useCallback, useEffect, useState } from "react";
import { LogIn, LogOut, Settings2 } from "lucide-react";
import { TeamDashboardView } from "./TeamDashboardView";
import { TeamSourcesPanel } from "./TeamSourcesPanel";
import {
  DEFAULT_USER_PREFERENCES,
  fetchUserPreferences,
  patchUserPreferences,
  type UserPreferences,
} from "@/lib/user-preferences";
import {
  calendarMonthKeyFromPeriod,
  dashboardPeriodFromCalendarMonthKey,
  isRollingDashboardPeriod,
  type DashboardPeriod,
  type RollingDashboardPeriod,
} from "@/lib/dashboard-period";

type AuthState = {
  signedIn: boolean;
  email: string | null;
  method: "oauth" | "service_account" | null;
};

/**
 * Slim shell for the Team Dashboard shareable build:
 * auth + regional source sheet tools + Team dashboard only.
 */
export function TeamDashboardShell() {
  const [auth, setAuth] = useState<AuthState>({
    signedIn: false,
    email: null,
    method: null,
  });
  const [prefsLoaded, setPrefsLoaded] = useState(false);
  const [prefs, setPrefs] = useState<UserPreferences>(DEFAULT_USER_PREFERENCES);
  const [dashboardPeriod, setDashboardPeriod] = useState<DashboardPeriod>(
    DEFAULT_USER_PREFERENCES.dashboardPeriod
  );
  const [lastRollingPeriod, setLastRollingPeriod] = useState<RollingDashboardPeriod>(
    isRollingDashboardPeriod(DEFAULT_USER_PREFERENCES.dashboardPeriod)
      ? DEFAULT_USER_PREFERENCES.dashboardPeriod
      : "3m"
  );
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  const loadAuth = useCallback(async () => {
    try {
      const res = await fetch("/api/auth/status", { cache: "no-store" });
      const data = await res.json();
      setAuth({
        signedIn: Boolean(data.signedIn),
        email: data.email ?? null,
        method: data.method ?? null,
      });
    } catch {
      setAuth({ signedIn: false, email: null, method: null });
    }
  }, []);

  useEffect(() => {
    void loadAuth();
  }, [loadAuth]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const loaded = await fetchUserPreferences();
        if (cancelled) return;
        setPrefs(loaded);
        setDashboardPeriod(loaded.dashboardPeriod);
        if (isRollingDashboardPeriod(loaded.dashboardPeriod)) {
          setLastRollingPeriod(loaded.dashboardPeriod);
        }
      } catch {
        /* keep defaults */
      } finally {
        if (!cancelled) setPrefsLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function persistPeriod(period: DashboardPeriod) {
    setPrefs((prev) => ({ ...prev, dashboardPeriod: period }));
    try {
      const saved = await patchUserPreferences({ dashboardPeriod: period });
      setPrefs(saved);
    } catch {
      /* local-only if prefs API unavailable */
    }
  }

  function handleRollingPeriodChange(period: RollingDashboardPeriod) {
    setLastRollingPeriod(period);
    setDashboardPeriod(period);
    void persistPeriod(period);
  }

  function handleCalendarMonthChange(monthKey: string) {
    if (monthKey) {
      const period = dashboardPeriodFromCalendarMonthKey(monthKey);
      if (!period) return;
      setDashboardPeriod(period);
      void persistPeriod(period);
      return;
    }
    setDashboardPeriod(lastRollingPeriod);
    void persistPeriod(lastRollingPeriod);
  }

  return (
    <div className="flex h-screen flex-col bg-gray-50">
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-zendesk-border bg-white px-4 py-2.5">
        <div>
          <h1 className="text-sm font-semibold text-zendesk-navy">Team Dashboard</h1>
          <p className="text-[11px] text-zendesk-muted">
            Shareable regional intake metrics · configure source sheets to pull data
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setSourcesOpen(true)}
            className="inline-flex items-center gap-1.5 rounded border border-zendesk-border bg-white px-3 py-1.5 text-xs font-medium text-zendesk-navy hover:bg-gray-50"
          >
            <Settings2 className="h-3.5 w-3.5" />
            Source sheets
          </button>
          {auth.signedIn ? (
            <div className="flex items-center gap-2 text-xs text-zendesk-muted">
              <span className="hidden sm:inline">{auth.email}</span>
              <a
                href="/api/auth/logout"
                className="inline-flex items-center gap-1 rounded border border-zendesk-border px-2 py-1.5 hover:bg-gray-50"
              >
                <LogOut className="h-3.5 w-3.5" />
                Sign out
              </a>
            </div>
          ) : (
            <a
              href="/api/auth/google"
              className="inline-flex items-center gap-1.5 rounded bg-zendesk-navy px-3 py-1.5 text-xs font-medium text-white hover:bg-zendesk-navy/90"
            >
              <LogIn className="h-3.5 w-3.5" />
              Sign in with Google
            </a>
          )}
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-hidden" key={reloadKey}>
        <TeamDashboardView
          tickets={[]}
          loading={!prefsLoaded}
          period={dashboardPeriod}
          rollingPeriod={
            isRollingDashboardPeriod(dashboardPeriod) ? dashboardPeriod : lastRollingPeriod
          }
          calendarMonth={calendarMonthKeyFromPeriod(dashboardPeriod) ?? ""}
          onRollingPeriodChange={handleRollingPeriodChange}
          onCalendarMonthChange={handleCalendarMonthChange}
          userEmail={auth.email}
          canSendEmail={auth.signedIn && auth.method === "oauth"}
          onOpenSources={() => setSourcesOpen(true)}
        />
      </div>

      <TeamSourcesPanel
        open={sourcesOpen}
        onClose={() => setSourcesOpen(false)}
        onSaved={() => setReloadKey((n) => n + 1)}
      />
    </div>
  );
}
