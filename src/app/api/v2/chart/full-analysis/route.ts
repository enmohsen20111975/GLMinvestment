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
  const priceHistoryDbPath = join(process.cwd(), 'db', 'price_history.db');

  // 1. Try stocks.db stock_daily_prices
  if (existsSync(stocksDbPath)) {
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
      if (rows && rows.length > 0) return rows.reverse();
    } catch { // silent fallback (safe-by-design)
    }
  }

  // P0-ISOLATION: price_history.db is isolated. stocks.db is the sole canonical source.
  return [];
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
            const t = c.time as number;
            if (
              !t || t <= 0 ||
              c.open == null || c.high == null || c.low == null || c.close == null
            ) {
              return false;
            }
            validTimes.add(t);
            return true;
          });
        if (data.indicators && typeof data.indicators === 'object') {
          for (const key of Object.keys(data.indicators)) {
            const arr = data.indicators[key];
            if (Array.isArray(arr)) {
              data.indicators[key] = arr
                .map((p: Record<string, unknown>) => ({ ...p, time: _toUnix(p?.time) }))
                .filter((p: Record<string, unknown>) => validTimes.has(p.time as number));
            }
          }
        }
        for (const k of ['cmf_data', 'vol_z_score_arr', 'macd_projection']) {
          if (Array.isArray(data[k])) {
            data[k] = data[k]
              .map((p: Record<string, unknown>) => ({ ...p, time: _toUnix(p?.time) }))
              .filter((p: Record<string, unknown>) => validTimes.has(p.time as number));
          }
        }
        if (Array.isArray(data.smart_markers)) {
          data.smart_markers = data.smart_markers
            .map((m: Record<string, unknown>) => ({ ...m, time: _toUnix(m?.time) }))
            .filter((m: Record<string, unknown>) => validTimes.has(m.time as number));
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
  } catch { // silent fallback (safe-by-design)
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

  // ── Task CHART-MARKERS: markers + zones + prediction_ray من Python canonical ──
  // Rule 20 (PYTHON = BRAIN): نستدعي Python module عبر subprocess لاستخراج
  // markers (radar signals) + zones (order blocks + fibonacci) + prediction_ray.
  // Rule 27 (NO-FAKE-DATA): كل البيانات من radar_signal_tracking + predictions.db.
  let markers: Record<string, unknown>[] = [];
  let zones: Record<string, unknown>[] = [];
  let prediction_ray: Record<string, unknown> | null = null;
  let institutional_levels: Record<string, unknown> | null = null;

  if (ohlcv.length >= 10) {
    try {
      const { execFile } = await import('child_process');
      const { promisify } = await import('util');
      const execFileAsync = promisify(execFile);
      const projectRoot = process.cwd();

      // مرر candles عبر stdin (آمن من shell escaping issues)
      // تحويل unix timestamp → 'YYYY-MM-DD' string لأن Python يتوقع date string
      const candlesJson = JSON.stringify(ohlcvRaw.map((c) => {
        const rawDate = c.date;
        let dateStr = '';
        if (typeof rawDate === 'string' && /^\d{4}-\d{2}-\d{2}/.test(rawDate)) {
          dateStr = rawDate.substring(0, 10);
        } else if (typeof rawDate === 'number' && rawDate > 0) {
          // unix timestamp → YYYY-MM-DD (UTC)
          dateStr = new Date(rawDate * 1000).toISOString().substring(0, 10);
        }
        return {
          date: dateStr,
          open: Number(c.open) || 0,
          high: Number(c.high) || 0,
          low: Number(c.low) || 0,
          close: Number(c.close) || 0,
          volume: Number(c.volume) || 0,
        };
      }));

      const script = `
import sys, json, os
sys.path.insert(0, os.path.join(${JSON.stringify(projectRoot)}, 'vps-service'))
from analyzers.institutional_levels import (
    compute_institutional_levels,
    compute_radar_markers,
    compute_chart_zones,
    compute_prediction_ray,
)
stocks_db = os.path.join(${JSON.stringify(projectRoot)}, 'db', 'stocks.db')
predictions_db = os.path.join(${JSON.stringify(projectRoot)}, 'db', 'predictions.db')
candles = json.loads(sys.stdin.read())
inst = compute_institutional_levels(candles)
m = compute_radar_markers(${JSON.stringify(ticker)}, candles, stocks_db)
z = compute_chart_zones(candles, inst)
pr = compute_prediction_ray(${JSON.stringify(ticker)}, stocks_db, predictions_db)
print(json.dumps({
  'institutional_levels': inst,
  'markers': m,
  'zones': z,
  'prediction_ray': pr,
}, ensure_ascii=False, default=str))
`;
      // استخدم spawn مع stdin pipe (execFile لا يدعم input بشكل موثوق)
      const { spawn } = await import('child_process');
      const child = spawn('python3', ['-c', script], {
        cwd: projectRoot,
        env: { ...process.env, PROJECT_ROOT: projectRoot },
      });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
      child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
      child.stdin.write(candlesJson);
      child.stdin.end();
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          child.kill();
          reject(new Error('Python subprocess timeout'));
        }, 8000);
        child.on('close', (code) => {
          clearTimeout(timer);
          if (code === 0) resolve();
          else reject(new Error(`Python exit ${code}: ${stderr}`));
        });
        child.on('error', (err) => {
          clearTimeout(timer);
          reject(err);
        });
      });
      const parsed = JSON.parse(stdout.trim().split('\n').filter((l: string) => l.trim().startsWith('{')).pop() || '{}');
      markers = (parsed.markers || []).map((m: Record<string, unknown>) => ({
        ...m,
        time: _toUnix(m.time),
      })).filter((m: Record<string, unknown>) => {
        const t = m.time as number;
        return t > 0 && ohlcv.some((c) => c.time === t);
      });
      zones = parsed.zones || [];
      prediction_ray = parsed.prediction_ray || null;
      institutional_levels = parsed.institutional_levels || null;
    } catch (e) { // silent fallback (safe-by-design — Rule 27)
      // لو فشل Python، نُرجع arrays فارغة (لا اختلاع)
      console.error('[chart/full-analysis] Python markers subprocess failed:', e);
    }
  }

  const data: Record<string, unknown> = {
    success: true,
    source: 'sqlite_fallback',
    ticker,
    timeframe: timeframe === '1D' ? 'DAY' : timeframe,
    ohlcv,
    indicators: {},
    smart_markers: markers,
    markers, // Task CHART-MARKERS: قائمة إشارات صانع السوق
    zones, // Task CHART-MARKERS: مناطق الطلب والعرض (Order Blocks + Fibonacci)
    prediction_ray, // Task CHART-MARKERS: خط الهدف ووقف الخسارة
    institutional_levels, // Task CHART-MARKERS: المستويات المؤسسية الكاملة
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
  } catch { // silent fallback (safe-by-design)
    return NextResponse.json(data);
  }
}
