export interface RateLimiter {
  /** True while the key still has attempts left; does not consume one. */
  allow(key: string): boolean;
  /** Consume one attempt. Only failed attempts should be counted, so a
   *  legitimate user logging in repeatedly is never locked out. */
  fail(key: string): void;
  /** Forget a key's history, e.g. after a successful login. */
  clear(key: string): void;
  reset(): void;
}

/** Fixed-window counter; simple and dependency free. */
export function rateLimit(limit: number, windowMs: number): RateLimiter {
  const buckets = new Map<string, { count: number; resetAt: number }>();
  const live = (key: string, nowMs: number) => {
    const bucket = buckets.get(key);
    if (!bucket) return undefined;
    if (bucket.resetAt <= nowMs) {
      buckets.delete(key);
      return undefined;
    }
    return bucket;
  };
  return {
    allow(key: string): boolean {
      const bucket = live(key, Date.now());
      return !bucket || bucket.count < limit;
    },
    fail(key: string): void {
      const nowMs = Date.now();
      const bucket = live(key, nowMs);
      if (!bucket) buckets.set(key, { count: 1, resetAt: nowMs + windowMs });
      else bucket.count += 1;
    },
    clear(key: string): void {
      buckets.delete(key);
    },
    reset(): void {
      buckets.clear();
    },
  };
}
