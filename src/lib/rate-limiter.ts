/**
 * rate-limiter.ts — Simple in-memory rate limiter (per-IP, per-endpoint).
 * ==========================================================================
 *
 * FIX-WAVE-1-SECURITY (AUDIT-DEEP-4 #2): prevents brute-force attacks against
 * /api/auth/login + /api/auth/register + /api/auth/google-signin + /api/b2b/signup
 * and mass-account-creation via /api/auth/register + /api/b2b/signup.
 *
 * DESIGN NOTES:
 *   - In-memory only. Each Next.js worker keeps its own `RATE_LIMIT_MAP`. For a
 *     single-process sandbox deployment this is sufficient. For a multi-instance
 *     production deployment, replace this module with a Redis-backed limiter
 *     (e.g. `@upstash/ratelimit` or `rate-limiter-flexible` with Redis store).
 *   - The Map is bounded by (unique IPs × unique keys). For very-high-traffic
 *     production you may want to add periodic eviction of expired entries —
 *     currently entries are lazily evicted on next access after `resetAt`.
 *   - Token-bucket-ish semantics: every call within the window increments
 *     `count`. The first call sets `count = 1`. After `resetAt`, the entry is
 *     replaced with a fresh window starting at `count = 1`.
 */

const RATE_LIMIT_MAP = new Map<string, { count: number; resetAt: number }>();

export interface RateLimitResult {
  ok: boolean;
  remaining: number;
  resetAt: number;
}

/**
 * Check the rate limit for `key`.
 *
 * @param key      Composite key (e.g. `auth:<ip>`).
 * @param max      Maximum number of requests allowed in the window.
 * @param windowMs Window size in milliseconds.
 * @returns        `{ ok, remaining, resetAt }`. `ok === false` means the
 *                 caller MUST reject the request (typically with HTTP 429).
 */
export function rateLimit(key: string, max: number, windowMs: number): RateLimitResult {
  const now = Date.now();
  const entry = RATE_LIMIT_MAP.get(key);
  if (!entry || entry.resetAt < now) {
    RATE_LIMIT_MAP.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, remaining: max - 1, resetAt: now + windowMs };
  }
  entry.count++;
  return {
    ok: entry.count <= max,
    remaining: Math.max(0, max - entry.count),
    resetAt: entry.resetAt,
  };
}

/**
 * Convenience: 5 auth attempts per 60 seconds per IP.
 *
 * Used by /api/auth/login + /api/auth/register + /api/auth/google-signin
 * + /api/b2b/signup to defeat brute-force + mass-signup abuse.
 */
export function checkAuthRateLimit(ip: string): RateLimitResult {
  return rateLimit(`auth:${ip}`, 5, 60_000);
}

/**
 * Optional: clear all entries (used by tests).
 */
export function __clearRateLimitMapForTests(): void {
  RATE_LIMIT_MAP.clear();
}
