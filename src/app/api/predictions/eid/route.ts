/**
 * Eid Predictions API - توقعات العيد
 * ===================================
 * Phase 1 (P1-PREDICTIONS-CLUSTER): pure Python proxy — NO direct SQLite
 * access. This route previously opened BOTH `db/stocks.db` (table
 * `stock_daily_prices` + `stocks`) AND `db/predictions.db` (table
 * `predictions`) directly via three `new Database(...)` helper functions
 * (`getLastClose`, `getSupportResistance`, `getCanonicalPrediction`).
 * That violated Rule 4. Now it proxies to
 * `${PYTHON_BACKEND_URL}/api/predictions/eid` and passes the response
 * through verbatim. If Python is unreachable → honest empty
 * (Rule 27 NO-FAKE-DATA).
 *
 * Task BRAVO-PULSE-FIX (preserved at Python side): if the canonical
 * prediction is incomplete (no target / no stop / confidence = 0) →
 * the response falls back to "حياد / ترقب" with support/resistance.
 *
 * Rule 4 (Python = brain, Frontend = mirror only).
 * Rule 27 (NO-FAKE-DATA).
 */

import { NextRequest, NextResponse } from 'next/server';
export const dynamic = "force-dynamic";

import { PYTHON_BACKEND_URL } from '@/lib/python-backend';

export const revalidate = 30;

export async function GET(request: NextRequest) {
  try {
    // Forward all query params (market, ticker, etc.) to Python.
    const url = new URL(request.url);
    const qs = url.searchParams.toString();

    // Python canonical endpoints (primary + direct fallback).
    const targetUrls = [
      `${PYTHON_BACKEND_URL}/api/predictions/eid${qs ? `?${qs}` : ''}`,
      `http://127.0.0.1:8010/api/predictions/eid${qs ? `?${qs}` : ''}`,
    ];

    for (const targetUrl of targetUrls) {
      try {
        const res = await fetch(targetUrl, {
          cache: 'no-store',
          signal: AbortSignal.timeout(8000),
        });
        if (!res.ok) continue;
        const data = await res.json();
        if (!data) continue;

        // Pass through Python response verbatim (Rule 4: mirror only).
        // Stamp `source` so the client can identify the origin.
        return NextResponse.json({
          ...data,
          source: data.source || 'python_backend',
        });
      } catch {
        // Try next fallback URL (safe-by-design).
      }
    }

    // Rule 27: honest empty — no fabricated Eid predictions.
    return NextResponse.json({
      success: false,
      error: 'لا توجد بيانات أسعار كافية من المحرك الكنسي',
      generated_at: new Date().toISOString(),
      predictions: [],
      source: 'python_empty',
      message: 'لا توجد بيانات',
    }, { status: 503 });
  } catch (error: any) {
    console.error('Eid predictions error:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'تعذّر توليد التوقعات: ' + String(error?.message || error),
        generated_at: new Date().toISOString(),
        predictions: [],
        source: 'python_empty',
      },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  // POST → GET (parity with previous behaviour — refresh use-case).
  return GET(request);
}
