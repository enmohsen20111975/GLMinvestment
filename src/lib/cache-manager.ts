/**
 * cache-manager.ts — Frontend Cache Manager (PKG3 — SSOT)
 * ========================================================
 * TypeScript mirror of `vps-service/core/cache_manager.py` so that
 * the frontend and backend share ONE caching contract.
 *
 * The scoping report found 3 separate Map-based caches in
 * data-adapter.ts / multi-source-adapter.ts / egxpy-bridge.ts with
 * different TTLs (2/3/5 min). This module is the single registry.
 *
 * Design:
 *   - Singleton `cache` instance (process-wide on the server).
 *   - TTL per entry (default 60s — matches Python).
 *   - LRU eviction when `maxEntries` is hit (default 512 — matches Python).
 *   - Thread-safe in Node via a simple Map (single-threaded event loop).
 *   - `getOrCompute()` — the canonical "read-through" helper.
 *
 * Usage:
 *   import { cache } from '@/lib/cache-manager';
 *   const price = await cache.getOrCompute('price:COMI', () => fetchPrice('COMI'), 60_000);
 */

export interface CacheEntry<V> {
  value: V;
  expiresAt: number;   // epoch ms
  bornAt: number;      // epoch ms — for LRU
}

const DEFAULT_TTL_MS = 60_000;       // 60s — matches Python
const DEFAULT_MAX = 512;              // matches Python max entries

class CacheManager {
  private store = new Map<string, CacheEntry<unknown>>();
  private ttlMs: number;
  private maxEntries: number;
  hits = 0;
  misses = 0;

  constructor(ttlMs: number = DEFAULT_TTL_MS, maxEntries: number = DEFAULT_MAX) {
    this.ttlMs = ttlMs;
    this.maxEntries = maxEntries;
  }

  /** Get a value if fresh, else undefined. */
  get<V>(key: string): V | undefined {
    const entry = this.store.get(key);
    if (!entry) {
      this.misses++;
      return undefined;
    }
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      this.misses++;
      return undefined;
    }
    // LRU: re-insert to mark recently used (Map preserves insertion order).
    this.store.delete(key);
    this.store.set(key, entry);
    this.hits++;
    return entry.value as V;
  }

  /** Set a value with an optional custom TTL. */
  set<V>(key: string, value: V, ttlMs: number = this.ttlMs): void {
    // Evict the oldest if at capacity.
    if (this.store.size >= this.maxEntries) {
      const oldest = this.store.keys().next().value;
      if (oldest !== undefined) this.store.delete(oldest);
    }
    const now = Date.now();
    this.store.set(key, { value, expiresAt: now + ttlMs, bornAt: now });
  }

  /** Remove a single key. */
  delete(key: string): void {
    this.store.delete(key);
  }

  /** Clear everything. */
  clear(): void {
    this.store.clear();
  }

  /** Read-through: return cached if fresh, else compute + cache. */
  async getOrCompute<V>(
    key: string,
    compute: () => Promise<V>,
    ttlMs: number = this.ttlMs
  ): Promise<V> {
    const cached = this.get<V>(key);
    if (cached !== undefined) return cached;
    const value = await compute();
    this.set(key, value, ttlMs);
    return value;
  }

  /** Stats for observability / audit. */
  stats() {
    return {
      entries: this.store.size,
      hits: this.hits,
      misses: this.misses,
      hitRate: this.hits + this.misses > 0
        ? this.hits / (this.hits + this.misses)
        : 0,
      ttlMs: this.ttlMs,
      maxEntries: this.maxEntries,
    };
  }
}

/** Process-wide singleton (one cache registry, like Python's). */
export const cache = new CacheManager();

export { CacheManager };
