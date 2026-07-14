/** Tickets submitted before this instant are excluded from service metrics. */
export function getServiceMetricsEpoch(): Date {
  const raw = process.env.SERVICE_METRICS_EPOCH_ISO?.trim();
  if (raw) {
    const parsed = new Date(raw);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  // Feature launch default — local midnight 17 Jun 2026
  return new Date(2026, 5, 17, 0, 0, 0, 0);
}

export function getServiceMetricsEpochIso(): string {
  return getServiceMetricsEpoch().toISOString();
}
