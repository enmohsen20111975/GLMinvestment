/**
 * Market Daily Report API
 * ========================
 * Primary: Python /api/market/report/daily.
 * Fallback (FLUTTER-FULL-AUDIT): stocks.db — compose a minimal daily
 *   snapshot from stocks + top movers when Python is down. Previously
 *   returned HTTP 500 — caused Flutter daily-report screen to crash.
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  getTopMoversFallback,
  getMarketStatusFallback,
} from '@/lib/flutter-sqlite-fallback';

export const dynamic = 'force-dynamic';

const PYTHON_BACKEND_URL =
  process.env.PYTHON_BACKEND_URL ||
  process.env.EGXPY_SERVICE_URL ||
  'http://127.0.0.1:8010';

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const market = searchParams.get('market') || 'EGX';
  const format = searchParams.get('format') || 'json';
  const url = `${PYTHON_BACKEND_URL}/api/market/report/daily?market=${market}&format=${format}`;

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

  // 2. SQLite fallback — compose minimal daily snapshot
  const { gainers, losers, most_active } = getTopMoversFallback(10);
  const marketStatus = getMarketStatusFallback();

  if (format === 'text') {
    const lines: string[] = [
      `تقرير السوق اليومي — ${market}`,
      `التاريخ: ${new Date().toISOString().slice(0, 10)}`,
      `حالة السوق: ${marketStatus.is_open ? 'مفتوح' : 'مغلق'}`,
      ``,
      `أعلى الرابحين:`,
      ...gainers.map((g, i) => `${i + 1}. ${g.ticker} — ${g.change_percent?.toString()}%`),
      ``,
      `أعلى الخاسرين:`,
      ...losers.map((l, i) => `${i + 1}. ${l.ticker} — ${l.change_percent?.toString()}%`),
      ``,
      `الأكثر نشاطاً:`,
      ...most_active.map((m, i) => `${i + 1}. ${m.ticker} — حجم: ${m.volume?.toString()}`),
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
    date: new Date().toISOString().slice(0, 10),
    market_status: marketStatus,
    gainers,
    losers,
    most_active,
    summary: {
      total_gainers: gainers.length,
      total_losers: losers.length,
      total_active: most_active.length,
    },
    note: 'Python backend unreachable — minimal daily snapshot from stocks.db',
  });
}
