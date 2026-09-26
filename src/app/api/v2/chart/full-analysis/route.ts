/**
 * GET /api/v2/chart/full-analysis?ticker=X&timeframe=DAY&limit=120
 *
 * Primary: Python /api/chart/full-analysis (OHLC + indicators + markers).
 * Fallback (FLUTTER-FULL-AUDIT): stocks.db stock_daily_prices — return
 *   OHLC candles with empty indicators/markers arrays. Flutter's chart
 *   component handles empty indicator arrays cleanly — but if the whole
 *   endpoint 503s, the chart shows "loading error" which is worse.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getPaywallUser, applyPaywallToChartAnalysis } from '@/lib/paywall';
import Database from 'better-sqlite3';
import { join } from 'path';
import { existsSync } from 'fs';

const PYTHON_PORT = process.env.PYTHON_PORT || '8010';
export const dynamic = 'force-dynamic';

function _toUnix(raw: unknown): number {
  if (typeof raw === 'number') {
    return raw > 1e12 ? Math.floor(raw / 1000) : Math.floor(raw);
  }
  if (typeof raw === 'string') {
    const s = raw.trim();
    const asNum = Number(s);
    if (!isNaN(asNum) && /^\d+(\.\d+)?$/.test(s)) {
      return asNum > 1e12 ? Math.floor(asNum / 1000) : Math.floor(asNum);
    }
    const parsed = Date.parse(s.replace(' ', 'T'));
    return isNaN(parsed) ? 0 : Math.floor(parsed / 1000);
  }
  return 0;
}

function readStockOHLC(ticker: string, limit: number): Record<string, unknown>[] {
  const stocksDbPath = join(process.cwd(), 'db', 'stocks.db');
  if (!existsSync(stocksDbPath)) return [];
  try {
    const db = new Database(stocksDbPath, { readonly: true, timeout: 3000 });
    const rows = db
      .prepare(
        `SELECT price_date as date,
                COALESCE(open, open_price) as open,
                COALESCE(high, high_price) as high,
                COALESCE(low, low_price) as low,
                COALESCE(close, close_price) as close,
                COALESCE(volume, 0) as volume
         FROM stock_daily_prices
         WHERE ticker = ? COLLATE NOCASE
         ORDER BY price_date DESC
         LIMIT ?`
      )
      .all(ticker.toUpperCase(), limit) as Record<string, unknown>[];
    db.close();
    return rows.reverse();
  } catch {
    return [];
  }
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const ticker = (searchParams.get('ticker') || 'PHDC').toUpperCase();
  const timeframe = searchParams.get('timeframe') || '1D';
  const limit = parseInt(searchParams.get('limit') || '120', 10);
  const userId = searchParams.get('user_id') || '';
  const userState = searchParams.get('state') || 'buyer';

  let pythonUrl = `http://127.0.0.1:${PYTHON_PORT}/api/chart/full-analysis?ticker=${encodeURIComponent(ticker)}&timeframe=${encodeURIComponent(timeframe)}&limit=${encodeURIComponent(limit)}&state=${encodeURIComponent(userState)}`;
  if (userId) pythonUrl += `&user_id=${encodeURIComponent(userId)}`;

  // 1. Try Python
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    let res = await fetch(pythonUrl, {
      signal: controller.signal,
      cache: 'no-store',
      headers: { Accept: 'application/json' },
    });

    // FALLBACK-FIX: if 15M/5M unavailable, try DAY
    if (!res.ok && timeframe !== 'DAY') {
      const fallbackUrl = `http://127.0.0.1:${PYTHON_PORT}/api/chart/full-analysis?ticker=${encodeURIComponent(ticker)}&timeframe=DAY&limit=365&state=${encodeURIComponent(userState)}${userId ? `&user_id=${encodeURIComponent(userId)}` : ''}`;
      res = await fetch(fallbackUrl, {
        signal: controller.signal,
        cache: 'no-store',
        headers: { Accept: 'application/json' },
      });
    }
    clearTimeout(timeout);

    if (res.ok) {
      const data = await res.json();
      // Normalize chart times to UNIX int + drop null candles
      if (data && data.ohlcv && Array.isArray(data.ohlcv)) {
        const validTimes = new Set<number>();
        data.ohlcv = data.ohlcv
          .map((c: Record<string, unknown>) => {
            const t = _toUnix(c?.time ?? c?.timestamp ?? c?.date);
            return { ...c, time: t, timestamp: t, date: t };
          })
          .filter((c: Record<string, unknown>) => {
            if (
              c.time <= 0 ||
              c.open == null || c.high == null || c.low == null || c.close == null
            ) {
              return false;
            }
            validTimes.add(c.time);
            return true;
          });
        if (data.indicators && typeof data.indicators === 'object') {
          for (const key of Object.keys(data.indicators)) {
            const arr = data.indicators[key];
            if (Array.isArray(arr)) {
              data.indicators[key] = arr
                .map((p: Record<string, unknown>) => ({ ...p, time: _toUnix(p?.time) }))
                .filter((p: Record<string, unknown>) => validTimes.has(p.time));
            }
          }
        }
        for (const k of ['cmf_data', 'vol_z_score_arr', 'macd_projection']) {
          if (Array.isArray(data[k])) {
            data[k] = data[k]
              .map((p: Record<string, unknown>) => ({ ...p, time: _toUnix(p?.time) }))
              .filter((p: Record<string, unknown>) => validTimes.has(p.time));
          }
        }
        if (Array.isArray(data.smart_markers)) {
          data.smart_markers = data.smart_markers
            .map((m: Record<string, unknown>) => ({ ...m, time: _toUnix(m?.time) }))
            .filter((m: Record<string, unknown>) => validTimes.has(m.time));
        }
        if (Array.isArray(data.bos_events)) {
          data.bos_events = data.bos_events.map((e: Record<string, unknown>) =>
            e?.time != null ? { ...e, time: _toUnix(e.time) } : e
          );
        }
      }
      const user = await getPaywallUser(request);
      const paywalledData = applyPaywallToChartAnalysis(data, user.is_premium);
      paywalledData._paywall = { is_premium: user.is_premium };
      return NextResponse.json(paywalledData);
    }
  } catch {
    // fall through to SQLite
  }

  // 2. SQLite fallback — stocks.db stock_daily_prices
  const ohlcvRaw = readStockOHLC(ticker, limit);
  const ohlcv = ohlcvRaw.map((c) => {
    const t = _toUnix(c.date);
    return {
      time: t,
      timestamp: t,
      date: t,
      open: Number(c.open) || 0,
      high: Number(c.high) || 0,
      low: Number(c.low) || 0,
      close: Number(c.close) || 0,
      volume: Number(c.volume) || 0,
    };
  });

  const data: Record<string, unknown> = {
    success: true,
    source: 'sqlite_fallback',
    ticker,
    timeframe: timeframe === '1D' ? 'DAY' : timeframe,
    ohlcv,
    indicators: {},
    smart_markers: [],
    bos_events: [],
    sweeps: [],
    cmf_data: [],
    vol_z_score_arr: [],
    macd_projection: [],
    count: ohlcv.length,
    warning: 'Python backend unreachable — OHLC candles from stocks.db (no indicators)',
  };

  try {
    const user = await getPaywallUser(request);
    const paywalledData = applyPaywallToChartAnalysis(data, user.is_premium);
    paywalledData._paywall = { is_premium: user.is_premium };
    return NextResponse.json(paywalledData);
  } catch {
    return NextResponse.json(data);
  }
}
