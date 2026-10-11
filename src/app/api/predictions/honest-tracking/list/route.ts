/**
 * Honest Prediction Tracking API — List
 * =======================================
 * RULE20-FIX (2026-10-11): Converted from 809 lines of Node DB queries
 * to a thin proxy to Python /api/stored-analysis/live-tracking.
 *
 * Rule 20 (Python = brain, Node = display only): removed all DB queries,
 * win_rate/profit_factor computations, and SQLite access from this route.
 * The Python endpoint reads from `predictions` table (79 columns) and
 * computes all stats. This route only:
 *   1. Forwards query params to Python
 *   2. Flattens the grouped response (by persona) into a flat array
 *   3. Applies display filters (status, signal, minScore)
 *   4. Returns in the format the frontend expects
 *
 * This is display formatting, not business logic (Rule 20 compliant).
 */

import { NextRequest, NextResponse } from 'next/server';
import { normalizeMarket, NO_PREDICTIONS_MESSAGE_AR, INTERNAL_ERROR_MESSAGE_AR } from '@/lib/market-utils';

export const dynamic = 'force-dynamic';

const PY = process.env.EGXPY_SERVICE_URL || process.env.PYTHON_BACKEND_URL || 'http://127.0.0.1:8010';
const PROD_VPS = 'https://invist.m2y.net';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const market = searchParams.get('market') || 'all';
  const status = searchParams.get('status') || 'all';
  const signal = searchParams.get('signal') || 'all';
  const limit = Math.min(parseInt(searchParams.get('limit') || '50'), 2000);
  const offset = parseInt(searchParams.get('offset') || '0');
  const minScore = parseInt(searchParams.get('minScore') || '0');
  const topPerDay = parseInt(searchParams.get('topPerDay') || '0');

  const canonicalMarket = normalizeMarket(market);

  // Build Python query params
  const pyParams = new URLSearchParams();
  pyParams.set('market', canonicalMarket || 'EGX');
  pyParams.set('days', '999'); // all history
  pyParams.set('limit', '2000'); // max per persona

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
        predictions: [],
        pagination: { total: 0, limit, offset, has_more: false },
        message: INTERNAL_ERROR_MESSAGE_AR,
        data_source: 'unavailable',
      }, {
        status: 200,
        headers: {
          'Cache-Control': 'no-store, no-cache, must-revalidate',
          'X-Data-Source': 'unavailable',
        },
      });
    }

    // 3. Flatten grouped predictions into a flat array (display formatting)
    const grouped = data.predictions || {};
    let allPredictions: any[] = [];
    for (const persona of ['gambler', 'balanced', 'conservative']) {
      const items = grouped[persona] || [];
      allPredictions.push(...items);
    }

    // 4. Apply display filters (not business logic — just UI filtering)
    if (status !== 'all') {
      allPredictions = allPredictions.filter((p) => {
        const pStatus = p.outcome || 'PENDING';
        return pStatus === status.toUpperCase();
      });
    }
    if (signal !== 'all') {
      allPredictions = allPredictions.filter((p) => {
        const pSignal = (p.signal || p.signal_type || '').toUpperCase();
        return pSignal === signal.toUpperCase();
      });
    }
    if (minScore > 0) {
      allPredictions = allPredictions.filter((p) => {
        const score = Number(p.maestroScore || p.confidence || 0);
        return score >= minScore;
      });
    }

    // 5. Sort by prediction date (newest first)
    allPredictions.sort((a, b) => {
      const da = String(a.entryDate || a.prediction_date || '').slice(0, 10);
      const db = String(b.entryDate || b.prediction_date || '').slice(0, 10);
      return db.localeCompare(da);
    });

    // 6. Apply topPerDay limit (display quality filter)
    if (topPerDay > 0) {
      const groups = new Map<string, any[]>();
      for (const p of allPredictions) {
        const dateStr = String(p.entryDate || p.prediction_date || '').slice(0, 10);
        if (!groups.has(dateStr)) groups.set(dateStr, []);
        groups.get(dateStr)!.push(p);
      }
      const kept: any[] = [];
      for (const [, group] of groups) {
        group.sort((a, b) => Number(b.maestroScore || 0) - Number(a.maestroScore || 0));
        kept.push(...group.slice(0, topPerDay));
      }
      allPredictions = kept;
    }

    // 7. Pagination
    const total = allPredictions.length;
    const page = allPredictions.slice(offset, offset + limit);

    return NextResponse.json({
      success: true,
      predictions: page,
      pagination: {
        total,
        limit,
        offset,
        has_more: (offset + limit) < total,
      },
      filters: { market, status, signal, minScore, topPerDay },
      data_source: data.source || 'python-live-tracking-v2',
      stats: data.stats || null,
      statsByPersona: data.statsByPersona || null,
    }, {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate',
        'X-Data-Source': data.source || 'python-live-tracking-v2',
      },
    });
  } catch (error) {
    console.error('[predictions:honest-tracking:list] proxy error:', error);
    return NextResponse.json({
      success: true,
      predictions: [],
      pagination: { total: 0, limit, offset, has_more: false },
      message: INTERNAL_ERROR_MESSAGE_AR,
      data_source: 'error-fallback',
    }, {
      status: 200,
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate',
        'X-Data-Source': 'error-fallback',
      },
    });
  }
}
