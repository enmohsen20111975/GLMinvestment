/**
 * Learn From Errors — Rule 20 Compliant Proxy
 * ===============================================================================
 *
 * RULE20-FIX (2026-10-11): Converted from 213 lines of Node DB queries
 * to a thin proxy to Python /api/stored-analysis/live-tracking.
 *
 * Rule 20 (Python = brain, Node = display only): removed all DB queries
 * and lesson extraction logic.
 *
 * The Python endpoint returns predictions with outcomes. This route
 * extracts simple lessons from the stats (display formatting, not
 * business logic).
 */

import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const PY = process.env.EGXPY_SERVICE_URL || process.env.PYTHON_BACKEND_URL || 'http://127.0.0.1:8010';
const PROD_VPS = 'https://invist.m2y.net';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
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
        lessons: [],
        source: 'unavailable',
      }, {
        status: 200,
        headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate' },
      });
    }

    // Extract simple lessons from stats (display formatting)
    const stats = data.stats || {};
    const lessons: any[] = [];

    // Lesson 1: Low win rate
    const winRate = Number(stats.winRate || 0);
    const closed = Number(stats.closedCount || stats.settled || 0);
    if (closed > 10 && winRate < 50) {
      lessons.push({
        type: 'performance',
        category: 'الأداء العام',
        rule: `نسبة النجاح منخفضة (${winRate}%)`,
        evidence: `${stats.wins || 0} فوز من ${closed} صفقة مغلقة`,
        failure_rate: 100 - winRate,
        sample_size: closed,
        recommendation: 'مراجعة استراتيجية الدخول — تفعيل فلاتر أصرم (strict entry + kill filters)',
        created_at: new Date().toISOString(),
      });
    }

    // Lesson 2: Profit factor
    const pf = Number(stats.profitFactor || 0);
    if (closed > 10 && pf < 1.0) {
      lessons.push({
        type: 'risk',
        category: 'إدارة المخاطر',
        rule: `معامل الربحية منخفض (${pf})`,
        evidence: `PF = ${pf} (أقل من 1.0 = خسارة صافية)`,
        failure_rate: 0,
        sample_size: closed,
        recommendation: 'رفع R:R floor إلى 2.0 + تفعيل ATR stop clamp [5%, 9%]',
        created_at: new Date().toISOString(),
      });
    }

    // Lesson 3: High avg loss
    const avgLoss = Number(stats.avgLossPct || 0);
    if (closed > 10 && avgLoss < -7) {
      lessons.push({
        type: 'risk',
        category: 'إدارة المخاطر',
        rule: `متوسط الخسارة مرتفع (${avgLoss}%)`,
        evidence: `متوسط الخسارة = ${avgLoss}% (أعلى من الحد 7%)`,
        failure_rate: 0,
        sample_size: closed,
        recommendation: 'تفعيل Hard Loss Ceiling (7%) + تقليل حجم المركز',
        created_at: new Date().toISOString(),
      });
    }

    return NextResponse.json({
      success: true,
      lessons,
      stats_summary: {
        winRate,
        profitFactor: pf,
        avgWinPct: stats.avgWinPct || 0,
        avgLossPct: avgLoss,
        closedCount: closed,
      },
      source: data.source || 'python-live-tracking-v2',
    }, {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate',
        'X-Data-Source': data.source || 'python-live-tracking-v2',
      },
    });
  } catch (error) {
    console.error('[predictions:honest-tracking:learn-from-errors] proxy error:', error);
    return NextResponse.json({
      success: true,
      lessons: [],
      source: 'error-fallback',
    }, {
      status: 200,
      headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate' },
    });
  }
}

// POST handler — delegate to Python /api/predictions/tracking/verify
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const targetUrl = `${PY}/api/predictions/tracking/verify`;
    const res = await fetch(targetUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ market: body.market || 'EGX' }),
      signal: AbortSignal.timeout(60000),
    });

    if (!res.ok) {
      return NextResponse.json({
        success: false,
        error: `Python backend returned ${res.status}`,
      }, { status: 502 });
    }

    const data = await res.json();
    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json({
      success: false,
      error: e instanceof Error ? e.message : 'Unknown error',
    }, { status: 502 });
  }
}
