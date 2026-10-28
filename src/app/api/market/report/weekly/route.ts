/**
 * Market Weekly Report API
 * =========================
 * Primary: Python /api/market/report/weekly.
 * Fallback (FLUTTER-FULL-AUDIT): stocks.db — minimal weekly snapshot.
 *   Previously returned HTTP 500 when Python was down.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getTopMoversFallback } from '@/lib/flutter-sqlite-fallback';

export const dynamic = 'force-dynamic';

const PYTHON_BACKEND_URL =
  process.env.PYTHON_BACKEND_URL ||
  process.env.EGXPY_SERVICE_URL ||
  'http://127.0.0.1:8010';

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const market = searchParams.get('market') || 'EGX';
  const format = searchParams.get('format') || 'json';
  const url = `${PYTHON_BACKEND_URL}/api/market/report/weekly?market=${market}&format=${format}`;

  // 1. Try Python
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(5000),
    });

    if (response.ok) {
      if (format === 'text') {
        const text = await response.text();
        return new NextResponse(text, {
          status: 200,
          headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        });
      }
      const data = await response.json();
      return NextResponse.json(data);
    }
  } catch (error) {
    // fall through
  }

  // 2. SQLite fallback — reuse daily top movers as weekly proxy
  // FIX (FIX-API-MARKET #13): pass `market` through so non-EGX markets return
  // their own movers instead of all-market cross-contamination.
  const { gainers, losers, most_active } = getTopMoversFallback(20, market);

  if (format === 'text') {
    const lines: string[] = [
      `تقرير السوق الأسبوعي — ${market}`,
      `الأسبوع المنتهي: ${new Date().toISOString().slice(0, 10)}`,
      ``,
      `أعلى الرابحين هذا الأسبوع:`,
      ...gainers.map((g, i) => `${i + 1}. ${g.ticker} — ${g.change_percent?.toString()}%`),
      ``,
      `أعلى الخاسرين:`,
      ...losers.map((l, i) => `${i + 1}. ${l.ticker} — ${l.change_percent?.toString()}%`),
      ``,
      `المصدر: sqlite_fallback (Python backend unreachable)`,
    ];
    return new NextResponse(lines.join('\n'), {
      status: 200,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }

  return NextResponse.json({
    success: true,
    source: 'sqlite_fallback',
    market,
    week_ending: new Date().toISOString().slice(0, 10),
    top_gainers: gainers,
    top_losers: losers,
    most_active: most_active,
    note: 'Python backend unreachable — minimal weekly snapshot from stocks.db',
  });
}
