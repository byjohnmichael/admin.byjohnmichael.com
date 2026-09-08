// In-memory sliding-window rate limiter for the login endpoint.
//
// Good enough for the single `next start` instance this app runs as: the
// counters live in module scope for the life of the process and reset on a
// service restart. Not shared across instances (there's only one).

const DEFAULT_MAX = Number(process.env.LOGIN_RATE_LIMIT_MAX ?? 5);
const DEFAULT_WINDOW_MS =
  Number(process.env.LOGIN_RATE_LIMIT_WINDOW_MIN ?? 15) * 60_000;

// Guard against unbounded growth if someone spoofs X-Forwarded-For.
const MAX_KEYS = 5_000;

// key -> timestamps (ms) of recent failed attempts
const failures = new Map<string, number[]>();

export type RateResult = {
  allowed: boolean;
  remaining: number;
  retryAfterSec: number;
};

function recent(key: string, now: number, windowMs: number): number[] {
  return (failures.get(key) ?? []).filter((t) => now - t < windowMs);
}

/** Read-only: may this key try again right now? Does not record anything. */
export function checkRateLimit(
  key: string,
  max = DEFAULT_MAX,
  windowMs = DEFAULT_WINDOW_MS,
): RateResult {
  const now = Date.now();
  const hits = recent(key, now, windowMs);
  const allowed = hits.length < max;
  const retryAfterSec = allowed
    ? 0
    : Math.max(1, Math.ceil((windowMs - (now - hits[0])) / 1000));
  return { allowed, remaining: Math.max(0, max - hits.length), retryAfterSec };
}

/** Record one failed attempt against the key. */
export function recordFailure(
  key: string,
  windowMs = DEFAULT_WINDOW_MS,
): void {
  const now = Date.now();
  const hits = recent(key, now, windowMs);
  hits.push(now);
  failures.set(key, hits);

  // Opportunistic cleanup of stale keys.
  if (failures.size > MAX_KEYS) {
    failures.clear();
    failures.set(key, hits);
    return;
  }
  for (const [k, ts] of failures) {
    const kept = ts.filter((t) => now - t < windowMs);
    if (kept.length === 0) failures.delete(k);
  }
}

/** Clear the key after a successful login. */
export function resetRateLimit(key: string): void {
  failures.delete(key);
}
