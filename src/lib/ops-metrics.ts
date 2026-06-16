export type OpsIntegrationId = "sheets" | "gmail" | "mixmax";

export type OpsHealthStatus = "ok" | "warn" | "error" | "idle" | "disabled";

export interface OpsCallRecord {
  at: number;
  integration: OpsIntegrationId;
  operation: string;
  ok: boolean;
  durationMs: number;
  error?: string;
}

export interface OpsAppEvent {
  at: number;
  name: string;
  ok: boolean;
  durationMs: number;
  detail?: string;
  error?: string;
}

const MAX_CALL_RECORDS = 2000;
const MAX_APP_EVENTS = 200;

const callRecords: OpsCallRecord[] = [];
const appEvents: OpsAppEvent[] = [];

const INTEGRATION_LABELS: Record<OpsIntegrationId, string> = {
  sheets: "Google Sheets",
  gmail: "Gmail",
  mixmax: "Mixmax",
};

function isMixmaxConfigured(): boolean {
  return Boolean(process.env.MIXMAX_API_TOKEN?.trim());
}

function pruneOld<T extends { at: number }>(buffer: T[], maxAgeMs: number, maxLen: number): void {
  const cutoff = Date.now() - maxAgeMs;
  while (buffer.length > 0 && buffer[0]!.at < cutoff) buffer.shift();
  if (buffer.length > maxLen) buffer.splice(0, buffer.length - maxLen);
}

export function recordOpsCall(record: Omit<OpsCallRecord, "at">): void {
  callRecords.push({ ...record, at: Date.now() });
  pruneOld(callRecords, 24 * 60 * 60 * 1000, MAX_CALL_RECORDS);
}

export function recordOpsAppEvent(event: Omit<OpsAppEvent, "at">): void {
  appEvents.push({ ...event, at: Date.now() });
  pruneOld(appEvents, 24 * 60 * 60 * 1000, MAX_APP_EVENTS);
}

export async function withOpsMetric<T>(
  integration: OpsIntegrationId,
  operation: string,
  fn: () => Promise<T>
): Promise<T> {
  const started = Date.now();
  try {
    const result = await fn();
    recordOpsCall({
      integration,
      operation,
      ok: true,
      durationMs: Date.now() - started,
    });
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    recordOpsCall({
      integration,
      operation,
      ok: false,
      durationMs: Date.now() - started,
      error: message,
    });
    throw error;
  }
}

function callsForIntegration(
  integration: OpsIntegrationId,
  sinceMs: number
): OpsCallRecord[] {
  const since = Date.now() - sinceMs;
  return callRecords.filter((r) => r.integration === integration && r.at >= since);
}

function projectedCallsPerHour(recent: OpsCallRecord[]): number {
  const last15 = recent.filter((r) => r.at >= Date.now() - 15 * 60 * 1000);
  if (last15.length > 0) {
    return Math.round(last15.length * 4);
  }
  return recent.length;
}

function resolveStatus(
  integration: OpsIntegrationId,
  recentHour: OpsCallRecord[]
): OpsHealthStatus {
  if (integration === "mixmax" && !isMixmaxConfigured()) {
    return "disabled";
  }

  if (recentHour.length === 0) {
    return "idle";
  }

  const sorted = [...recentHour].sort((a, b) => b.at - a.at);
  const last = sorted[0]!;
  const lastSuccess = sorted.find((r) => r.ok);
  const failures = recentHour.filter((r) => !r.ok);
  const failureRate = failures.length / recentHour.length;

  if (!last.ok && (!lastSuccess || last.at > lastSuccess.at)) {
    return "error";
  }

  if (failureRate >= 0.2 || failures.length >= 3) {
    return "warn";
  }

  if (lastSuccess && Date.now() - lastSuccess.at > 20 * 60 * 1000) {
    return "warn";
  }

  return "ok";
}

export interface OpsIntegrationSnapshot {
  id: OpsIntegrationId;
  label: string;
  status: OpsHealthStatus;
  callsLastHour: number;
  projectedCallsPerHour: number;
  successRateLastHour: number | null;
  avgLatencyMs: number | null;
  lastSuccessAt: string | null;
  lastErrorAt: string | null;
  lastError: string | null;
  recentOperations: string[];
}

export interface OpsMetricsSnapshot {
  generatedAt: string;
  integrations: OpsIntegrationSnapshot[];
  ticketListRefreshesLastHour: number;
  lastTicketListRefreshAt: string | null;
  lastTicketListError: string | null;
  autoRefreshSeconds: number;
}

function integrationSnapshot(integration: OpsIntegrationId): OpsIntegrationSnapshot {
  const recentHour = callsForIntegration(integration, 60 * 60 * 1000);
  const successes = recentHour.filter((r) => r.ok);
  const failures = recentHour.filter((r) => !r.ok);
  const lastSuccess = [...recentHour].reverse().find((r) => r.ok);
  const lastFailure = [...recentHour].reverse().find((r) => !r.ok);

  const avgLatencyMs =
    successes.length > 0
      ? Math.round(
          successes.reduce((sum, r) => sum + r.durationMs, 0) / successes.length
        )
      : null;

  const recentOps = [...new Set(recentHour.slice(-8).map((r) => r.operation))].slice(-4);

  return {
    id: integration,
    label: INTEGRATION_LABELS[integration],
    status: resolveStatus(integration, recentHour),
    callsLastHour: recentHour.length,
    projectedCallsPerHour: projectedCallsPerHour(recentHour),
    successRateLastHour:
      recentHour.length > 0
        ? Math.round((successes.length / recentHour.length) * 100)
        : null,
    avgLatencyMs,
    lastSuccessAt: lastSuccess ? new Date(lastSuccess.at).toISOString() : null,
    lastErrorAt: lastFailure ? new Date(lastFailure.at).toISOString() : null,
    lastError: lastFailure?.error ?? null,
    recentOperations: recentOps,
  };
}

export function getOpsMetricsSnapshot(): OpsMetricsSnapshot {
  const hourAgo = Date.now() - 60 * 60 * 1000;
  const ticketEvents = appEvents.filter(
    (e) => e.name === "ticket_list_refresh" && e.at >= hourAgo
  );
  const lastTicketEvent = [...appEvents]
    .reverse()
    .find((e) => e.name === "ticket_list_refresh");
  const lastTicketError = [...appEvents]
    .reverse()
    .find((e) => e.name === "ticket_list_refresh" && !e.ok);

  return {
    generatedAt: new Date().toISOString(),
    integrations: (["sheets", "gmail", "mixmax"] as const).map(integrationSnapshot),
    ticketListRefreshesLastHour: ticketEvents.length,
    lastTicketListRefreshAt: lastTicketEvent
      ? new Date(lastTicketEvent.at).toISOString()
      : null,
    lastTicketListError: lastTicketError?.error ?? null,
    autoRefreshSeconds: Number(process.env.NEXT_PUBLIC_AUTO_REFRESH_SECONDS) || 60,
  };
}
