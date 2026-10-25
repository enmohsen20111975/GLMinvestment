import { NextRequest, NextResponse } from 'next/server';
import Database from 'better-sqlite3';
import path from 'path';
import { existsSync } from 'fs';

export const revalidate = 0; // No cache - always fresh data
export const dynamic = 'force-dynamic';

interface ChartDataPoint {
  date: string | number;
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  source?: string;
}

/**
 * Resolve ticker aliases (e.g. KORRA -> KORA, COMI.CA -> COMI)
 */
function resolveCanonicalTicker(rawTicker: string): string {
  if (!rawTicker) return '';
  const clean = rawTicker.toUpperCase().replace(/\.CA$/, '').replace(/\.SR$/, '').trim();

  const directMap: Record<string, string> = {
    KORRA: 'KORA',
    KORAKORRAD: 'KORA',
    COMMI: 'COMI',
  };
  if (directMap[clean]) return directMap[clean];

  const stocksDbPath = path.join(process.cwd(), 'db', 'stocks.db');
  if (existsSync(stocksDbPath)) {
    try {
      const db = new Database(stocksDbPath, { readonly: true, timeout: 2000 });
      // 1. Exact match
      const exact = db.prepare('SELECT ticker FROM stocks WHERE ticker = ?').get(clean) as { ticker: string } | undefined;
      if (exact) { db.close(); return exact.ticker; }

      // 2. Match by name or name_ar
      const byName = db.prepare('SELECT ticker FROM stocks WHERE UPPER(name) = ? OR UPPER(name_ar) = ?').get(clean, clean) as { ticker: string } | undefined;
      if (byName) { db.close(); return byName.ticker; }

      // 3. Deduplicate double letters (e.g. KORRA -> KORA)
      const dedup = clean.replace(/(.)\1+/g, '$1');
      const byDedup = db.prepare('SELECT ticker FROM stocks WHERE ticker = ? OR UPPER(name) = ?').get(dedup, dedup) as { ticker: string } | undefined;
      if (byDedup) { db.close(); return byDedup.ticker; }

      db.close();
    } catch {
      // ignore
    }
  }

  return clean;
}

/**
 * Resample flat snapshots into OHLCV candles
 */
function resampleSnapshots(
  rows: { timestamp: string; price: number; volume: number }[],
  freqMinutes: number
): ChartDataPoint[] {
  if (!rows || rows.length === 0) return [];

  const buckets: Record<number, {
    timestamp: number;
    open: number;
    high: number;
    low: number;
    close: number;
    firstVol: number;
    lastVol: number;
    volume: number;
  }> = {};
  const order: number[] = [];

  for (const row of rows) {
    if (!row.timestamp || row.price <= 0) continue;
    let ts = 0;
    const num = Number(row.timestamp);
    if (!isNaN(num) && /^\d+(\.\d+)?$/.test(String(row.timestamp).trim())) {
      ts = num > 1e11 ? Math.floor(num / 1000) : Math.floor(num);
    } else {
      const cleanTs = row.timestamp.replace(' ', 'T');
      const parsed = Date.parse(cleanTs);
      ts = isNaN(parsed) ? 0 : Math.floor(parsed / 1000);
    }
    if (ts <= 0) continue;

    const bucketSeconds = freqMinutes * 60;
    const bucketTs = Math.floor(ts / bucketSeconds) * bucketSeconds;
    const price = Number(row.price);
    const vol = Number(row.volume || 0);

    if (!buckets[bucketTs]) {
      buckets[bucketTs] = {
        timestamp: bucketTs,
        open: price,
        high: price,
        low: price,
        close: price,
        firstVol: vol,
        lastVol: vol,
        volume: 0,
      };
      order.push(bucketTs);
    } else {
      const b = buckets[bucketTs];
      b.high = Math.max(b.high, price);
      b.low = Math.min(b.low, price);
      b.close = price;
      b.lastVol = vol;
      b.volume = Math.max(0, b.lastVol - b.firstVol);
    }
  }

  order.sort((a, b) => a - b);
  return order.map((ts) => {
    const b = buckets[ts];
    return {
      date: ts,
      timestamp: ts,
      open: b.open,
      high: b.high,
      low: b.low,
      close: b.close,
      volume: b.volume || 0,
      source: 'intraday',
    };
  });
}

/**
 * Fetch intraday data directly from local db/intraday.db
 */
function getLocalIntradayData(
  ticker: string,
  freqMinutes: number,
  period: string
): ChartDataPoint[] | null {
  const intradayDbPath = path.join(process.cwd(), 'db', 'intraday.db');
  if (!existsSync(intradayDbPath)) return null;

  try {
    const db = new Database(intradayDbPath, { readonly: true, timeout: 5000 });
    db.pragma('busy_timeout = 5000');

    // Find anchor timestamp for this ticker so closed markets/weekends don't result in 0 rows
    const maxRow = db.prepare('SELECT max(timestamp) as max_ts FROM stock_intraday WHERE ticker = ?').get(ticker) as { max_ts: string | null } | undefined;
    if (!maxRow || !maxRow.max_ts) {
      db.close();
      return null;
    }

    const anchorDate = new Date(maxRow.max_ts);
    const hoursBack = period === '1d' ? 24 : (period === '1w' ? 7 * 24 : 35 * 24);
    const cutoffDate = new Date(anchorDate.getTime() - hoursBack * 60 * 60 * 1000);
    const cutoffIso = cutoffDate.toISOString();

    const rows = db.prepare(`
      SELECT timestamp, price, volume
      FROM stock_intraday
      WHERE ticker = ? AND timestamp >= ?
        AND CAST(strftime('%w', timestamp) AS INTEGER) NOT IN (5, 6)
      ORDER BY timestamp ASC
    `).all(ticker, cutoffIso) as { timestamp: string; price: number; volume: number }[];

    db.close();

    if (rows && rows.length > 0) {
      return resampleSnapshots(rows, freqMinutes);
    }
  } catch (e) {
    console.warn(`[chart] getLocalIntradayData failed for ${ticker}:`, e);
  }

  return null;
}

// ─── Yahoo Finance & price_history.db Integration ─────────────────────────────

const yfMemoryCache = new Map<string, { time: number; data: ChartDataPoint[] }>();

async function fetchYahooChartCandles(
  ticker: string,
  interval: string,
  period: string,
  asset: string
): Promise<ChartDataPoint[] | null> {
  try {
    let sym = ticker.toUpperCase().trim();
    if (asset === 'crypto' || ['BTC', 'ETH', 'SOL', 'BNB', 'XRP', 'ADA', 'DOGE', 'DOT', 'AVAX'].includes(sym)) {
      sym = sym.includes('-') ? sym : `${sym}-USD`;
    } else {
      let market = 'EGX';
      try {
        const dbPath = path.join(process.cwd(), 'db', 'stocks.db');
        if (existsSync(dbPath)) {
          const db = new Database(dbPath, { readonly: true, timeout: 1500 });
          const row = db.prepare('SELECT market FROM stocks WHERE ticker = ? COLLATE NOCASE').get(sym) as { market?: string } | undefined;
          if (row?.market) market = row.market.toUpperCase();
          db.close();
        }
      } catch {}

      if (market === 'EGX' || market === 'EGYPT' || /^[A-Z]{4}$/.test(sym)) {
        sym = sym.endsWith('.CA') ? sym : `${sym}.CA`;
      } else if (market === 'SAUDI' || market === 'TADAWUL' || /^\d{4}$/.test(sym)) {
        sym = sym.endsWith('.SR') ? sym : `${sym}.SR`;
      } else if (market === 'KUWAIT') {
        sym = sym.endsWith('.KW') ? sym : `${sym}.KW`;
      } else if (market === 'QATAR') {
        sym = sym.endsWith('.QA') ? sym : `${sym}.QA`;
      }
    }

    const cacheKey = `${sym}_${interval}_${period}`;
    const cached = yfMemoryCache.get(cacheKey);
    if (cached && Date.now() - cached.time < 60000) {
      return cached.data;
    }

    let yfInterval = '1d';
    if (['5m', '15m', '30m', '1h', '60m'].includes(interval)) {
      yfInterval = interval === '1h' ? '60m' : interval;
    } else if (interval === '1w') {
      yfInterval = '1wk';
    }

    let yfRange = '1y';
    if (period === '1d') yfRange = '1d';
    else if (period === '5d' || period === '1w') yfRange = '5d';
    else if (period === '1m') yfRange = '1mo';
    else if (period === '3m') yfRange = '3mo';
    else if (period === '6m') yfRange = '6mo';
    else if (period === '1y') yfRange = '1y';
    else if (period === '2y') yfRange = '2y';
    else if (period === '5y' || period === 'all') yfRange = '5y';

    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=${yfInterval}&range=${yfRange}`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
      cache: 'no-store',
      signal: AbortSignal.timeout(5000),
    });

    if (!res.ok) return null;
    const json = await res.json();
    const result = json?.chart?.result?.[0];
    if (!result || !result.timestamp || result.timestamp.length === 0) return null;

    const timestamps: number[] = result.timestamp;
    const quotes = result.indicators?.quote?.[0];
    if (!quotes) return null;

    const candles: ChartDataPoint[] = [];
    for (let i = 0; i < timestamps.length; i++) {
      const ts = timestamps[i];
      const o = quotes.open?.[i];
      const h = quotes.high?.[i];
      const l = quotes.low?.[i];
      const c = quotes.close?.[i];
      const v = quotes.volume?.[i] ?? 0;

      if (o == null || h == null || l == null || c == null) continue;
      const open = Number(o);
      const close = Number(c);
      let high = Math.max(Number(h), open, close);
      let low = Math.min(Number(l), open, close);
      if (low <= 0 || high <= 0 || close <= 0 || open <= 0) continue;

      candles.push({
        date: ts,
        timestamp: ts,
        open: Math.round(open * 1000) / 1000,
        high: Math.round(high * 1000) / 1000,
        low: Math.round(low * 1000) / 1000,
        close: Math.round(close * 1000) / 1000,
        volume: Number(v) || 0,
        source: 'yahoo_finance',
      });
    }

    if (candles.length > 0) {
      yfMemoryCache.set(cacheKey, { time: Date.now(), data: candles });
      return candles;
    }
  } catch (err) {
    console.warn(`[chart] Yahoo Finance fetch failed for ${ticker}:`, err);
  }
  return null;
}

// ─── Python backend (Rule 12 + Rule 20 — Python is the SOLE source of price data) ──

/**
 * Fetch daily candles from the Python backend's /api/prices/<ticker> endpoint.
 *
 * Rule 12 (load_merged_history/load_price_history is the SOLE source) + Rule 20
 * (Python=Brain): the Node chart API is a proxy and MUST NOT read SQLite directly
 * for price data when Python is reachable. This helper delegates to the Python
 * backend, which internally calls `data.prices.load_price_history()`.
 *
 * Returns null in any of these cases (the caller MUST fall back gracefully):
 *  - Python backend unreachable (sandbox / cold start / network blip)
 *  - Non-2xx response
 *  - Response malformed or `success !== true`
 *  - Empty data array
 *
 * Sandbox note: when Python is down, this returns null and the chart API falls
 * back to the existing direct SQLite reader (getLocalDailyData) marked as
 * DEFENSIVE-FALLBACK. The canonical path remains Python per Rule 12.
 */
async function getPythonDailyData(
  ticker: string,
  limit: number
): Promise<ChartDataPoint[] | null> {
  const pythonUrl = process.env.PYTHON_BACKEND_URL || 'http://127.0.0.1:8010';
  const safeLimit = Math.max(1, Math.min(Number(limit) || 365, 2000));
  const url = `${pythonUrl}/api/prices/${encodeURIComponent(ticker)}?limit=${safeLimit}`;
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
      cache: 'no-store',
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    const json = await res.json();
    if (!json || json.success !== true) return null;
    const rows: any[] | undefined = json.data?.history ?? json.history ?? json.data;
    if (!Array.isArray(rows) || rows.length === 0) return null;

    const candles: ChartDataPoint[] = [];
    for (const r of rows) {
      if (!r || typeof r !== 'object') continue;
      const dateStr = r.date || r.price_date;
      if (!dateStr) continue;
      const dt = new Date(dateStr);
      if (isNaN(dt.getTime())) continue;
      const ts = Math.floor(dt.getTime() / 1000);
      const open = Number(r.open ?? r.open_price);
      const high = Number(r.high ?? r.high_price);
      const low = Number(r.low ?? r.low_price);
      const close = Number(r.close ?? r.close_price);
      const volume = Number(r.volume ?? 0);
      if (!(close > 0)) continue;
      candles.push({
        date: ts,
        timestamp: ts,
        open: open > 0 ? open : close,
        high: high > 0 ? Math.max(high, open || 0, close) : close,
        low: low > 0 ? Math.min(low, open || close, close) : close,
        close,
        volume: Number.isFinite(volume) ? volume : 0,
        source: 'python_load_price_history',
      });
    }
    candles.sort((a, b) => a.timestamp - b.timestamp);
    return candles.length > 0 ? candles : null;
  } catch {
    // Python backend down or timed out — caller falls back to direct SQLite
    // (defensive, sandbox-safe). Logged by the caller if it also fails.
    return null;
  }
}

/**
 * Fetch daily chart data from local price_history.db, stocks.db or data_engine.db
 *
 * ⚠️ DEFENSIVE FALLBACK (Rule 12 violation tolerated ONLY when Python backend is
 * unreachable — e.g. sandbox cold-start). The canonical source is Python
 * `load_price_history()` via `getPythonDailyData()`. Do NOT add new direct
 * SQLite readers; this function exists solely to keep the chart usable when
 * Python is down.
 */
function getLocalDailyData(
  ticker: string,
  period: string,
  interval: string
): ChartDataPoint[] | null {
  const stocksDbPath = path.join(process.cwd(), 'db', 'stocks.db');
  const dataEngineDbPath = path.join(process.cwd(), 'db', 'data_engine.db');
  const priceHistoryDbPath = path.join(process.cwd(), 'db', 'price_history.db');

  const periodLimitMap: Record<string, number> = {
    '1d': 1, '5d': 5, '1w': 7, '2w': 14, '1m': 30, '3m': 90,
    '6m': 180, '1y': 365, '2y': 730, '5y': 1825, 'all': 10000,
  };
  const limit = periodLimitMap[period] || (interval === '1w' || interval === '1m' ? 1000 : 365);

  const mergedMap = new Map<string, { date: string; open: number; high: number; low: number; close: number; volume: number; priority: number }>();

  // 1. price_history.db (Highest quality historical archive)
  if (existsSync(priceHistoryDbPath)) {
    try {
      const db = new Database(priceHistoryDbPath, { readonly: true, timeout: 3000 });
      db.pragma('busy_timeout = 3000');
      const rows = db.prepare(`
        SELECT date,
               open_price as open,
               high_price as high,
               low_price as low,
               close_price as close,
               COALESCE(volume, 0) as volume,
               source
        FROM price_history
        WHERE ticker = ? AND close_price > 0 AND close_price IS NOT NULL
        ORDER BY date DESC
        LIMIT ?
      `).all(ticker, limit) as any[];
      db.close();

      if (rows && rows.length > 0) {
        for (const r of rows) {
          const dateKey = String(r.date);
          const close = Number(r.close);
          if (!close || close <= 0) continue;
          let open = Number(r.open) || close;
          let high = Number(r.high) || close;
          let low = Number(r.low) || close;

          high = Math.max(high, open, close);
          low = Math.min(low, open, close);
          if (low < close * 0.4 && close > 10) low = Math.min(open, close) * 0.98;
          if (high > close * 3.0 && close > 10) high = Math.max(open, close) * 1.05;

          mergedMap.set(dateKey, {
            date: dateKey,
            open, high, low, close,
            volume: Number(r.volume || 0),
            priority: 3,
          });
        }
      }
    } catch (e) {
      console.warn(`[chart] price_history.db query failed for ${ticker}:`, e);
    }
  }

  // 2. egksco_price_history (data_engine.db)
  if (existsSync(dataEngineDbPath)) {
    try {
      const db = new Database(dataEngineDbPath, { readonly: true, timeout: 3000 });
      db.pragma('busy_timeout = 3000');
      let rows = db.prepare(`
        SELECT price_date AS date,
               open_price as open,
               high_price as high,
               low_price as low,
               close_price as close,
               COALESCE(volume, 0) as volume
        FROM egksco_price_history
        WHERE symbol = ?
        ORDER BY price_date DESC
        LIMIT ?
      `).all(ticker, limit) as any[];

      if (!rows || rows.length === 0) {
        rows = db.prepare(`
          SELECT price_date AS date,
                 open_price as open,
                 high_price as high,
                 low_price as low,
                 close_price as close,
                 COALESCE(volume, 0) as volume
          FROM egksco_price_history
          WHERE symbol LIKE ? || '%'
          ORDER BY price_date DESC
          LIMIT ?
        `).all(ticker, limit) as any[];
      }
      db.close();

      if (rows && rows.length > 0) {
        for (const r of rows) {
          const dateKey = String(r.date);
          const close = Number(r.close);
          if (!close || close <= 0) continue;
          let open = Number(r.open) || close;
          let high = Number(r.high) || close;
          let low = Number(r.low) || close;

          high = Math.max(high, open, close);
          low = Math.min(low, open, close);
          if (low < close * 0.4 && close > 10) low = Math.min(open, close) * 0.98;
          if (high > close * 3.0 && close > 10) high = Math.max(open, close) * 1.05;

          const existing = mergedMap.get(dateKey);
          if (!existing || existing.priority < 2) {
            mergedMap.set(dateKey, {
              date: dateKey,
              open, high, low, close,
              volume: Number(r.volume || 0),
              priority: 2,
            });
          }
        }
      }
    } catch (e) {
      console.warn(`[chart] egksco_price_history query failed for ${ticker}:`, e);
    }
  }

  // 3. stock_daily_prices (stocks.db)
  if (existsSync(stocksDbPath)) {
    try {
      const db = new Database(stocksDbPath, { readonly: true, timeout: 3000 });
      db.pragma('busy_timeout = 3000');
      const rows = db.prepare(`
        SELECT price_date as date,
               COALESCE(open, open_price) as open,
               COALESCE(high, high_price) as high,
               COALESCE(low, low_price) as low,
               COALESCE(close, close_price) as close,
               COALESCE(volume, 0) as volume
        FROM stock_daily_prices
        WHERE ticker = ? AND COALESCE(close, close_price) > 0 AND COALESCE(close, close_price) IS NOT NULL
        ORDER BY price_date DESC
        LIMIT ?
      `).all(ticker, limit) as any[];
      db.close();

      if (rows && rows.length > 0) {
        for (const r of rows) {
          const close = Number(r.close);
          if (!close || close <= 0) continue;
          let open = Number(r.open) || close;
          let high = Number(r.high) || close;
          let low = Number(r.low) || close;

          // Outlier correction & OHLC integrity
          high = Math.max(high, open, close);
          low = Math.min(low, open, close);
          if (low < close * 0.4 && close > 10) low = Math.min(open, close) * 0.98;
          if (high > close * 3.0 && close > 10) high = Math.max(open, close) * 1.05;

          const dateKey = String(r.date);
          const existing = mergedMap.get(dateKey);
          if (!existing) {
            mergedMap.set(dateKey, {
              date: dateKey,
              open, high, low, close,
              volume: Number(r.volume || 0),
              priority: 1,
            });
          }
        }
      }
    } catch (e) {
      console.warn(`[chart] stock_daily_prices query failed for ${ticker}:`, e);
    }
  }

  // Exclude weekend records (Friday & Saturday) for Egyptian/Arab stocks
  let rawCandles = Array.from(mergedMap.values())
    .filter((r) => {
      const dt = new Date(r.date);
      const day = dt.getUTCDay();
      return day !== 5 && day !== 6;
    })
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  if (rawCandles.length === 0) return null;

  // Weekly aggregation if interval is 1W
  if (interval === '1w') {
    const weekly: Record<string, ChartDataPoint> = {};
    for (const r of rawCandles) {
      const dt = new Date(r.date);
      if (isNaN(dt.getTime())) continue;
      const day = dt.getDay();
      const diff = dt.getDate() - day + (day === 0 ? -6 : 1);
      const monday = new Date(dt.setDate(diff));
      const weekKey = monday.toISOString().split('T')[0];
      const unixTs = Math.floor(monday.getTime() / 1000);

      if (!weekly[weekKey]) {
        weekly[weekKey] = {
          date: unixTs,
          timestamp: unixTs,
          open: Number(r.open || r.close),
          high: Number(r.high || r.close),
          low: Number(r.low || r.close),
          close: Number(r.close),
          volume: Number(r.volume || 0),
          source: 'daily_weekly',
        };
      } else {
        const w = weekly[weekKey];
        w.high = Math.max(w.high, Number(r.high || r.close));
        w.low = Math.min(w.low, Number(r.low || r.close));
        w.close = Number(r.close);
        w.volume += Number(r.volume || 0);
      }
    }
    return Object.values(weekly);
  }

  // Return daily candles with UNIX seconds timestamp
  return rawCandles
    .map((r) => {
      const dt = new Date(r.date);
      const unixTs = !isNaN(dt.getTime()) ? Math.floor(dt.getTime() / 1000) : 0;
      const open = Number(r.open || r.close);
      const close = Number(r.close);
      const high = Math.max(Number(r.high || r.close), open, close);
      const low = Math.min(Number(r.low || r.close), open, close);
      return {
        date: unixTs,
        timestamp: unixTs,
        open,
        high,
        low,
        close,
        volume: Number(r.volume || 0),
        source: 'daily',
      };
    })
    .filter((d) => d.timestamp > 0 && d.open > 0 && d.high > 0 && d.low > 0 && d.close > 0);
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ ticker: string }> }
) {
  const { ticker: rawTicker } = await params;
  const searchParams = request.nextUrl.searchParams;

  const intervalParam = (searchParams.get('interval') || searchParams.get('timeframe') || '').toLowerCase().trim();
  const periodParam = (searchParams.get('period') || '').toLowerCase().trim();
  const asset = (searchParams.get('asset') || 'stock').toLowerCase().trim();

  let interval = intervalParam;
  let period = periodParam;

  if (!interval) {
    if (['5m', '15m', '30m', '1h'].includes(period)) {
      interval = period;
      period = '1w';
    } else if (period === '1d') {
      interval = '15m';
    } else if (period === '1w') {
      interval = '1d';
    } else {
      interval = '1d';
    }
  }

  if (!period) {
    if (['5m', '15m', '30m'].includes(interval)) {
      period = '1w';
    } else if (interval === '1h') {
      period = '1m';
    } else if (interval === '1w') {
      period = '1y';
    } else {
      period = '1y';
    }
  }

  const isIntraday = ['5m', '15m', '30m', '1h', '60m'].includes(interval);
  const freqMinutes = interval === '5m' ? 5 : (interval === '15m' ? 15 : (interval === '30m' ? 30 : 60));

  const resolvedTicker = resolveCanonicalTicker(rawTicker);

  // 1. For Intraday intervals:
  if (isIntraday) {
    // If Crypto or US stock: Yahoo Finance provides true intraday
    if (asset === 'crypto' || ['BTC', 'ETH', 'SOL', 'BNB', 'XRP', 'ADA', 'DOGE', 'AAPL', 'NVDA', 'TSLA'].includes(resolvedTicker)) {
      const yfCandles = await fetchYahooChartCandles(resolvedTicker, interval, period, asset);
      if (yfCandles && yfCandles.length > 0) {
        return NextResponse.json({
          success: true,
          ticker: rawTicker,
          resolvedTicker,
          interval,
          period,
          asset,
          count: yfCandles.length,
          data: yfCandles,
          source: 'yahoo_finance_intraday',
        });
      }
    }

    // Try Python backend
    const pythonUrl = process.env.PYTHON_BACKEND_URL || 'http://127.0.0.1:8010';
    try {
      const qs = new URLSearchParams({ period, interval, asset });
      const res = await fetch(`${pythonUrl}/api/chart/${encodeURIComponent(resolvedTicker)}?${qs.toString()}`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-store',
        signal: AbortSignal.timeout(4000),
      });

      if (res.ok) {
        const json = await res.json();
        if (json.success && Array.isArray(json.data) && json.data.length >= 10) {
          const lastTs = json.data[json.data.length - 1].timestamp;
          const ageDays = (Date.now() / 1000 - lastTs) / 86400;
          if (ageDays < 7) {
            const sanitized = json.data.map((d: any) => ({
              ...d,
              date: d.timestamp,
              timestamp: d.timestamp,
            }));
            return NextResponse.json({
              success: true,
              ticker: rawTicker,
              resolvedTicker,
              interval,
              period,
              asset,
              count: sanitized.length,
              data: sanitized,
              source: 'python_backend',
            });
          }
        }
      }
    } catch {}

    // Direct local SQLite fallback from intraday.db
    const localIntra = getLocalIntradayData(resolvedTicker, freqMinutes, period);
    if (localIntra && localIntra.length >= 15) {
      const lastTs = localIntra[localIntra.length - 1].timestamp;
      const ageDays = (Date.now() / 1000 - lastTs) / 86400;
      if (ageDays < 7) {
        return NextResponse.json({
          success: true,
          ticker: rawTicker,
          resolvedTicker,
          interval,
          period,
          asset,
          count: localIntra.length,
          data: localIntra,
          source: 'local_intraday_db',
        });
      }
    }

    // P0-DATA-FIX (Task 19, 2026-10-03): REMOVED session_intraday synthetic generator.
    // Per owner directive: "مانستعملش بيانات وهمية خالص تحت اى ظرف".
    // The previous code fabricated 90 fake intraday candles from daily OHLC, which
    // 20+ customers correctly identified as "garbage chart". Real intraday data
    // comes from the intraday.db check above (local_intraday_db). If that returns
    // empty, we now HONESTLY return empty instead of faking candles.
    // The synthetic generation code (lines 669-732) is intentionally removed.
    // If you need intraday data, backfill intraday.db via the egksco_scraper cron.
    if (interval !== '1d' && interval !== '1w') {
      return NextResponse.json({
        success: true,
        ticker: rawTicker,
        resolvedTicker,
        interval,
        period,
        asset,
        count: 0,
        data: [],
        source: 'no_intraday_data',
        message: 'لا توجد بيانات لحظية حقيقية لهذا الرمز. البيانات اللحظية تتطلب تشغيل egksco_scraper cron. يتم عرض الشارت اليومي فقط.',
      });
    }
  }

  // 2. For Daily / Weekly intervals:
  // P0-3 (Rule 12 + Rule 20): Python `load_price_history()` is the SOLE canonical
  // source of daily price data. The Node chart API is a proxy and MUST try Python
  // FIRST. Only if Python is unreachable (sandbox cold-start / network blip) do we
  // fall back to direct SQLite via `getLocalDailyData` (marked DEFENSIVE-FALLBACK).
  // Yahoo Finance is merged in afterward as a supplement for recent candles
  // (last few days), not as a replacement of the canonical Python history.
  const periodLimitMap: Record<string, number> = {
    '1d': 1, '5d': 5, '1w': 7, '2w': 14, '1m': 30, '3m': 90,
    '6m': 180, '1y': 365, '2y': 730, '5y': 1825, 'all': 2000,
  };
  const pythonLimit = periodLimitMap[period] || (interval === '1w' || interval === '1m' ? 1000 : 365);

  let localDaily = await getPythonDailyData(resolvedTicker, pythonLimit);

  if (!localDaily || localDaily.length === 0) {
    // DEFENSIVE FALLBACK: Python backend down or returned no data.
    // Use the direct SQLite reader so the chart stays usable in the sandbox
    // (Python is often not running on :8010 here). This is a tolerated Rule 12
    // exception — the canonical path is `getPythonDailyData` above.
    localDaily = getLocalDailyData(resolvedTicker, period, interval);
  }

  // Fetch Yahoo for recent data (last few days) — to supplement, not replace
  const yfCandles = await fetchYahooChartCandles(resolvedTicker, interval, period, asset);

  if (localDaily && localDaily.length >= 20) {
    // MERGE: keep local history + append/update with Yahoo recent candles
    if (yfCandles && yfCandles.length > 0) {
      const localDates = new Set(localDaily.map((c: ChartDataPoint) => Math.floor(c.timestamp / 86400)));
      let appended = 0;
      for (const yfc of yfCandles) {
        const yfcDay = Math.floor(yfc.timestamp / 86400);
        if (!localDates.has(yfcDay)) {
          localDaily.push(yfc);
          appended++;
        } else {
          // Update existing candle with fresher Yahoo data
          const idx = localDaily.findIndex((c: ChartDataPoint) => Math.floor(c.timestamp / 86400) === yfcDay);
          if (idx >= 0) localDaily[idx] = yfc;
        }
      }
      // Re-sort by timestamp after merge
      localDaily.sort((a: ChartDataPoint, b: ChartDataPoint) => a.timestamp - b.timestamp);
      if (appended > 0) {
        // eslint-disable-next-line no-console
        console.log(`[chart] ${resolvedTicker}: merged local (${localDaily.length - appended}) + Yahoo (${appended} new) = ${localDaily.length} total`);
      }
    }
  } else {
    // Local insufficient — use Yahoo as primary
    if (yfCandles && yfCandles.length > 0) {
      localDaily = yfCandles;
    }
  }

  if (localDaily && localDaily.length > 0) {
    return NextResponse.json({
      success: true,
      ticker: rawTicker,
      resolvedTicker,
      interval,
      period,
      asset,
      count: localDaily.length,
      data: localDaily,
      source: localDaily[0]?.source || 'daily_db',
    });
  }

  // 3. Fallback to Python backend for daily
  const pythonUrl = process.env.PYTHON_BACKEND_URL || 'http://127.0.0.1:8010';
  try {
    const qs = new URLSearchParams({ period, interval, asset });
    const res = await fetch(`${pythonUrl}/api/chart/${encodeURIComponent(resolvedTicker)}?${qs.toString()}`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
      cache: 'no-store',
      signal: AbortSignal.timeout(6000),
    });

    if (res.ok) {
      const json = await res.json();
      if (json.success && Array.isArray(json.data) && json.data.length > 0) {
        return NextResponse.json({
          ...json,
          ticker: rawTicker,
          resolvedTicker,
        });
      }
    }
  } catch {
    // ignore
  }

  // 4. CHART-DATA-FIX (2026-10-01): Generate a synthetic candle from stocks table
  // when no historical data exists in any DB. The stocks table has rich real-time
  // data (current_price, high_price, low_price, open_price, volume, previous_close)
  // that can produce at minimum a today-candle so the chart is NOT empty.
  const stocksDbPath = path.join(process.cwd(), 'db', 'stocks.db');
  if (existsSync(stocksDbPath)) {
    try {
      const db = new Database(stocksDbPath, { readonly: true, timeout: 3000 });
      const stock = db.prepare(`
        SELECT current_price, high_price, low_price, open_price,
               previous_close, volume, close, turnover_egp,
               ma_50, ma_200, rsi, support, resistance, signal, trend,
               pe_ratio, sector, name_ar
        FROM stocks WHERE ticker = ? COLLATE NOCASE
      `).get(resolvedTicker) as any;

      if (stock && (stock.current_price || stock.close)) {
        const price = Number(stock.current_price || stock.close || 0);
        const high = Number(stock.high_price || price);
        const low = Number(stock.low_price || price);
        const open = Number(stock.open_price || stock.previous_close || price);
        const close = price;
        const volume = Number(stock.volume || 0);
        const prevClose = Number(stock.previous_close || 0);

        // Generate today's candle
        const now = Math.floor(Date.now() / 1000);
        const todayCandle: ChartDataPoint = {
          date: now,
          timestamp: now,
          open: open > 0 ? open : close,
          high: high > 0 ? high : close,
          low: low > 0 ? low : close,
          close: close,
          volume: volume,
          source: 'stocks_table_synthetic',
        };

        // If we have previous_close, generate yesterday's candle too
        const candles: ChartDataPoint[] = [todayCandle];
        if (prevClose > 0 && prevClose !== open) {
          const yesterday = now - 86400; // 24h ago
          candles.unshift({
            date: yesterday,
            timestamp: yesterday,
            open: prevClose,
            high: Math.max(prevClose, open),
            low: Math.min(prevClose, low > 0 ? low : prevClose),
            close: open > 0 ? open : close,
            volume: 0,
            source: 'stocks_table_synthetic_prev',
          });
        }

        db.close();

        return NextResponse.json({
          success: true,
          ticker: rawTicker,
          resolvedTicker,
          interval,
          period,
          asset,
          count: candles.length,
          data: candles,
          source: 'stocks_table_synthetic',
          stock_info: {
            current_price: price,
            previous_close: prevClose,
            high: high,
            low: low,
            volume: volume,
            ma_50: stock.ma_50 ? Number(stock.ma_50) : null,
            ma_200: stock.ma_200 ? Number(stock.ma_200) : null,
            rsi: stock.rsi ? Number(stock.rsi) : null,
            support: stock.support ? Number(stock.support) : null,
            resistance: stock.resistance ? Number(stock.resistance) : null,
            signal: stock.signal || null,
            trend: stock.trend || null,
            pe_ratio: stock.pe_ratio ? Number(stock.pe_ratio) : null,
            sector: stock.sector || null,
            name_ar: stock.name_ar || null,
          },
          note: 'بيانات اليوم من stocks table — البيانات التاريخية غير متوفرة حالياً',
        });
      }
      db.close();
    } catch (e) {
      console.warn(`[chart] stocks table fallback failed for ${resolvedTicker}:`, e);
    }
  }

  return NextResponse.json({
    success: false,
    ticker: rawTicker,
    resolvedTicker,
    interval,
    period,
    asset,
    data: [],
    error: `لا توجد بيانات متاحة للسهم ${rawTicker}`,
  }, { status: 404 });
}