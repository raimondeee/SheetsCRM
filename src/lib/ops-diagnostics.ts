/**
 * In-memory stall diagnostics shared by API routes and the health panel.
 *
 * Mutable buffers live on globalThis so the Next.js instrumentation process
 * and webpack-bundled route handlers see the same ring buffer. Do not import
 * Node builtins here — Webpack 15 cannot resolve node: URIs in this app.
 */

export type OpsAuthHandlerName = "google_redirect" | "callback";

export interface OpsApiRequestRecord {
  at: number;
  method: string;
  path: string;
  status: number;
  durationMs: number;
  inFlightAtStart: number;
  ok: boolean;
}

export interface OpsAuthHandlerRecord {
  at: number;
  name: OpsAuthHandlerName;
  ok: boolean;
  durationMs: number;
  error?: string;
}

export interface OpsStallRecord {
  at: number;
  driftMs: number;
}

export interface OpsEventLoopSnapshot {
  enabled: boolean;
  meanMs: number | null;
  p50Ms: number | null;
  p95Ms: number | null;
  p99Ms: number | null;
  maxMs: number | null;
  windowMs: number;
  lastWindowMaxMs: number | null;
}

export interface OpsInFlightApiSnapshot {
  apiRequests: number;
  paths: { path: string; count: number }[];
}

export interface OpsAuthTimingSnapshot {
  at: string;
  ok: boolean;
  requestMs: number | null;
  handlerMs: number | null;
  error?: string;
}

export interface OpsDiagnosticsSnapshot {
  eventLoop: OpsEventLoopSnapshot;
  inFlight: OpsInFlightApiSnapshot;
  stalls: {
    lastAt: string | null;
    lastDriftMs: number | null;
    lastHour: number;
  };
  auth: {
    lastGoogleRedirect: OpsAuthTimingSnapshot | null;
    lastCallback: OpsAuthTimingSnapshot | null;
  };
  recentRequests: Array<{
    at: string;
    method: string;
    path: string;
    status: number;
    durationMs: number;
    inFlightAtStart: number;
    ok: boolean;
  }>;
  httpTapInstalled: boolean;
}

const MAX_API_REQUESTS = 80;
const MAX_AUTH_HANDLERS = 20;
const MAX_STALLS = 50;
const HEARTBEAT_MS = 1_000;
const STALL_THRESHOLD_MS = 100;
const STALL_WARN_MS = 1_000;
const QUIET_PATHS = new Set(["/api/ops/metrics"]);
const OPS_GLOBAL = Symbol.for("sheetscrm.opsDiagnostics");

type IntervalHistogram = {
  enable: () => void;
  reset: () => void;
  mean: number;
  max: number;
  percentile: (n: number) => number;
};

type OpsGlobalState = {
  apiRequests: OpsApiRequestRecord[];
  authHandlers: OpsAuthHandlerRecord[];
  stalls: OpsStallRecord[];
  inFlightPaths: Map<string, number>;
  inFlightApi: number;
  histogram: IntervalHistogram | null;
  windowStarted: number;
  lastWindowMaxMs: number | null;
  lastBeat: number;
  heartbeatStarted: boolean;
  eventLoopStarted: boolean;
  loggedStart: boolean;
  httpTapInstalled: boolean;
};

function isNodeRuntime(): boolean {
  return typeof process !== "undefined" && process.env.NEXT_RUNTIME !== "edge";
}

function nsToMs(value: number): number {
  return Math.round((value / 1e6) * 10) / 10;
}

function pruneOld<T extends { at: number }>(buffer: T[], maxAgeMs: number, maxLen: number): void {
  const cutoff = Date.now() - maxAgeMs;
  while (buffer.length > 0 && buffer[0]!.at < cutoff) buffer.shift();
  if (buffer.length > maxLen) buffer.splice(0, buffer.length - maxLen);
}

function emptyOpsState(): OpsGlobalState {
  return {
    apiRequests: [],
    authHandlers: [],
    stalls: [],
    inFlightPaths: new Map(),
    inFlightApi: 0,
    histogram: null,
    windowStarted: 0,
    lastWindowMaxMs: null,
    lastBeat: 0,
    heartbeatStarted: false,
    eventLoopStarted: false,
    loggedStart: false,
    httpTapInstalled: false,
  };
}

function opsGlobal(): OpsGlobalState {
  const holder = globalThis as typeof globalThis & { [OPS_GLOBAL]?: OpsGlobalState };
  const existing = holder[OPS_GLOBAL];
  if (!existing || !Array.isArray(existing.stalls) || !Array.isArray(existing.apiRequests)) {
    const next = emptyOpsState();
    holder[OPS_GLOBAL] = next;
    return next;
  }
  if (!(existing.inFlightPaths instanceof Map)) {
    existing.inFlightPaths = new Map();
    existing.inFlightApi = 0;
  }
  return existing;
}

export function normalizeApiPath(rawUrl: string): string {
  let path = rawUrl;
  try {
    if (rawUrl.startsWith("http://") || rawUrl.startsWith("https://")) {
      path = new URL(rawUrl).pathname;
    }
  } catch {
    // keep raw
  }
  path = (path.split("?")[0] ?? path) || "/";

  if (
    path.startsWith("/api/tickets/") &&
    path !== "/api/tickets/background-gmail-sync" &&
    !path.startsWith("/api/tickets/background-gmail-sync/")
  ) {
    path = path.replace(/^\/api\/tickets\/[^/]+/, "/api/tickets/:rowId");
  }
  path = path.replace(/^\/api\/reply-drafts\/[^/]+/, "/api/reply-drafts/:rowId");
  path = path.replace(/^\/api\/admin-note-drafts\/[^/]+/, "/api/admin-note-drafts/:rowId");
  path = path.replace(/^\/api\/compose-prefs\/[^/]+/, "/api/compose-prefs/:rowId");
  path = path.replace(/^\/api\/sounds\/custom\/[^/]+/, "/api/sounds/custom/:id");
  path = path.replace(/^\/api\/mixmax\/templates\/[^/]+/, "/api/mixmax/templates/:id");
  path = path.replace(/\/messages\/[^/]+/g, "/messages/:messageId");
  path = path.replace(/\/attachments\/[^/]+/g, "/attachments/:attachmentId");
  return path;
}

export function beginApiRequest(path: string): number {
  const state = opsGlobal();
  const atStart = state.inFlightApi;
  state.inFlightApi += 1;
  state.inFlightPaths.set(path, (state.inFlightPaths.get(path) ?? 0) + 1);
  return atStart;
}

export function endApiRequest(path: string): void {
  const state = opsGlobal();
  state.inFlightApi = Math.max(0, state.inFlightApi - 1);
  const count = state.inFlightPaths.get(path) ?? 0;
  if (count <= 1) state.inFlightPaths.delete(path);
  else state.inFlightPaths.set(path, count - 1);
}

export function recordApiRequest(record: OpsApiRequestRecord): void {
  if (QUIET_PATHS.has(record.path)) return;
  const state = opsGlobal();
  state.apiRequests.push(record);
  pruneOld(state.apiRequests, 24 * 60 * 60 * 1000, MAX_API_REQUESTS);
}

export function recordAuthHandler(event: {
  name: OpsAuthHandlerName;
  ok: boolean;
  durationMs: number;
  error?: string;
}): void {
  startOpsDiagnostics();
  const state = opsGlobal();
  state.authHandlers.push({
    at: Date.now(),
    name: event.name,
    ok: event.ok,
    durationMs: Math.round(event.durationMs),
    error: event.error,
  });
  pruneOld(state.authHandlers, 24 * 60 * 60 * 1000, MAX_AUTH_HANDLERS);
}

function lastApiRequest(path: string): OpsApiRequestRecord | undefined {
  const list = opsGlobal().apiRequests;
  for (let i = list.length - 1; i >= 0; i -= 1) {
    if (list[i]!.path === path) return list[i];
  }
  return undefined;
}

function lastAuthHandler(name: OpsAuthHandlerName): OpsAuthHandlerRecord | undefined {
  const list = opsGlobal().authHandlers;
  for (let i = list.length - 1; i >= 0; i -= 1) {
    if (list[i]!.name === name) return list[i];
  }
  return undefined;
}

function authTiming(
  path: string,
  handlerName: OpsAuthHandlerName
): OpsAuthTimingSnapshot | null {
  const request = lastApiRequest(path);
  const handler = lastAuthHandler(handlerName);
  if (!request && !handler) return null;
  const at = Math.max(request?.at ?? 0, handler?.at ?? 0);
  return {
    at: new Date(at).toISOString(),
    ok: (request ? request.ok : handler?.ok) ?? true,
    requestMs: request?.durationMs ?? null,
    handlerMs: handler?.durationMs ?? null,
    error: handler?.error,
  };
}

function startHeartbeat(): void {
  const state = opsGlobal();
  if (state.heartbeatStarted || !isNodeRuntime()) return;
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  state.heartbeatStarted = true;
  state.lastBeat = Date.now();
  const tick = setInterval(() => {
    const current = opsGlobal();
    const now = Date.now();
    const drift = now - current.lastBeat - HEARTBEAT_MS;
    current.lastBeat = now;
    if (drift < STALL_THRESHOLD_MS) return;
    current.stalls.push({ at: now, driftMs: Math.round(drift) });
    pruneOld(current.stalls, 24 * 60 * 60 * 1000, MAX_STALLS);
    if (drift >= STALL_WARN_MS) {
      console.warn(`[SheetsCRM ops] event loop stall ${Math.round(drift)}ms`);
    }
  }, HEARTBEAT_MS);
  tick.unref?.();
}

export function startOpsDiagnostics(): void {
  if (!isNodeRuntime()) return;
  startHeartbeat();
  const state = opsGlobal();
  if (!state.loggedStart) {
    state.loggedStart = true;
    console.info("[SheetsCRM ops] server diagnostics enabled (event loop + API request log)");
  }
}

function readEventLoop(): OpsEventLoopSnapshot {
  const state = opsGlobal();
  if (!state.histogram) {
    return {
      enabled: false,
      meanMs: null,
      p50Ms: null,
      p95Ms: null,
      p99Ms: null,
      maxMs: null,
      windowMs: 0,
      lastWindowMaxMs: null,
    };
  }
  return {
    enabled: true,
    meanMs: nsToMs(state.histogram.mean),
    p50Ms: nsToMs(state.histogram.percentile(50)),
    p95Ms: nsToMs(state.histogram.percentile(95)),
    p99Ms: nsToMs(state.histogram.percentile(99)),
    maxMs: nsToMs(state.histogram.max),
    windowMs: Date.now() - state.windowStarted,
    lastWindowMaxMs: state.lastWindowMaxMs,
  };
}

export function getDiagnosticsSnapshot(): OpsDiagnosticsSnapshot {
  startOpsDiagnostics();
  const state = opsGlobal();
  const hourAgo = Date.now() - 60 * 60 * 1000;
  const recentStalls = state.stalls.filter((s) => s.at >= hourAgo);
  const lastStall = state.stalls[state.stalls.length - 1];

  return {
    eventLoop: readEventLoop(),
    inFlight: {
      apiRequests: state.inFlightApi,
      paths: [...state.inFlightPaths.entries()]
        .map(([path, count]) => ({ path, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 6),
    },
    stalls: {
      lastAt: lastStall ? new Date(lastStall.at).toISOString() : null,
      lastDriftMs: lastStall?.driftMs ?? null,
      lastHour: recentStalls.length,
    },
    auth: {
      lastGoogleRedirect: authTiming("/api/auth/google", "google_redirect"),
      lastCallback: authTiming("/api/auth/callback", "callback"),
    },
    recentRequests: [...state.apiRequests]
      .reverse()
      .slice(0, 40)
      .map((r) => ({
        at: new Date(r.at).toISOString(),
        method: r.method,
        path: r.path,
        status: r.status,
        durationMs: r.durationMs,
        inFlightAtStart: r.inFlightAtStart,
        ok: r.ok,
      })),
    httpTapInstalled: state.httpTapInstalled,
  };
}

/** Time a route handler and append it to the recent-request log. */
export async function withApiRequestLog<T extends Response>(
  request: Request,
  pathLabel: string,
  fn: () => Promise<T>
): Promise<T> {
  startOpsDiagnostics();
  const path = pathLabel || normalizeApiPath(request.url);
  const started = Date.now();
  const inFlightAtStart = beginApiRequest(path);
  try {
    const response = await fn();
    recordApiRequest({
      at: started,
      method: request.method.toUpperCase(),
      path,
      status: response.status,
      durationMs: Date.now() - started,
      inFlightAtStart,
      ok: response.status < 400,
    });
    return response;
  } catch (error) {
    recordApiRequest({
      at: started,
      method: request.method.toUpperCase(),
      path,
      status: 0,
      durationMs: Date.now() - started,
      inFlightAtStart,
      ok: false,
    });
    throw error;
  } finally {
    endApiRequest(path);
  }
}
