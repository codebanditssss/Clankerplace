import "server-only";

/**
 * In-process token bucket rate limiter. Cheap and good enough for a
 * single-VM deployment. Keyed by an arbitrary string (typically
 * `route + ip + uid`). Resets when the process restarts.
 *
 * For a multi-VM deployment you'd swap this for a Redis-backed limiter,
 * but the API stays identical so callers don't change.
 */

type Bucket = {
  tokens: number;
  last: number; // ms
};

const buckets = new Map<string, Bucket>();

export type RateLimitOptions = {
  /** Tokens added per second. */
  rate: number;
  /** Maximum bucket size (= burst). */
  burst: number;
};

export type RateLimitResult = {
  ok: boolean;
  remaining: number;
  /** Seconds the caller should wait before retrying when !ok. */
  retryAfterSeconds: number;
};

export function rateLimit(
  key: string,
  opts: RateLimitOptions,
): RateLimitResult {
  const now = Date.now();
  let b = buckets.get(key);
  if (!b) {
    b = { tokens: opts.burst, last: now };
    buckets.set(key, b);
  } else {
    const elapsedSec = (now - b.last) / 1000;
    b.tokens = Math.min(opts.burst, b.tokens + elapsedSec * opts.rate);
    b.last = now;
  }
  if (b.tokens < 1) {
    return {
      ok: false,
      remaining: 0,
      retryAfterSeconds: Math.ceil((1 - b.tokens) / opts.rate),
    };
  }
  b.tokens -= 1;
  return { ok: true, remaining: Math.floor(b.tokens), retryAfterSeconds: 0 };
}

/** Extracts a best-effort client IP for keying. Falls back to a fixed
 * key so the limiter still applies in dev. */
export function clientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  const realIp = req.headers.get("x-real-ip");
  if (realIp) return realIp;
  return "0.0.0.0";
}

/** Periodically prune cold buckets. Called from the reconciler tick. */
export function pruneStale(maxAgeMs = 60 * 60 * 1000): number {
  const cutoff = Date.now() - maxAgeMs;
  let n = 0;
  for (const [k, b] of buckets) {
    if (b.last < cutoff) {
      buckets.delete(k);
      n++;
    }
  }
  return n;
}
