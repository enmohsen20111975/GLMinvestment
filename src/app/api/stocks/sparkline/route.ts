import { NextRequest, NextResponse } from 'next/server';
import Database from 'better-sqlite3';
import { join } from 'path';

export const dynamic = 'force-dynamic';

const SPARKLINE_CACHE_TTL_MS = 60_000;
const sparklineCache = new Map<string, { ts: number; data: any }>();

function cacheKey(ticker: string, days: number): string {
  return `${ticker.toUpperCase()}|${days}`;
}

function getCached(key: string) {
  const hit = sparklineCache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.ts > SPARKLINE_CACHE_TTL_MS) {
    sparklineCache.delete(key);
    return null;
  }
  return hit.data;
}

function setCache(key: string, data: any) {
  sparklineCache.set(key, { ts: Date.now(), data });
  if (sparklineCache.size > 2000) {
    const first = sparklineCache.keys().next().value;
    if (first) sparklineCache.delete(first);
  }
}

const INDEX_ALIASES: Record<string, string[]> = {
  EGX30: ['EGX30', 'EGX30ETF', '.EGX30', '^CASE30'],
  EGX70: ['EGX70', '.EGX70', 'EGX70EWI'],
  EGX100: ['EGX100', '.EGX100'],
  EGX33: ['EGX33', 'EGX33SHAR'],
  TASI: ['TASI', '^TASI', '.TASI', 'TADAWUL'],
};

function getCandidateTickers(t: string): string[] {
  const upper = t.toUpperCase().trim();
  return INDEX_ALIASES[upper] || [upper, t.trim()];
}

function fetchSingleSparkline(t: string, days: number) {
  const key = cacheKey(t, days);
  const cached = getCached(key);
  if (cached) return cached;

  const candidates = getCandidateTickers(t);
  const upper = t.toUpperCase().trim();
  const isIndex = upper.startsWith('EGX') || upper.startsWith('TASI') || upper.startsWith('^') || upper in INDEX_ALIASES;
  const phPath = join(process.cwd(), 'db', 'price_history.db');
  const stocksPath = join(process.cwd(), 'db', 'stocks.db');

  // 1. INDICES PRIORITY: stocks.db.index_daily_prices contains live updated index data (synced daily)
  // price_history.db contains stale archive data up to Sept 2026 for index symbols.
  if (isIndex) {
    try {
      const stocksDb = new Database(stocksPath, { readonly: true, timeout: 3000 });
      for (const cand of candidates) {
        const rows = stocksDb.prepare(`
          SELECT price_date, close
          FROM index_daily_prices
          WHERE symbol = ? AND close > 0
          ORDER BY price_date DESC
          LIMIT ?
        `).all(cand, days) as { price_date: string; close: number }[];
        if (rows.length > 0) {
          stocksDb.close();
          const prices = rows.reverse().map(r => Number(r.close));
          const first = prices[0];
          const last = prices[prices.length - 1];
          const result = {
            ticker: t,
            prices,
            min: Math.min(...prices),
            max: Math.max(...prices),
            first,
            last,
            change_pct: first > 0 ? ((last - first) / first) * 100 : 0,
            days: prices.length,
            source: 'stocks.db.index_daily_prices',
          };
          setCache(key, result);
          return result;
        }
      }
      stocksDb.close();
    } catch {}
  }

  // PREDICTIONS-CLEANUP-1 (2026-10-27): stocks.db.stock_daily_prices FIRST (live data
  // from tradingview_scanner_live + daily_price_updater). price_history.db is stale
  // (last update Sept 2026) — keep as fallback only.
  // 2. stocks.db.stock_daily_prices (LIVE — primary)
  try {
    const stocksDb = new Database(stocksPath, { readonly: true, timeout: 3000 });
    for (const cand of candidates) {
      const rows = stocksDb.prepare(`
        SELECT price_date, close_price
        FROM stock_daily_prices
        WHERE ticker = ? AND close_price > 0
        ORDER BY price_date DESC
        LIMIT ?
      `).all(cand, days) as { price_date: string; close_price: number }[];
      if (rows.length > 0) {
        stocksDb.close();
        const prices = rows.reverse().map(r => Number(r.close_price));
        const first = prices[0];
        const last = prices[prices.length - 1];
        const result = {
          ticker: t,
          prices,
          min: Math.min(...prices),
          max: Math.max(...prices),
          first,
          last,
          change_pct: first > 0 ? ((last - first) / first) * 100 : 0,
          days: prices.length,
          source: 'stocks.db.stock_daily_prices (live)',
        };
        setCache(key, result);
        return result;
      }
    }
    stocksDb.close();
  } catch {}

  // 3. price_history.db (stale archive — fallback only)
  try {
    const phDb = new Database(phPath, { readonly: true, timeout: 3000 });
    for (const cand of candidates) {
      const rows = phDb.prepare(`
        SELECT date, close_price
        FROM price_history
        WHERE ticker = ? AND close_price > 0
        ORDER BY date DESC
        LIMIT ?
      `).all(cand, days) as { date: string; close_price: number }[];
      if (rows.length > 0) {
        phDb.close();
        const prices = rows.reverse().map(r => Number(r.close_price));
        const first = prices[0];
        const last = prices[prices.length - 1];
        const result = {
          ticker: t,
          prices,
          min: Math.min(...prices),
          max: Math.max(...prices),
          first,
          last,
          change_pct: first > 0 ? ((last - first) / first) * 100 : 0,
          days: prices.length,
          source: 'price_history.db (stale archive)',
        };
        setCache(key, result);
        return result;
      }
    }
    phDb.close();
  } catch {}

    // ALPHA-FAB-FIX-SPARKLINE-001: removed market_indices fabrication block.
    // كان بيخترع 15 نقطة سعر من current_value واحد + Math.sin() noise (Rule 27 violation).
    // لو مفيش OHLCV حقيقي → empty (سياسة الفراغ Rule 27 NO-FAKE-DATA).

    // 4. stocks.db.index_daily_prices — for INDEX symbols (EGX30/EGX70/EGX100/EGX33/TASI).
    // These have 21,616 historical rows (built by scripts/backfill_indices_history.py +
    // scripts/sync_market_indices_live.py). Without this source, index sparklines were empty.
    try {
      const stocksDb2 = new Database(stocksPath, { readonly: true, timeout: 3000 });
      for (const cand of candidates) {
        const rows = stocksDb2.prepare(`
          SELECT price_date, close
          FROM index_daily_prices
          WHERE symbol = ? AND close > 0
          ORDER BY price_date DESC
          LIMIT ?
        `).all(cand, days) as { price_date: string; close: number }[];
        if (rows.length > 0) {
          stocksDb2.close();
          const prices = rows.reverse().map(r => Number(r.close));
          const first = prices[0];
          const last = prices[prices.length - 1];
          const result = {
            ticker: t,
            prices,
            min: Math.min(...prices),
            max: Math.max(...prices),
            first,
            last,
            change_pct: first > 0 ? ((last - first) / first) * 100 : 0,
            days: prices.length,
            source: 'stocks.db.index_daily_prices',
          };
          setCache(key, result);
          return result;
        }
      }
      stocksDb2.close();
    } catch {}

  const empty = {
    ticker: t,
    prices: [],
    min: 0,
    max: 0,
    first: 0,
    last: 0,
    change_pct: 0,
    days: 0,
    source: 'none',
  };
  setCache(key, empty);
  return empty;
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const rawTicker = searchParams.get('ticker') || '';
    const tickersParam = searchParams.get('tickers') || '';
    const days = Math.min(90, Math.max(7, parseInt(searchParams.get('days') || '30', 10)));

    if (!rawTicker && !tickersParam) {
      return NextResponse.json({ success: false, error: 'ticker or tickers required' }, { status: 400 });
    }

    if (tickersParam) {
      const list = tickersParam.split(',').map(s => s.trim()).filter(Boolean).slice(0, 50);
      const results: Record<string, any> = {};
      for (const t of list) {
        results[t] = fetchSingleSparkline(t, days);
      }
      return NextResponse.json({ success: true, data: results });
    }

    const singleResult = fetchSingleSparkline(rawTicker, days);
    return NextResponse.json({ success: true, ...singleResult });
  } catch (e) {
    console.error('[stocks:sparkline]', e);
    return NextResponse.json({
      success: false,
      error: 'internal_error',
    }, { status: 500 });
  }
}
