/**
 * unified/route.ts — CANONICAL unified stock API (SINGLE SOURCE OF TRUTH)
 * ===============================================================================
 *
 * Route:  GET /api/stocks/[ticker]/unified
 *
 * Problem it solves:
 *   5 different UI screens showed 5 different signals for ETEL/CANA because each
 *   screen read from a different DB / API / calculation. This route is the
 *   ONE place that merges every data source and returns a canonical signal.
 *
 * Implementation:
 *   The actual computation logic lives in `src/lib/unified-stock-data.ts`.
 *   This route is a thin wrapper — same logic shared by all stock API routes.
 *   All other routes (/comprehensive, /publish-data, /recommendation, etc.)
 *   import from the same shared module so they return identical values.
 *
 * Rule 67 (CALCULATION-CANONICAL) + Rule 72 (UNIFIED-DATA-CONTRACT).
 */

import { NextRequest, NextResponse } from 'next/server';
import { getUnifiedStockData } from '@/lib/unified-stock-data';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(
  _req: NextRequest,
  { params }: { params: { ticker: string } }
) {
  const ticker = (params?.ticker ?? '').toString().toUpperCase().trim();
  if (!ticker) {
    return NextResponse.json(
      { success: false, error: 'missing_ticker' },
      { status: 400 }
    );
  }

  const data = getUnifiedStockData(ticker);
  if (!data) {
    return NextResponse.json(
      { success: false, error: 'stock_not_found', ticker },
      { status: 404 }
    );
  }

  return NextResponse.json(data);
}
