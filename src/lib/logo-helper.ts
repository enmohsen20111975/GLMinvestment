/**
 * logo-helper.ts — عقيدة السعر الواحد (Single Source of Truth) لـ logo_url
 * =====================================================================
 * BRAVO-FIX9: مصدر مركزي واحد لـ logo_url.
 *
 * logo_url موجود في data_engine.db.stocks (654/1098 populated, TradingView URLs).
 * stocks.db.stocks مش فيها logo_url — فأي query ليها بـ fail.
 *
 * الـ helper ده بيـ build lookup map من data_engine.db + بيـ cache.
 * كل الـ endpoints لازم تستخدمه عشان تـ inject logo_url.
 */

import Database from 'better-sqlite3';
import path from 'path';

let _logoCache: Map<string, string> | null = null;
let _cacheTimestamp = 0;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Build logo lookup map from data_engine.db.stocks.
 * Cached for 5 minutes to avoid repeated DB reads.
 */
export function getLogoLookup(): Map<string, string> {
  const now = Date.now();
  if (_logoCache && (now - _cacheTimestamp) < CACHE_TTL_MS) {
    return _logoCache;
  }

  const cache = new Map<string, string>();
  try {
    const dbPath = path.join(process.cwd(), 'db', 'data_engine.db');
    const db = new Database(dbPath, { readonly: true, timeout: 5000 });
    db.pragma('busy_timeout = 5000');

    const rows = db.prepare(
      'SELECT UPPER(symbol) as sym, logo_url FROM stocks WHERE logo_url IS NOT NULL AND logo_url != ?'
    ).all('') as Array<{ sym: string; logo_url: string }>;

    for (const r of rows) {
      if (r.sym && r.logo_url) {
        cache.set(r.sym, String(r.logo_url));
      }
    }
    db.close();
  } catch (e) {
    // silent fail — logos are non-critical (frontend has fallback)
  }

  _logoCache = cache;
  _cacheTimestamp = now;
  return cache;
}

/**
 * Get logo_url for a single ticker.
 * Returns null if not found (frontend will use fallback icon).
 */
export function getLogoUrl(ticker: string | null | undefined): string | null {
  if (!ticker) return null;
  const lookup = getLogoLookup();
  return lookup.get(ticker.toUpperCase()) ?? null;
}

/**
 * Enrich an array of items with logo_url.
 * Each item must have a 'ticker' or 'symbol' field.
 * Mutates items in place + returns the same array.
 */
export function enrichWithLogos<T extends Record<string, unknown>>(
  items: T[],
  tickerField: string = 'ticker'
): T[] {
  const lookup = getLogoLookup();
  for (const item of items) {
    const record = item as Record<string, unknown>;
    const ticker = String(record[tickerField] || record['symbol'] || '').toUpperCase();
    if (ticker && !record['logo_url']) {
      const logo = lookup.get(ticker);
      if (logo) {
        record['logo_url'] = logo;
      }
    }
  }
  return items;
}
