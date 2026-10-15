/**
 * Shared in-flight coalescing and bounded concurrency.
 * Maps live on globalThis so webpack route bundles and instrumentation share them.
 */

const INFLIGHT = Symbol.for("sheetscrm.inflight");

function inflightMap(): Map<string, Promise<unknown>> {
  const holder = globalThis as typeof globalThis & {
    [INFLIGHT]?: Map<string, Promise<unknown>>;
  };
  if (!holder[INFLIGHT]) holder[INFLIGHT] = new Map();
  return holder[INFLIGHT];
}

/** If the same key is already running, callers share that promise. */
export function coalesceInflight<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const map = inflightMap();
  const existing = map.get(key);
  if (existing) return existing as Promise<T>;

  const pending = fn().finally(() => {
    if (map.get(key) === pending) map.delete(key);
  });
  map.set(key, pending);
  return pending;
}

/** Run mapper over items with a fixed worker count. */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  if (items.length === 0) return [];
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const workers = Math.min(Math.max(1, concurrency), items.length);

  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(items[index]!, index);
    }
  }

  await Promise.all(Array.from({ length: workers }, () => worker()));
  return results;
}
