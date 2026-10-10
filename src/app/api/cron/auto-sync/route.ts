/**
 * GET /api/cron/auto-sync
 *
 * Lightweight cron endpoint for automatic data synchronization
 * Should be called by external cron service (not internal scheduler)
 *
 * Optimized for shared hosting with limited resources
 */

import { NextRequest, NextResponse } from 'next/server';
export const dynamic = "force-dynamic";


// Track last sync time to prevent duplicate calls
let lastAutoSync: string | null = null;
const MIN_SYNC_INTERVAL_MS = 25 * 60 * 1000; // 25 minutes minimum between syncs

export async function GET(request: NextRequest) {
  const now = new Date();
  const nowIso = now.toISOString();

  // Check if we synced recently (prevent duplicate calls)
  if (lastAutoSync) {
    const lastSyncTime = new Date(lastAutoSync).getTime();
    const timeSinceLastSync = now.getTime() - lastSyncTime;
    if (timeSinceLastSync < MIN_SYNC_INTERVAL_MS) {
      return NextResponse.json({
        success: true,
        message: 'Sync already performed recently',
        last_sync: lastAutoSync,
        minutes_since_last_sync: Math.floor(timeSinceLastSync / 60000),
        next_sync_in_minutes: Math.ceil((MIN_SYNC_INTERVAL_MS - timeSinceLastSync) / 60000),
      });
    }
  }

  try {
    // Simple sync - just update prices, no heavy operations
    const syncResponse = await fetch(`${request.nextUrl.origin}/api/market/scheduled-sync`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    const syncResult = await syncResponse.json();

    lastAutoSync = nowIso;

    return NextResponse.json({
      success: true,
      timestamp: nowIso,
      sync: {
        success: syncResult.success,
        stocks_updated: syncResult.summary?.price_updated || 0,
        history_inserted: syncResult.summary?.total_history_inserted || 0,
        elapsed_ms: syncResult.summary?.elapsed_ms || 0,
      },
      next_sync_recommended_at: new Date(now.getTime() + 30 * 60 * 1000).toISOString(),
    });
  } catch (error) {
    console.error('[AutoSync] Error:', error);
    return NextResponse.json({
      success: false,
      timestamp: nowIso,
      error: 'internal_error',
    }, { status: 500 });
  }
}

// Also support POST for manual triggers
export async function POST(request: NextRequest) {
  return GET(request);
}
