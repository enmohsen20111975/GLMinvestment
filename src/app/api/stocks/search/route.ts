import { NextRequest, NextResponse } from 'next/server';
import { ensureInitialized, getLightDb } from '@/lib/egx-db';

// ---------------------------------------------------------------------------
// GET /api/stocks/search?q=... — Lightweight search across ticker, name, name_ar
// Returns max 30 results from the light DB (custom.db)
// ---------------------------------------------------------------------------

export async function GET(request: NextRequest) {
  try {
    await ensureInitialized();

    const { searchParams } = new URL(request.url);
    const q = (searchParams.get('q') || '').trim();

    if (!q) {
      // Return first 30 active stocks sorted by volume when no query
      const db = getLightDb();
      const rows = db
        .prepare(
          `SELECT id, ticker, name, name_ar, sector, current_price, previous_close, volume,
                  egx30_member, egx70_member, egx100_member
           FROM stocks
           WHERE is_active = 1
           ORDER BY volume DESC
           LIMIT 30`
        )
        .all() as Record<string, unknown>[];

      const stocks = rows.map((row) => {
        const prev = Number(row.previous_close) || 0;
        const curr = Number(row.current_price) || 0;
        return {
          ...row,
          price_change: prev > 0 ? ((curr - prev) / prev) * 100 : 0,
        };
      });

      return NextResponse.json({ success: true, stocks });
    }

    const db = getLightDb();
    const term = `%${q}%`;

    const rows = db
      .prepare(
        `SELECT id, ticker, name, name_ar, sector, current_price, previous_close, volume,
                egx30_member, egx70_member, egx100_member
         FROM stocks
         WHERE is_active = 1
           AND (ticker LIKE ? OR name LIKE ? OR name_ar LIKE ?)
         ORDER BY
           CASE
             WHEN ticker LIKE ? THEN 1
             WHEN ticker = ? THEN 2
             ELSE 3
           END,
           volume DESC
         LIMIT 30`
      )
      .all(term, term, term, term, q) as Record<string, unknown>[];

    const stocks = rows.map((row) => {
      const prev = Number(row.previous_close) || 0;
      const curr = Number(row.current_price) || 0;
      return {
        ...row,
        price_change: prev > 0 ? ((curr - prev) / prev) * 100 : 0,
      };
    });

    return NextResponse.json({ success: true, stocks });
  } catch (error) {
    console.error('[GET /api/stocks/search] Error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to search stocks', detail: String(error) },
      { status: 500 }
    );
  }
}
