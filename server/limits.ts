const windows = new Map<string, number[]>();

/** In-memory sliding window. Returns false once the quota is exhausted. */
export function take(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const hits = (windows.get(key) ?? []).filter((t) => now - t < windowMs);
  if (hits.length >= max) {
    windows.set(key, hits);
    return false;
  }
  hits.push(now);
  windows.set(key, hits);
  return true;
}

export function sweepLimits(): void {
  const now = Date.now();
  for (const [key, hits] of windows) {
    const live = hits.filter((t) => now - t < 60 * 60 * 1000);
    if (live.length === 0) windows.delete(key);
    else windows.set(key, live);
  }
}
