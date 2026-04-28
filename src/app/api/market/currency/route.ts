import { NextResponse } from 'next/server';
import { ensureInitialized, getCurrencyRates } from '@/lib/egx-db';

// ---------------------------------------------------------------------------
// GET /api/market/currency
// Reads currency exchange rates from the database (no SDK dependency).
// Admin can update rates via /api/admin/currency endpoint.
// ---------------------------------------------------------------------------

export const maxDuration = 15;

export async function GET() {
  try {
    await ensureInitialized();
    const rows = getCurrencyRates();

    if (!rows || rows.length === 0) {
      return NextResponse.json({
        success: false,
        source: 'database',
        error: 'لا توجد بيانات صرف متاحة في قاعدة البيانات',
        fetched_at: new Date().toISOString(),
      });
    }

    // Get the latest update timestamp
    const lastUpdated = rows.reduce((latest: string, r) => {
      const t = r.updated_at as string;
      return t > latest ? t : latest;
    }, '');

    // Map database rows to frontend format
    const currencies = rows.map((r) => ({
      code: r.code as string,
      name_ar: r.name_ar as string,
      buy_rate: Number(r.buy_rate) || 0,
      sell_rate: Number(r.sell_rate) || 0,
      change: r.change !== null ? Number(r.change) : null,
      is_major: r.is_major === 1,
      last_updated: r.updated_at as string,
    }));

    // Get central bank rate (USD buy rate as approximation)
    const usd = rows.find((r) => r.code === 'USD');
    const central_bank_rate = usd ? Number(usd.buy_rate) : 0;

    return NextResponse.json({
      success: true,
      source: 'database',
      fetched_at: new Date().toISOString(),
      last_updated: lastUpdated,
      central_bank_rate,
      currencies,
    });
  } catch (error) {
    console.error('[GET /api/market/currency] Error:', error);
    return NextResponse.json(
      {
        success: false,
        source: 'database',
        error: 'حدث خطأ أثناء قراءة بيانات الصرف',
        fetched_at: new Date().toISOString(),
      },
      { status: 500 }
    );
  }
}
