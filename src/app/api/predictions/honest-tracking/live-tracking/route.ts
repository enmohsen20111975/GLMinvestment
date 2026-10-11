/**
 * Honest Live Tracking — Rule 20 Compliant Proxy
 * ===============================================================================
 *
 * RULE20-FIX (2026-10-11): Converted from 320 lines of Node DB queries
 * to a thin proxy to Python /api/stored-analysis/live-tracking.
 *
 * Rule 20 (Python = brain, Node = display only): removed all DB queries,
 * win_rate/profit_factor/avgWinPct computations, and SQLite access.
 * The Python endpoint computes all stats from the `predictions` table.
 * This route just forwards query params and returns the Python response.
 */

import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const PY = process.env.EGXPY_SERVICE_URL || process.env.PYTHON_BACKEND_URL || 'http://127.0.0.1:8010';
const PROD_VPS = 'https://invist.m2y.net';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const market = searchParams.get('market') || 'EGX';
  const days = searchParams.get('days') || '30';
  const limit = searchParams.get('limit') || '50';
  const minScore = searchParams.get('minScore') || '0';

  const pyParams = new URLSearchParams();
  pyParams.set('market', market);
  pyParams.set('days', days);
  pyParams.set('limit', limit);

  const fetchFromUrl = async (baseUrl: string) => {
    const url = `${baseUrl.replace(/\/$/, '')}/api/stored-analysis/live-tracking?${pyParams.toString()}`;
    try {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(15000),
        headers: { Accept: 'application/json' },
        cache: 'no-store',
      });
      if (!res.ok) return null;
      return await res.json();
    } catch {
      return null;
    }
  };

  try {
    // 1. Try local Python backend
    let data = await fetchFromUrl(PY);

    // 2. Fallback to production VPS
    if (!data || !data.success) {
      data = await fetchFromUrl(PROD_VPS);
    }

    if (!data || !data.success) {
      // Graceful degradation (Rule 27: NO-FAKE-DATA)
      return NextResponse.json({
        success: true,
        predictions: { gambler: [], balanced: [], conservative: [] },
        stats: {
          total: 0, wins: 0, losses: 0, pending: 0,
          settled: 0, winRate: 0, avgWinPct: 0, avgLossPct: 0,
          profitFactor: 0, closedCount: 0, expired: 0,
        },
        statsByPersona: {
          gambler: { total: 0, wins: 0, losses: 0, pending: 0, settled: 0, winRate: 0, avgWinPct: 0, avgLossPct: 0, profitFactor: 0, closedCount: 0 },
          balanced: { total: 0, wins: 0, losses: 0, pending: 0, settled: 0, winRate: 0, avgWinPct: 0, avgLossPct: 0, profitFactor: 0, closedCount: 0 },
          conservative: { total: 0, wins: 0, losses: 0, pending: 0, settled: 0, winRate: 0, avgWinPct: 0, avgLossPct: 0, profitFactor: 0, closedCount: 0 },
        },
        market_session: { is_open: false, server_time: new Date().toISOString(), next_refresh_seconds: 300, session_name: 'unknown' },
        last_updated: new Date().toISOString(),
        source: 'unavailable',
        market,
        daysWindow: Number(days) || 30,
      }, {
        status: 200,
        headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate' },
      });
    }

    // Apply minScore filter if specified (display filtering, not business logic)
    if (minScore && Number(minScore) > 0) {
      const ms = Number(minScore);
      const preds = data.predictions || {};
      for (const persona of Object.keys(preds)) {
        preds[persona] = (preds[persona] || []).filter((p: any) =>
          Number(p.maestroScore || p.confidence || 0) >= ms
        );
      }
    }

    return NextResponse.json(data, {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate',
        'X-Data-Source': data.source || 'python-live-tracking-v2',
      },
    });
  } catch (error) {
    console.error('[predictions:honest-tracking:live-tracking] proxy error:', error);
    return NextResponse.json({
      success: true,
      predictions: { gambler: [], balanced: [], conservative: [] },
      stats: { total: 0, wins: 0, losses: 0, pending: 0, settled: 0, winRate: 0, avgWinPct: 0, avgLossPct: 0, profitFactor: 0, closedCount: 0, expired: 0 },
      statsByPersona: {},
      market_session: { is_open: false, server_time: new Date().toISOString(), next_refresh_seconds: 300, session_name: 'unknown' },
      last_updated: new Date().toISOString(),
      source: 'error-fallback',
      market,
      daysWindow: Number(days) || 30,
    }, {
      status: 200,
      headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate' },
    });
  }
}
