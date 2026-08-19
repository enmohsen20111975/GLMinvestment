/**
 * Market Pulse API - Proxy to Python Backend
 * نبض السوق اللحظي
 *
 * P19-HOTFIX: لو الـ Python backend مش متاح → نرجّع آخر cache طازجة (حتى لو
 * منتهية) بدل ما نرجع 503. ده بيخلي الـ frontend يفضل شغال بدل ما يقع خالص.
 */

import { NextResponse } from 'next/server';

const PYTHON_BACKEND = process.env.EGX_VPS_API_URL || process.env.EGXPY_SERVICE_URL || 'http://127.0.0.1:8010';

let cache: { timestamp: number; data: unknown } | null = null;
const CACHE_TTL = 10_000;
const STALE_CACHE_TTL = 5 * 60_000; // P19-HOTFIX: نقبل cache قديم لحد 5 دقايق

// P19-HOTFIX: fallback response لو الـ Python backend مش متاح ومفيش cache خالص
const FALLBACK_RESPONSE = {
  success: false,
  error: 'market_pulse_unavailable',
  data: {
    cairo_time: new Date().toISOString(),
    is_trading_hours: false,
    market_status: 'UNKNOWN',
    sectors: [],
    gainers: [],
    losers: [],
    most_active: [],
    signals: [],
    breadth: { gainers: 0, losers: 0, unchanged: 0, adv_dec_ratio: 0, total_turnover: 0, total_turnover_bn: 0 },
    pulse: { score: 0, label: 'محايد', label_en: 'NEUTRAL', color: 'amber' },
    divergence: { value: 0, regime: 'UNKNOWN', regime_ar: 'غير معروف', action: 'HOLD', action_ar: 'انتظر' },
  },
};

export async function GET() {
  if (cache && Date.now() - cache.timestamp < CACHE_TTL) {
    return NextResponse.json(cache.data);
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);

    const response = await fetch(`${PYTHON_BACKEND}/api/market-pulse`, {
      signal: controller.signal,
      headers: { 'Accept': 'application/json' },
    });
    clearTimeout(timeout);

    if (!response.ok) {
      // P19-HOTFIX: لو الـ Python رجع error → نرجّع stale cache لو موجود،
      // بدل ما نرجع 502 للـ frontend.
      if (cache && Date.now() - cache.timestamp < STALE_CACHE_TTL) {
        return NextResponse.json(cache.data);
      }
      return NextResponse.json(FALLBACK_RESPONSE);
    }

    const data = await response.json();
    cache = { timestamp: Date.now(), data };
    return NextResponse.json(data);
  } catch (error) {
    console.error('[market-pulse] Error:', error);
    // P19-HOTFIX: لو الـ Python مش متاح خالص → نرجّع stale cache لو موجود
    // (حتى لو منتهية) بدل ما نرجع 503. لو مفيش cache → نرجّع fallback آمن.
    if (cache) {
      return NextResponse.json(cache.data);
    }
    return NextResponse.json(FALLBACK_RESPONSE);
  }
}
