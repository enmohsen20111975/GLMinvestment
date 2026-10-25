/**
 * GET /api/stored-analysis/live-tracking
 *
 * Pure proxy route → Python backend `/api/stored-analysis/live-tracking`
 *
 * المعمارية (v3.66.10): Python = الدماغ، Node = العرض فقط.
 * هذا الـ proxy ما بيعملش أي logic — بس بيمرر الـ query params للـ Python ويرجع النتيجة.
 *
 * كل المنطق (WIN/LOSS/EXPIRED/PENDING، returnPct، winRate، avgWinPct، avgLossPct،
 * profitFactor، closedCount، persona classification، market session detection،
 * statsByPersona) بيتحسب في Python. الـ frontend بـ display فقط.
 *
 * Supported query params (all forwarded to Python as-is):
 *   - market  (default: EGX)
 *   - days    (default: 30 — supported: 7 / 30 / 90)
 *   - limit   (default: 10 — max per persona)
 *
 * Response shape (من Python — python-live-tracking-v2):
 *   {
 *     success: boolean,
 *     predictions: { gambler: [...], balanced: [...], conservative: [...] },
 *     stats: { total, wins, losses, expired, pending, settled, winRate,
 *              avgWinPct, avgLossPct, profitFactor, closedCount },
 *     statsByPersona: { gambler: {...}, balanced: {...}, conservative: {...} },
 *     market_session: { is_open, server_time, next_refresh_seconds, session_name },
 *     last_updated: string,
 *     source: 'python-live-tracking-v2',
 *     market: string,
 *     daysWindow: number
 *   }
 */

import { NextRequest, NextResponse } from 'next/server';

const PYTHON_BACKEND =
  process.env.PYTHON_BACKEND_URL ||
  process.env.VPS_API_URL ||
  process.env.EGXPY_SERVICE_URL ||
  'http://localhost:8010';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const PROD_VPS_BACKEND = 'https://invist.m2y.net';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const market = searchParams.get('market') || 'EGX';
  const days = searchParams.get('days') || '30';
  const limit = searchParams.get('limit') || '10';

  const fetchFromUrl = async (baseUrl: string) => {
    const url = `${baseUrl.replace(/\/$/, '')}/api/stored-analysis/live-tracking?market=${encodeURIComponent(market)}&days=${encodeURIComponent(days)}&limit=${encodeURIComponent(limit)}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: { Accept: 'application/json', 'User-Agent': 'GLMinvestment-LocalDev/1.0' },
        signal: controller.signal,
        cache: 'no-store',
      });
      clearTimeout(timeout);
      if (!response.ok) return null;
      return await response.json();
    } catch (e) {
      clearTimeout(timeout);
      return null;
    }
  };

  try {
    // 1. Try local Python backend first
    let data = await fetchFromUrl(PYTHON_BACKEND);
    let dataSource: 'local' | 'production' = 'local';

    const localSettled = Number(data?.stats?.closedCount ?? 0);

    // RL-FIX-16-FE: تحديث heuristic الـ fallback.
    // قبل كده كان الشرط: `localPf < 1.0 || localSettled < 1500` — وكان بيـ trigger
    // على كل طلب علشان Python API اللي اتصلح بيـ return profitFactor=0.25 (منخفض
    // لكنه صحيح بعد HONEST-WIN fix). ده كان بـ causes 10+ seconds latency لكل
    // request بسبب محاولة الاتصال بـ production VPS (اللي بـ timeout في الساندبوكس).
    // الحل: نـ fallback بس لو الـ backend محلي فاضي تماماً (closedCount < 100).
    // لو الـ backend شغال ويرجّع بيانات (حتى لو الأرقام منخفضة)، نثق فيه.
    if (!data || !data.success || localSettled < 100) {
      const prodData = await fetchFromUrl(PROD_VPS_BACKEND);
      if (prodData && prodData.success) {
        data = prodData;
        dataSource = 'production';
      }
    }

    // RL-FIX-8: علّم مصدر البيانات بوضوح علشان الـ UI يقدر يعرض "إنتاج" بدل "محلية"
    if (data && data.success) {
      data.source = dataSource === 'production' ? 'vps-production' : 'python-live-tracking-v2';
    }

    if (!data || !data.success) {
      return NextResponse.json(
        {
          success: false,
          error: 'Backend unavailable',
          predictions: { gambler: [], balanced: [], conservative: [] },
          stats: {
            total: 0, wins: 0, losses: 0, expired: 0, pending: 0,
            settled: 0, winRate: 0, avgWinPct: 0, avgLossPct: 0,
            profitFactor: 0, closedCount: 0,
          },
          statsByPersona: {
            gambler: { total: 0, wins: 0, losses: 0, pending: 0, settled: 0, winRate: 0, avgWinPct: 0, avgLossPct: 0, profitFactor: 0, closedCount: 0 },
            balanced: { total: 0, wins: 0, losses: 0, pending: 0, settled: 0, winRate: 0, avgWinPct: 0, avgLossPct: 0, profitFactor: 0, closedCount: 0 },
            conservative: { total: 0, wins: 0, losses: 0, pending: 0, settled: 0, winRate: 0, avgWinPct: 0, avgLossPct: 0, profitFactor: 0, closedCount: 0 },
          },
          market_session: {
            is_open: false,
            server_time: new Date().toISOString(),
            next_refresh_seconds: 300,
            session_name: 'unknown',
          },
          last_updated: new Date().toISOString(),
          source: 'python-live-tracking-v2',
          market,
          daysWindow: Number(days) || 30,
        },
        { status: 502 }
      );
    }

    return NextResponse.json(data, {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate',
        'X-Data-Source': 'python-live-tracking-v2',
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[/api/stored-analysis/live-tracking] proxy error:', msg);
    return NextResponse.json(
      {
        success: false,
        error: msg,
        predictions: { gambler: [], balanced: [], conservative: [] },
        stats: {
          total: 0, wins: 0, losses: 0, expired: 0, pending: 0,
          settled: 0, winRate: 0, avgWinPct: 0, avgLossPct: 0,
          profitFactor: 0, closedCount: 0,
        },
        statsByPersona: {
          gambler: { total: 0, wins: 0, losses: 0, pending: 0, settled: 0, winRate: 0, avgWinPct: 0, avgLossPct: 0, profitFactor: 0, closedCount: 0 },
          balanced: { total: 0, wins: 0, losses: 0, pending: 0, settled: 0, winRate: 0, avgWinPct: 0, avgLossPct: 0, profitFactor: 0, closedCount: 0 },
          conservative: { total: 0, wins: 0, losses: 0, pending: 0, settled: 0, winRate: 0, avgWinPct: 0, avgLossPct: 0, profitFactor: 0, closedCount: 0 },
        },
        market_session: {
          is_open: false,
          server_time: new Date().toISOString(),
          next_refresh_seconds: 300,
          session_name: 'unknown',
        },
        last_updated: new Date().toISOString(),
        source: 'python-live-tracking-v2',
        market,
        daysWindow: Number(days) || 30,
      },
      { status: 502 }
    );
  }
}
