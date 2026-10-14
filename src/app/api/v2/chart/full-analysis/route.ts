/**
 * GET /api/v2/chart/full-analysis?ticker=X&timeframe=DAY&limit=120
 *
 * CANONICAL chart route — pure proxy to Python /api/chart/full-analysis.
 *
 *Directive P1 (API Routes Decoupling): NO direct SQLite access in Next.js
 * routes. This route proxies to Python ONLY. If Python is unreachable →
 * honest empty `{ success: false, error: 'chart_data_unavailable', ohlcv: [] }`
 * (Rule 27 NO-FAKE-DATA).
 *
 * Rule 4 (Python = brain, Frontend = mirror only).
 * Rule 27 (NO-FAKE-DATA): never fabricate OHLCV candles.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getPaywallUser, applyPaywallToChartAnalysis } from '@/lib/paywall';
import { PYTHON_BACKEND_URL } from '@/lib/python-backend';

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

// Normalize chart times to UNIX int + drop null candles (kept from original
// route — pure TS transformation on Python's response, NOT a DB read).
function normalizeChartTimes(data: Record<string, unknown>): Record<string, unknown> {
  if (!data || !Array.isArray(data.ohlcv)) return data;
  const validTimes = new Set<number>();
  const ohlcvIn = data.ohlcv as Record<string, unknown>[];
  const ohlcvOut: Record<string, unknown>[] = [];
  for (const c of ohlcvIn) {
    const t = _toUnix(c?.time ?? c?.timestamp ?? c?.date);
    const out: Record<string, unknown> = { ...c, time: t, timestamp: t, date: t };
    if (
      !t || t <= 0 ||
      out.open == null || out.high == null || out.low == null || out.close == null
    ) {
      continue;
    }
    validTimes.add(t as number);
    ohlcvOut.push(out);
  }
  data.ohlcv = ohlcvOut;
  if (data.indicators && typeof data.indicators === 'object') {
    const indicators = data.indicators as Record<string, unknown>;
    for (const key of Object.keys(indicators)) {
      const arr = indicators[key];
      if (Array.isArray(arr)) {
        indicators[key] = (arr as Record<string, unknown>[])
          .map((p) => ({ ...p, time: _toUnix(p?.time) }))
          .filter((p) => validTimes.has(p.time as number));
      }
    }
  }
  for (const k of ['cmf_data', 'vol_z_score_arr', 'macd_projection']) {
    if (Array.isArray(data[k])) {
      data[k] = (data[k] as Record<string, unknown>[])
        .map((p) => ({ ...p, time: _toUnix(p?.time) }))
        .filter((p) => validTimes.has(p.time as number));
    }
  }
  if (Array.isArray(data.smart_markers)) {
    data.smart_markers = (data.smart_markers as Record<string, unknown>[])
      .map((m) => ({ ...m, time: _toUnix(m?.time) }))
      .filter((m) => validTimes.has(m.time as number));
  }
  if (Array.isArray(data.bos_events)) {
    data.bos_events = (data.bos_events as Record<string, unknown>[]).map((e) =>
      e?.time != null ? { ...e, time: _toUnix(e.time) } : e
    );
  }
  return data;
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const ticker = (searchParams.get('ticker') || 'PHDC').toUpperCase();
  const timeframe = searchParams.get('timeframe') || '1D';
  const limit = parseInt(searchParams.get('limit') || '120', 10);
  const userId = searchParams.get('user_id') || '';
  const userState = searchParams.get('state') || 'buyer';

  // Build Python canonical endpoint URLs (primary + DAY fallback).
  const buildUrl = (tf: string, lim: number): string => {
    const u = new URL(`${PYTHON_BACKEND_URL}/api/chart/full-analysis`);
    u.searchParams.set('ticker', ticker);
    u.searchParams.set('timeframe', tf);
    u.searchParams.set('limit', String(lim));
    u.searchParams.set('state', userState);
    if (userId) u.searchParams.set('user_id', userId);
    return u.toString();
  };

  const targetUrls: string[] = [
    buildUrl(timeframe, limit),
    // FALLBACK-FIX: if 15M/5M unavailable, try DAY @ 365 candles.
    timeframe !== 'DAY' ? buildUrl('DAY', 365) : '',
  ].filter(Boolean);

  for (const targetUrl of targetUrls) {
    try {
      const res = await fetch(targetUrl, {
        signal: AbortSignal.timeout(8000),
        cache: 'no-store',
        headers: { Accept: 'application/json' },
      });
      if (!res.ok) continue;
      const data = (await res.json()) as Record<string, unknown>;
      if (!data || !Array.isArray(data.ohlcv) || data.ohlcv.length === 0) continue;
      const normalized = normalizeChartTimes(data);
      const user = await getPaywallUser(request);
      const paywalledData = applyPaywallToChartAnalysis(normalized, user.is_premium);
      (paywalledData as Record<string, unknown>)._paywall = { is_premium: user.is_premium };
      return NextResponse.json(paywalledData);
    } catch {
      // Try next fallback URL (safe-by-design).
    }
  }

  // Rule 27: honest empty — no fabricated OHLCV candles.
  const emptyData: Record<string, unknown> = {
    success: false,
    error: 'chart_data_unavailable',
    ohlcv: [],
    ticker,
    timeframe: timeframe === '1D' ? 'DAY' : timeframe,
    indicators: {},
    smart_markers: [],
    markers: [],
    zones: [],
    prediction_ray: null,
    institutional_levels: null,
    bos_events: [],
    sweeps: [],
    cmf_data: [],
    vol_z_score_arr: [],
    macd_projection: [],
    count: 0,
  };

  try {
    const user = await getPaywallUser(request);
    const paywalledData = applyPaywallToChartAnalysis(emptyData, user.is_premium);
    (paywalledData as Record<string, unknown>)._paywall = { is_premium: user.is_premium };
    return NextResponse.json(paywalledData);
  } catch { // silent fallback (safe-by-design)
    return NextResponse.json(emptyData);
  }
}
