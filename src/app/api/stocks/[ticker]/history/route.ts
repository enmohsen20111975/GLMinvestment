/**
 * GET /api/stocks/[ticker]/history
 * ================================
 * CANONICAL price-history route — pure proxy to Python engine.
 *
 *Directive P1 (API Routes Decoupling): NO direct SQLite access in Next.js
 * routes. This route proxies to Python `/api/history/{ticker}` ONLY. If Python
 * is unreachable → honest 404 with empty data (Rule 27 NO-FAKE-DATA).
 *
 * Rule 4 (Python = brain, Frontend = mirror only).
 * Rule 27 (NO-FAKE-DATA).
 */
import { NextRequest, NextResponse } from 'next/server';
import { PYTHON_BACKEND_URL } from '@/lib/python-backend';

export const dynamic = 'force-dynamic';

function resolveTicker(rawTicker: string): string {
  const clean = rawTicker.toUpperCase().replace(/\.CA$/, '').trim();
  if (clean === 'KORRA' || clean === 'KORAKORRAD') return 'KORA';
  if (clean === 'COMMI') return 'COMI';
  return clean;
}

export async function GET(req: NextRequest, { params }: { params: { ticker: string } }) {
  const { ticker } = params;
  const url = new URL(req.url);
  const qs = url.searchParams.toString();
  const resolvedTicker = resolveTicker(ticker);

  // Python canonical endpoints (primary + direct fallback).
  const targetUrls = [
    `${PYTHON_BACKEND_URL}/api/history/${resolvedTicker}${qs ? `?${qs}` : ''}`,
    `http://127.0.0.1:8010/api/history/${resolvedTicker}${qs ? `?${qs}` : ''}`,
  ];

  for (const targetUrl of targetUrls) {
    try {
      const res = await fetch(targetUrl, { signal: AbortSignal.timeout(8000), cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        if (data.success && data.data && Array.isArray(data.data.history) && data.data.history.length > 0) {
          return NextResponse.json({
            success: true,
            data: data.data.history,
          });
        }
      }
    } catch {
      // Try next fallback URL (safe-by-design).
    }
  }

  // Rule 27: honest empty — no fabricated price history.
  return NextResponse.json({
    success: false,
    error: `تعذّر جلب بيانات السهم ${resolvedTicker} من المحرك الكنسي`,
    ticker: resolvedTicker,
    data: [],
  }, { status: 404 });
}
