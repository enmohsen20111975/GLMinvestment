import { NextRequest, NextResponse } from 'next/server';
import { PYTHON_BACKEND_URL } from '@/lib/python-backend';
// (ALPHA-DAL-WAVE2 — owner directive 2026-10-27):
// «إزالة استدعاء new Database(...) نهائياً. البديل: استخدام openDb من DbManager.»
import { openDb } from '@/lib/db-manager';

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
  const days = parseInt(url.searchParams.get('days') || '365', 10);
  const resolvedTicker = resolveTicker(ticker);

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
            data: data.data.history
          });
        }
      }
    } catch (_err) {
      // Try next fallback
    }
  }

  // Local SQLite fallback from stocks.db stock_daily_prices (via DbManager DAL)
  // (ALPHA-DAL-WAVE2): استخدم openDb من الـ DAL — ممنوع new Database().
  const db = openDb('stocks.db');
  if (db) {
    try {
      const rows = db.prepare(`
        SELECT price_date as date,
               COALESCE(open, open_price) as open,
               COALESCE(high, high_price) as high,
               COALESCE(low, low_price) as low,
               COALESCE(close, close_price) as close,
               COALESCE(volume, 0) as volume
        FROM stock_daily_prices
        WHERE ticker = ?
        ORDER BY price_date DESC
        LIMIT ?
      `).all(resolvedTicker, days) as any[];
      db.close();

      if (rows && rows.length > 0) {
        return NextResponse.json({
          success: true,
          data: rows.reverse()
        });
      }
    } catch (e) {
      console.warn(`[history] Local fallback failed for ${ticker}:`, e);
    } finally {
      try { db.close(); } catch { /* noop */ }
    }
  }

  return NextResponse.json({
    success: false,
    error: `Failed to fetch history for ${ticker}`,
  }, { status: 404 });
}
