import { NextRequest, NextResponse } from 'next/server';
import { ensureInitialized, getGoldPriceHistory } from '@/lib/egx-db';

// ---------------------------------------------------------------------------
// GET /api/market/gold/history?karat=24&days=30
// Returns historical price data for a specific karat
// ---------------------------------------------------------------------------

export async function GET(request: NextRequest) {
  try {
    await ensureInitialized();
    const { searchParams } = new URL(request.url);
    const karat = searchParams.get('karat') || '24';
    const days = Math.min(Math.max(parseInt(searchParams.get('days') || '30', 10), 1), 365);

    const history = getGoldPriceHistory(karat, days);

    return NextResponse.json({
      success: true,
      karat,
      days,
      count: history.length,
      data: history.map((row) => ({
        date: row.recorded_at,
        price: Number(row.price_per_gram),
        change: row.change !== null ? Number(row.change) : null,
        currency: (row.currency as string) || 'EGP',
      })),
    });
  } catch (error) {
    console.error('[GET /api/market/gold/history] Error:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'حدث خطأ أثناء قراءة بيانات التاريخ',
      },
      { status: 500 }
    );
  }
}
