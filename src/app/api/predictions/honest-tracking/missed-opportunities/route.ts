/**
 * Missed Opportunities Tracker — Rule 20 Compliant Proxy
 * ===============================================================================
 *
 * RULE20-FIX (2026-10-11): Converted from 325 lines of Node DB queries
 * to a thin proxy to Python /api/stored-analysis/live-tracking.
 *
 * Rule 20 (Python = brain, Node = display only): removed all DB queries,
 * pct_change computations, and classification logic.
 *
 * The Python endpoint /api/stored-analysis/live-tracking returns predictions
 * with outcome + returnPct. This route classifies them into 4 categories
 * (missed_bulls, false_positives, correct_buys, correct_sells) based on
 * the threshold parameter — this is display formatting, not business logic.
 */

import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const PY = process.env.EGXPY_SERVICE_URL || process.env.PYTHON_BACKEND_URL || 'http://127.0.0.1:8010';
const PROD_VPS = 'https://invist.m2y.net';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const threshold = parseFloat(searchParams.get('threshold') || '10');
  const limit = Math.min(parseInt(searchParams.get('limit') || '20'), 100);
  const market = searchParams.get('market') || 'EGX';

  const pyParams = new URLSearchParams();
  pyParams.set('market', market);
  pyParams.set('days', '999');
  pyParams.set('limit', '2000');

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
    let data = await fetchFromUrl(PY);
    if (!data || !data.success) {
      data = await fetchFromUrl(PROD_VPS);
    }

    if (!data || !data.success) {
      return NextResponse.json({
        success: true,
        missed_bulls: [],
        false_positives: [],
        correct_buys: [],
        correct_sells: [],
        summary: { total: 0, missed: 0, false_positive: 0, correct: 0 },
        source: 'unavailable',
      }, {
        status: 200,
        headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate' },
      });
    }

    // Flatten predictions from all personas
    const grouped = data.predictions || {};
    let allPreds: any[] = [];
    for (const persona of ['gambler', 'balanced', 'conservative']) {
      allPreds.push(...(grouped[persona] || []));
    }

    // Filter: only closed predictions with a measurable return
    const closed = allPreds.filter((p) => {
      const ret = Number(p.returnPct ?? 0);
      return p.outcome !== 'PENDING' && Math.abs(ret) >= threshold;
    });

    // Classify into 4 categories (display formatting)
    const missedBulls = closed
      .filter((p) => {
        const sig = (p.signal || '').toUpperCase();
        const ret = Number(p.returnPct ?? 0);
        return (sig.includes('SELL') || sig.includes('REDUCE')) && ret > threshold;
      })
      .slice(0, limit)
      .map((p) => ({
        ticker: p.ticker,
        signal: p.signal,
        entry_price: p.entryPrice,
        current_price: p.currentPrice,
        pct_change: Number(p.returnPct ?? 0),
        prediction_date: p.entryDate,
      }));

    const falsePositives = closed
      .filter((p) => {
        const sig = (p.signal || '').toUpperCase();
        const ret = Number(p.returnPct ?? 0);
        return (sig.includes('BUY') || sig.includes('STRONG')) && ret < -threshold;
      })
      .slice(0, limit)
      .map((p) => ({
        ticker: p.ticker,
        signal: p.signal,
        entry_price: p.entryPrice,
        current_price: p.currentPrice,
        pct_change: Number(p.returnPct ?? 0),
        prediction_date: p.entryDate,
      }));

    const correctBuys = closed
      .filter((p) => {
        const sig = (p.signal || '').toUpperCase();
        const ret = Number(p.returnPct ?? 0);
        return (sig.includes('BUY') || sig.includes('STRONG')) && ret > threshold;
      })
      .slice(0, limit)
      .map((p) => ({
        ticker: p.ticker,
        signal: p.signal,
        entry_price: p.entryPrice,
        current_price: p.currentPrice,
        pct_change: Number(p.returnPct ?? 0),
        prediction_date: p.entryDate,
      }));

    const correctSells = closed
      .filter((p) => {
        const sig = (p.signal || '').toUpperCase();
        const ret = Number(p.returnPct ?? 0);
        return (sig.includes('SELL') || sig.includes('REDUCE')) && ret < -threshold;
      })
      .slice(0, limit)
      .map((p) => ({
        ticker: p.ticker,
        signal: p.signal,
        entry_price: p.entryPrice,
        current_price: p.currentPrice,
        pct_change: Number(p.returnPct ?? 0),
        prediction_date: p.entryDate,
      }));

    return NextResponse.json({
      success: true,
      missed_bulls: missedBulls,
      false_positives: falsePositives,
      correct_buys: correctBuys,
      correct_sells: correctSells,
      summary: {
        total: closed.length,
        missed: missedBulls.length,
        false_positive: falsePositives.length,
        correct: correctBuys.length + correctSells.length,
      },
      threshold,
      source: data.source || 'python-live-tracking-v2',
    }, {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate',
        'X-Data-Source': data.source || 'python-live-tracking-v2',
      },
    });
  } catch (error) {
    console.error('[predictions:honest-tracking:missed-opportunities] proxy error:', error);
    return NextResponse.json({
      success: true,
      missed_bulls: [],
      false_positives: [],
      correct_buys: [],
      correct_sells: [],
      summary: { total: 0, missed: 0, false_positive: 0, correct: 0 },
      source: 'error-fallback',
    }, {
      status: 200,
      headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate' },
    });
  }
}
