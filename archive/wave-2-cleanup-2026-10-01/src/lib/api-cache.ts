/**
 * API Response Cache — نظام تخزين مؤقت للاستجابات
 * =================================================
 * يحل مشكلة البطء الشديدة:
 * - كل API route كان يفتح DB + يفحص ملفات كل مرة
 * - الآن: النتائج تُخزّن في الذاكرة لـ 30-60 ثانية
 * - تقليل زمن الاستجابة من 0.3-1.1s → 0.001-0.01s
 */

interface CacheEntry<T> {
  data: T;
  timestamp: number;
  ttl: number; // milliseconds
}

// In-memory cache (survives across requests in same process)
const cache = new Map<string, CacheEntry<unknown>>();

/**
 * Get cached data or execute fetcher and cache result.
 * @param key - unique cache key (e.g. "stocks:EGX:500")
 * @param fetcher - async function to fetch fresh data
 * @param ttlMs - cache lifetime in ms (default: 30000 = 30s)
 */
export async function cached<T>(
  key: string,
  fetcher: () => Promise<T>,
  ttlMs: number = 30000
): Promise<T> {
  const entry = cache.get(key) as CacheEntry<T> | undefined;
  const now = Date.now();

  // Return cached if still valid
  if (entry && (now - entry.timestamp) < entry.ttl) {
    return entry.data;
  }

  // Fetch fresh data
  const data = await fetcher();
  cache.set(key, { data, timestamp: now, ttl: ttlMs });

  return data;
}

/**
 * Clear cache for a specific key or pattern.
 * @param keyOrPattern - exact key or prefix (e.g. "stocks:*")
 */
export function clearCache(keyOrPattern?: string): void {
  if (!keyOrPattern) {
    cache.clear();
    return;
  }

  if (keyOrPattern.endsWith('*')) {
    const prefix = keyOrPattern.slice(0, -1);
    for (const key of cache.keys()) {
      if (key.startsWith(prefix)) {
        cache.delete(key);
      }
    }
  } else {
    cache.delete(keyOrPattern);
  }
}

/**
 * Get cache statistics.
 */
export function getCacheStats() {
  return {
    entries: cache.size,
    keys: Array.from(cache.keys()).slice(0, 20), // first 20 keys
  };
}

/**
 * Cache-Control headers for browser caching.
 * Use in API routes: return NextResponse.json(data, { headers: cacheHeaders(30) })
 */
export function cacheHeaders(maxAgeSeconds: number = 30): Record<string, string> {
  return {
    'Cache-Control': `public, s-maxage=${maxAgeSeconds}, stale-while-revalidate=${maxAgeSeconds * 2}`,
  };
}
