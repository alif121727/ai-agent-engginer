export interface RateLimiter {
  /** Returns true when the call is allowed, false when the bucket is exhausted. */
  allow(key: string): boolean;
  reset(): void;
}

/** Fixed-window counter; simple and dependency free. */
export function rateLimit(limit: number, windowMs: number): RateLimiter {
  const buckets = new Map<string, { count: number; resetAt: number }>();
  return {
    allow(key: string): boolean {
      const nowMs = Date.now();
      const bucket = buckets.get(key);
      if (!bucket || bucket.resetAt <= nowMs) {
        buckets.set(key, { count: 1, resetAt: nowMs + windowMs });
        return true;
      }
      if (bucket.count >= limit) return false;
      bucket.count += 1;
      return true;
    },
    reset(): void {
      buckets.clear();
    },
  };
}
