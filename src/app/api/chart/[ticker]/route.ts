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

/**
 * Fetch daily chart data from local stocks.db or data_engine.db
 */
function getLocalDailyData(
  ticker: string,
  period: string,
  interval: string
): ChartDataPoint[] | null {
  const stocksDbPath = path.join(process.cwd(), 'db', 'stocks.db');
  const dataEngineDbPath = path.join(process.cwd(), 'db', 'data_engine.db');

  const periodLimitMap: Record<string, number> = {
    '1d': 1, '5d': 5, '1w': 7, '2w': 14, '1m': 30, '3m': 90,
    '6m': 180, '1y': 365, '2y': 730, '5y': 1825, 'all': 10000,
  };
  const limit = periodLimitMap[period] || (interval === '1w' || interval === '1m' ? 1000 : 365);

  let rawCandles: { date: string; open: number; high: number; low: number; close: number; volume: number }[] = [];

  // 1. Try stocks.db stock_daily_prices (coalescing open/open_price, etc.)
  if (existsSync(stocksDbPath)) {
    try {
      const db = new Database(stocksDbPath, { readonly: true, timeout: 5000 });
      db.pragma('busy_timeout = 5000');

      const rows = db.prepare(`
        SELECT price_date as date,
               COALESCE(open, open_price) as open,
               COALESCE(high, high_price) as high,
               COALESCE(low, low_price) as low,
               COALESCE(close, close_price) as close,
               COALESCE(volume, 0) as volume
        FROM stock_daily_prices
        WHERE ticker = ?
        ORDER BY price_date DESC
        LIMIT ?
      `).all(ticker, limit) as any[];

      db.close();

      if (rows && rows.length > 0) {
        rawCandles = rows.reverse();
      }
    } catch (e) {
      console.warn(`[chart] stock_daily_prices query failed for ${ticker}:`, e);
    }
  }

  // 2. Fallback to data_engine.db.egksco_price_history
  if (rawCandles.length === 0 && existsSync(dataEngineDbPath)) {
    try {
      const db = new Database(dataEngineDbPath, { readonly: true, timeout: 5000 });
      db.pragma('busy_timeout = 5000');

      const rows = db.prepare(`
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

      db.close();

      if (rows && rows.length > 0) {
        rawCandles = rows.reverse();
      }
    } catch (e) {
      console.warn(`[chart] data_engine.db.egksco_price_history query failed for ${ticker}:`, e);
    }
  }

  if (rawCandles.length === 0) return null;

  // 3. Weekly aggregation if interval is 1W
  if (interval === '1w') {
    const weekly: Record<string, ChartDataPoint> = {};
    for (const r of rawCandles) {
      const dt = new Date(r.date);
      if (isNaN(dt.getTime())) continue;
      // Get Monday of the week
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

  // 4. Return daily candles with UNIX seconds timestamp
  return rawCandles
    .map((r) => {
      const dt = new Date(r.date);
      const unixTs = !isNaN(dt.getTime()) ? Math.floor(dt.getTime() / 1000) : 0;
      return {
        date: unixTs,
        timestamp: unixTs,
        open: Number(r.open || r.close),
        high: Number(r.high || r.close),
        low: Number(r.low || r.close),
        close: Number(r.close),
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

  // Normalize interval & period
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
    // Try Python backend first
    const pythonUrl = process.env.PYTHON_BACKEND_URL || 'http://127.0.0.1:8010';
    try {
      const qs = new URLSearchParams({
        period,
        interval,
        asset,
      });
      const res = await fetch(`${pythonUrl}/api/chart/${encodeURIComponent(resolvedTicker)}?${qs.toString()}`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-store',
        signal: AbortSignal.timeout(6000),
      });

      if (res.ok) {
        const json = await res.json();
        if (json.success && Array.isArray(json.data) && json.data.length > 0) {
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
    } catch {
      // fallback to local SQLite below
    }

    // Direct local SQLite fallback from intraday.db
    const localIntra = getLocalIntradayData(resolvedTicker, freqMinutes, period);
    if (localIntra && localIntra.length > 0) {
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

  // 2. For Daily / Weekly intervals or fallback:
  const localDaily = getLocalDailyData(resolvedTicker, period, interval);
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
      source: 'local_daily_db',
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