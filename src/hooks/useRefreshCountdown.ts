import { useEffect, useState } from "react";

/** Ticks down every second; resets when `resetKey` changes (e.g. after a sync). */
export function useRefreshCountdown(
  intervalSeconds: number,
  enabled: boolean,
  resetKey: number
): number {
  const [secondsLeft, setSecondsLeft] = useState(intervalSeconds);

  useEffect(() => {
    if (!enabled) return;
    setSecondsLeft(intervalSeconds);
  }, [enabled, intervalSeconds, resetKey]);

  useEffect(() => {
    if (!enabled) return;

    const tick = setInterval(() => {
      setSecondsLeft((prev) => (prev <= 1 ? intervalSeconds : prev - 1));
    }, 1000);

    return () => clearInterval(tick);
  }, [enabled, intervalSeconds]);

  return secondsLeft;
}
