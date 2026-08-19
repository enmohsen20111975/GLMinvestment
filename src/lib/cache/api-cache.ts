/**
 * In-Memory API Response Cache
 * ذاكرة التخزين المؤقت للردود
 *
 * Simple TTL-based cache for API routes to avoid re-computing on every request.
 * Default TTL: 5 minutes (matches the background analyzer cycle)
 */

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
  computedAt: number;
}

const cache = new Map<string, CacheEntry<unknown>>();

// Default TTL: 5 minutes
const DEFAULT_TTL_MS = 5 * 60 * 1000;

/**
 * Get cached data if still fresh
 */
export function getCached<T>(key: string): T | null {
  const entry = cache.get(key);
  if (!entry) return null;
  
  if (Date.now() > entry.expiresAt) {
    cache.delete(key);
    return null;
  }
  
  return entry.data as T;
}

/**
 * Set cache entry with TTL
 */
export function setCached<T>(key: string, data: T, ttlMs: number = DEFAULT_TTL_MS): void {
  cache.set(key, {
    data,
    expiresAt: Date.now() + ttlMs,
    computedAt: Date.now(),
  });
}

/**
 * Get or compute cached data
 * If cache is fresh, returns cached data. Otherwise, calls computeFn and caches result.
 * Supports both sync and async compute functions.
 */
export async function getOrCompute<T>(
  key: string,
  computeFn: () => T | Promise<T>,
  ttlMs: number = DEFAULT_TTL_MS,
): Promise<T> {
  const cached = getCached<T>(key);
  if (cached !== null) {
    return cached;
  }
  
  const data = await computeFn();
  setCached(key, data, ttlMs);
  return data;
}

/**
 * Invalidate a specific cache key
 */
export function invalidateCache(key: string): boolean {
  return cache.delete(key);
}

/**
 * Invalidate all cache entries matching a prefix
 */
export function invalidateCachePrefix(prefix: string): number {
  let count = 0;
  for (const key of cache.keys()) {
    if (key.startsWith(prefix)) {
      cache.delete(key);
      count++;
    }
  }
  return count;
}

/**
 * Get cache stats
 */
export function getCacheStats(): { entries: number; keys: string[] } {
  return {
    entries: cache.size,
    keys: Array.from(cache.keys()),
  };
}

/**
 * Clean up expired entries (call periodically)
 */
export function cleanupExpired(): number {
  let count = 0;
  const now = Date.now();
  for (const [key, entry] of cache.entries()) {
    if (now > entry.expiresAt) {
      cache.delete(key);
      count++;
    }
  }
  return count;
}

// Auto-cleanup every 10 minutes
if (typeof setInterval !== 'undefined') {
  setInterval(cleanupExpired, 10 * 60 * 1000);
}
