import { NextRequest, NextResponse } from 'next/server';
export const dynamic = "force-dynamic";

import { PYTHON_BACKEND_URL } from '@/lib/python-backend';

/**
 * POST /api/multi-market/sync
 * 
 * Sync all markets data from Python backend.
 * This triggers a full sync for all supported markets:
 * - EGX (Egypt)
 * - KSA (Saudi Arabia)
 * - KSE (Kuwait)
 * - DFM (Dubai)
 * - BSE (Bahrain)
 * - QSE (Qatar)
 * - CRYPTO
 */
export async function POST(request: NextRequest) {
  const markets = ['EGX', 'TADAWUL', 'KSE', 'DFM', 'BSE', 'QSE', 'CRYPTO'];
  const summary: Record<string, { synced: number; error?: string }> = {};

  // Try Python backend first
  try {
    const response = await fetch(`${PYTHON_BACKEND_URL}/api/multi-market/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(60000), // 60 second timeout for full sync
    });

    if (response.ok) {
      const data = await response.json();
      return NextResponse.json({
        success: true,
        message: 'تم تحديث جميع الأسواق بنجاح',
        summary: data.summary || data.results || {},
        source: 'python_backend',
      });
    }
  } catch (error) {
    console.warn('[/api/multi-market/sync] Python backend error:', error);
  }

  // Fallback: Sync each market individually via local API
  let totalSynced = 0;
  const errors: string[] = [];

  for (const market of markets) {
    try {
      const res = await fetch(`${PYTHON_BACKEND_URL}/api/market/overview?market=${market}`, {
        method: 'GET',
        signal: AbortSignal.timeout(15000),
      });

      if (res.ok) {
        const data = await res.json();
        const count = data?.summary?.total_stocks || 0;
        summary[market] = { synced: count };
        totalSynced += count;
      } else {
        summary[market] = { synced: 0, error: `HTTP ${res.status}` };
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Unknown error';
      summary[market] = { synced: 0, error: errorMsg };
      errors.push(`${market}: ${errorMsg}`);
    }
  }

  return NextResponse.json({
    success: totalSynced > 0,
    message: totalSynced > 0 
      ? `تم تحديث ${totalSynced} سهم من ${markets.length} أسواق`
      : 'فشل تحديث الأسواق',
    summary,
    total_synced: totalSynced,
    errors: errors.length > 0 ? errors : undefined,
    source: 'fallback',
  });
}

/**
 * GET /api/multi-market/sync
 * 
 * Get sync status for all markets.
 */
export async function GET(request: NextRequest) {
  const markets = ['EGX', 'TADAWUL', 'KSE', 'DFM', 'BSE', 'QSE', 'CRYPTO'];
  const status: Record<string, { available: boolean; count: number; last_update?: string }> = {};

  try {
    // Get counts from local database
    const { getLightDb, ensureInitialized } = await import('@/lib/egx-db');
    await ensureInitialized();
    const db = getLightDb();

    for (const market of markets) {
      try {
        const count = db.prepare(
          'SELECT COUNT(*) as cnt FROM stocks WHERE is_active = 1 AND market = ?'
        ).get(market.toUpperCase()) as { cnt: number };

        status[market] = {
          available: (count?.cnt || 0) > 0,
          count: count?.cnt || 0,
        };
      } catch {
        status[market] = { available: false, count: 0 };
      }
    }

    return NextResponse.json({
      success: true,
      status,
      markets_count: markets.length,
    });
  } catch (error) {
    return NextResponse.json({
      success: false,
      error: 'Failed to get sync status',
    }, { status: 500 });
  }
}
