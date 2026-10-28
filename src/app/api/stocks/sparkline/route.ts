import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

// (ALPHA-DAL — owner directive 2026-10-27):
// «عدّل src/app/api/stocks/sparkline/route.ts ليستدعي DbManager.getLiveSparkline
// بدلاً من فتح SQLite مباشرة.»
// المسار ده دلوقتي thin wrapper — كل الـ DB access بيحصل جوه DbManager (DAL المقفل).
// المحظور: «ممنوع كتابة SELECT أو new Database() داخل أي مسار UI أو component.»

import { getLiveSparkline, getLiveSparklines } from '@/lib/db-manager';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const rawTicker = searchParams.get('ticker') || '';
    const tickersParam = searchParams.get('tickers') || '';
    const days = Math.min(90, Math.max(7, parseInt(searchParams.get('days') || '30', 10)));

    if (!rawTicker && !tickersParam) {
      return NextResponse.json({ success: false, error: 'ticker or tickers required' }, { status: 400 });
    }

    if (tickersParam) {
      const list = tickersParam.split(',').map((s) => s.trim()).filter(Boolean).slice(0, 50);
      const results = getLiveSparklines(list, days);
      // Convert SparklineData[] to plain objects for JSON response.
      const data: Record<string, unknown> = {};
      for (const [t, spark] of Object.entries(results)) {
        data[t] = spark;
      }
      return NextResponse.json({ success: true, data });
    }

    const singleResult = getLiveSparkline(rawTicker, days);
    return NextResponse.json({ success: true, ...singleResult });
  } catch (e) {
    console.error('[stocks:sparkline]', e);
    return NextResponse.json({
      success: false,
      error: 'internal_error',
    }, { status: 500 });
  }
}
