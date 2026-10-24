/**
 * seasonality-signals — proxy to Python /api/seasonality-signals (SeasonalityFirstEngine).
 *
 * FIX (2026-10-20, جيمي audit): الكود كان بيـ proxy لـ /api/market-pulse (غلط).
 * الـ Python عنده endpoint حقيقي /api/seasonality-signals بيستدعي SeasonalityFirstEngine
 * اللي بيحسب: seasonality (35%) + fundamental (30%) + sector (20%) + dividend (15%).
 *
 * الحل: proxy مباشر لـ /api/seasonality-signals Python (مش /api/market-pulse).
 */
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const PY = process.env.EGXPY_SERVICE_URL || process.env.PYTHON_BACKEND_URL || 'http://127.0.0.1:8010';

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const qs = url.searchParams.toString();
  const targetUrl = `${PY}/api/seasonality-signals${qs ? `?${qs}` : ''}`;

  try {
    const res = await fetch(targetUrl, {
      signal: AbortSignal.timeout(10000),
      cache: 'no-store' as RequestCache,
      headers: { 'Cache-Control': 'no-store' },
    });

    if (res.ok) {
      const data = await res.json();
      return NextResponse.json(data, {
        headers: {
          'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
          'Pragma': 'no-cache',
          'Expires': '0',
        },
      });
    }
  } catch {
    // fall through to empty response
  }

  // Fallback: Python unavailable → return empty (no fake data, Rule 27)
  return NextResponse.json({
    status: 'success',
    source: 'python_unavailable',
    scan_date: new Date().toISOString().split('T')[0],
    scan_timestamp: new Date().toISOString(),
    summary: {
      total_signals: 0,
      buy_signals: 0,
      sell_signals: 0,
      avg_confidence: 0,
    },
    signals: [],
    message: 'محرك الموسمية غير متاح حالياً — حاول مرة تانية',
  }, {
    headers: {
      'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
      'Pragma': 'no-cache',
      'Expires': '0',
    },
  });
}
