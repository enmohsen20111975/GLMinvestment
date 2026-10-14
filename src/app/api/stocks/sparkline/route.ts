/**
 * GET /api/stocks/sparkline?ticker=COMI&days=30
 * GET /api/stocks/sparkline?tickers=COMI,ETEL&days=30
 * ====================================================
 * CANONICAL sparkline route — derives close-price array from the Python
 * history endpoint (no direct SQLite access).
 *
 * Directive P1 (API Routes Decoupling): this route previously opened
 * `stocks.db` directly (`new Database(...)`) and read `stock_daily_prices` +
 * `market_indices`. That bypassed the canonical Python engine. Now it calls
 * the Python history endpoint (same source as /api/stocks/[ticker]/history)
 * and derives the sparkline from the OHLCV closes. Cache stays (TTL 60s).
 *
 * Rule 4 (Python = brain, Frontend = mirror only).
 * Rule 27 (NO-FAKE-DATA): empty array when Python is unreachable.
 */
import { NextRequest, NextResponse } from 'next/server';
import { PYTHON_BACKEND_URL } from '@/lib/python-backend';

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

interface HistoryBar {
  date?: string;
  close?: number;
  close_price?: number;
}

async function fetchClosesFromPython(t: string, days: number): Promise<number[]> {
  const candidates = getCandidateTickers(t);
  for (const cand of candidates) {
    const targetUrls = [
      `${PYTHON_BACKEND_URL}/api/history/${cand}?days=${days}`,
      `http://127.0.0.1:8010/api/history/${cand}?days=${days}`,
    ];
    for (const targetUrl of targetUrls) {
      try {
        const res = await fetch(targetUrl, {
          signal: AbortSignal.timeout(6000),
          cache: 'no-store',
        });
        if (!res.ok) continue;
        const json = await res.json();
        const history: HistoryBar[] | undefined =
          json?.data?.history || json?.data || (Array.isArray(json?.data) ? json.data : undefined);
        if (Array.isArray(history) && history.length > 0) {
          const closes = history
            .map((b) => Number(b?.close ?? b?.close_price ?? 0))
            .filter((n) => Number.isFinite(n) && n > 0);
          if (closes.length > 0) return closes.slice(-days);
        }
      } catch {
        // try next candidate / URL (safe-by-design)
      }
    }
  }
  return [];
}

async function fetchSingleSparkline(t: string, days: number) {
  const key = cacheKey(t, days);
  const cached = getCached(key);
  if (cached) return cached;

  const prices = await fetchClosesFromPython(t, days);

  if (prices.length === 0) {
    const empty = {
      ticker: t,
      prices: [],
      min: 0,
      max: 0,
      first: 0,
      last: 0,
      change_pct: 0,
      days: 0,
      source: 'python_history_empty',
    };
    setCache(key, empty);
    return empty;
  }

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
    source: 'python_history',
  };
  setCache(key, result);
  return result;
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
      const list = tickersParam.split(',').map((s) => s.trim()).filter(Boolean).slice(0, 50);
      const results: Record<string, any> = {};
      await Promise.all(
        list.map(async (t) => {
          results[t] = await fetchSingleSparkline(t, days);
        }),
      );
      return NextResponse.json({ success: true, data: results });
    }

    const singleResult = await fetchSingleSparkline(rawTicker, days);
    return NextResponse.json({ success: true, ...singleResult });
  } catch (e) {
    console.error('[stocks:sparkline]', e);
    return NextResponse.json(
      { success: false, error: 'internal_error' },
      { status: 500 },
    );
  }
}
