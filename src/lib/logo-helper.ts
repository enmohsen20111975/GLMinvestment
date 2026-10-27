/**
 * logo-helper.ts — عقيدة السعر الواحد (Single Source of Truth) لـ logo_url
 * =====================================================================
 * BRAVO-FIX9 (تاريخي): مصدر مركزي واحد لـ logo_url من data_engine.db.stocks.
 *
 * (ALPHA-FUNDAMENTALS-AND-TABS، Task 1a — owner directive 2026-10-27):
 * «وجّه القراءة مباشرة من db/stocks.db لعمود logo_url بدلاً من المسار القديم».
 *
 * الاستراتيجية الجديدة (defensive، تشتغل قبل وبعد merge برافو):
 *   1. اقرأ logo_url من stocks.db.stocks (المصدر الرسمي بعد ما برافو يـ merge +
 *      يشغّل migrate_data_engine_to_stocks.py اللي بينقل logo_url + يبنيه من logoid).
 *   2. لو العمود مش موجود (pre-merge) أو السهم مش لاقي logo_url → fallback على
 *      data_engine.db.stocks (المصدر التاريخي الشغّال، 654/1098 populated).
 *
 * ده يضمن إن الأيقونات تظهر دلوقتي (من data_engine) AND تتدفق تلقائيًا من
 * stocks.db الرسمي لما برافو يـ merge — بدون أي تغيير في الـ frontend.
 */

import Database from 'better-sqlite3';
import path from 'path';

let _logoCache: Map<string, string> | null = null;
let _cacheTimestamp = 0;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/** يتحقق لو عمود معين موجود في جدول معين (defensive — pre-merge). */
function columnExists(db: Database.Database, table: string, column: string): boolean {
  try {
    const info = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
    return info.some((c) => c.name === column);
  } catch {
    return false;
  }
}

/**
 * Build logo lookup map.
 * (ALPHA-FUNDAMENTALS-AND-TABS): stocks.db أولاً (لو فيه logo_url)، ثم data_engine.db fallback.
 * Cached for 5 minutes to avoid repeated DB reads.
 */
export function getLogoLookup(): Map<string, string> {
  const now = Date.now();
  if (_logoCache && (now - _cacheTimestamp) < CACHE_TTL_MS) {
    return _logoCache;
  }

  const cache = new Map<string, string>();

  // ─── المصدر 1: stocks.db.stocks.logo_url (الرسمي، post-merge) ─────────────
  try {
    const stocksDbPath = path.join(process.cwd(), 'db', 'stocks.db');
    const stocksDb = new Database(stocksDbPath, { readonly: true, timeout: 5000 });
    stocksDb.pragma('busy_timeout = 5000');
    if (columnExists(stocksDb, 'stocks', 'logo_url')) {
      const rows = stocksDb.prepare(
        'SELECT UPPER(ticker) as sym, logo_url FROM stocks WHERE logo_url IS NOT NULL AND logo_url != ?'
      ).all('') as Array<{ sym: string; logo_url: string }>;
      for (const r of rows) {
        if (r.sym && r.logo_url) cache.set(r.sym, String(r.logo_url));
      }
    }
    stocksDb.close();
  } catch {
    // stocks.db مش متوفر أو العمود مش موجود (pre-merge) → نكمل على data_engine fallback.
  }

  // ─── المصدر 2 (fallback): data_engine.db.stocks.logo_url (التاريخي الشغّال) ─
  // بس نعبّي اللي ناقص (ما نطنشش اللي stocks.db جابهم عشان ما نoverwriteش المصدر الرسمي).
  try {
    const deDbPath = path.join(process.cwd(), 'db', 'data_engine.db');
    const deDb = new Database(deDbPath, { readonly: true, timeout: 5000 });
    deDb.pragma('busy_timeout = 5000');
    const rows = deDb.prepare(
      'SELECT UPPER(symbol) as sym, logo_url FROM stocks WHERE logo_url IS NOT NULL AND logo_url != ?'
    ).all('') as Array<{ sym: string; logo_url: string }>;
    for (const r of rows) {
      if (r.sym && r.logo_url && !cache.has(r.sym)) {
        cache.set(r.sym, String(r.logo_url));
      }
    }
    deDb.close();
  } catch {
    // silent fail — logos are non-critical (frontend has fallback).
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
