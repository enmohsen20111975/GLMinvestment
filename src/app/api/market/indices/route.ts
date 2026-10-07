import { NextRequest, NextResponse } from 'next/server';
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = 'nodejs';

import { fetchMarketIndices, MARKET_NAMES_AR } from '@/lib/market-data-access';

/**
 * /api/market/indices?market=<EGX|TADAWUL|KSE|QSE|US|CRYPTO>
 *
 * Market Indices System (MARKET-INDICES-SYSTEM):
 * Each market returns its OWN indices. Delegates to the shared
 * `fetchMarketIndices` helper in `src/lib/market-data-access.ts`, which is
 * also used by `/api/market-pulse` and `/api/market/overview` to keep the
 * fetch logic in one place (avoids recursive HTTP calls inside the Next.js
 * dev server, which would otherwise crash better-sqlite3).
 *
 *   - EGX     → market_indices table (EGX30/EGX70/EGX100/EGX50/EGX33)
 *   - US      → Yahoo Finance live (^GSPC, ^IXIC, ^DJI)
 *   - CRYPTO  → CoinGecko /global + alternative.me (BTC.D, TotalMcap, Fear&Greed)
 *   - TADAWUL → Yahoo Finance live (^TASI.SR) + composite from stocks.db
 *   - KSE     → Composite from stocks.db (labelled as Composite)
 *   - QSE     → Composite from stocks.db (labelled as Composite)
 *
 * Rule 27 (NO-FAKE-DATA): For markets without an official index ticker on a
 * reachable external API, we return a clearly-labelled *composite* index
 * computed from the stocks in stocks.db. We never fabricate values.
 */

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const marketRaw = (url.searchParams.get('market') || 'EGX').toUpperCase();
  // FIX-WAVE-3-HIGH / AUDIT-DEEP-4 #8: pagination params (Rule 56)
  const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') || '100', 10), 1), 1000);
  const offset = Math.max(parseInt(url.searchParams.get('offset') || '0', 10), 0);

  try {
    const { indices, market, source } = await fetchMarketIndices(marketRaw);

    if (!market || ['EGX', 'TADAWUL', 'KSE', 'QSE', 'US', 'CRYPTO'].indexOf(market) === -1) {
      return NextResponse.json(
        { success: false, error: 'unknown_market', market: marketRaw, supported: ['EGX', 'TADAWUL', 'KSE', 'QSE', 'US', 'CRYPTO'] },
        { status: 400 }
      );
    }

    const total = indices.length;
    const paged = indices.slice(offset, offset + limit);

    return NextResponse.json({
      success: true,
      market,
      market_name_ar: MARKET_NAMES_AR[market] || market,
      source,
      indices: paged,
      total,
      pagination: { limit, offset, total },
      generated_at: new Date().toISOString(),
    });
  } catch (e) {
    console.error('[GET /api/market/indices] Error:', e);
    return NextResponse.json({ success: false, error: 'internal_error', message: String(e) }, { status: 500 });
  }
}
