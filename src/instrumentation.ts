/**
 * Next.js server boot hook. Starts the stall heartbeat and request log.
 * Avoid Node builtin imports here — Webpack 15 cannot resolve "module" / node: URIs.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "edge") return;
  if (process.env.NEXT_PHASE === "phase-production-build") return;

  const { startOpsDiagnostics } = await import("./lib/ops-diagnostics");
  startOpsDiagnostics();
}
