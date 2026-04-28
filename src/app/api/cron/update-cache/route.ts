/**
 * Scheduled Cache Update
 * تحديث ذاكرة التخزين المؤقت المجدول
 *
 * يتم استدعاؤه كل 30 دقيقة لتحديث البيانات
 *
 * Vercel Cron: 0,30 * * * *  (every 30 minutes)
 * Or use external cron service
 */

import { NextRequest, NextResponse } from 'next/server';
import { updateAllCache, getCacheStatus, initializePrecomputedCache } from '@/lib/cache/precomputed-cache';

// Verify cron secret for security
function verifyCronSecret(request: NextRequest): boolean {
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;

  // If no secret is set, allow (for development)
  if (!cronSecret) return true;

  // Check for Bearer token
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.slice(7);
    return token === cronSecret;
  }

  // Check for custom header
  const headerSecret = request.headers.get('x-cron-secret');
  if (headerSecret) {
    return headerSecret === cronSecret;
  }

  return false;
}

export async function GET(request: NextRequest) {
  // Verify authorization
  if (!verifyCronSecret(request)) {
    return NextResponse.json({
      success: false,
      error: 'Unauthorized',
    }, { status: 401 });
  }

  try {
    // Initialize if needed
    initializePrecomputedCache();

    // Check if update is needed
    const status = getCacheStatus();

    // Only update if:
    // 1. Never been updated
    // 2. Cache is stale (> 30 minutes old)
    // 3. Explicitly requested
    const forceUpdate = request.nextUrl.searchParams.get('force') === 'true';
    const needsUpdate = !status.last_update || status.cache_age_minutes >= 30 || forceUpdate;

    if (!needsUpdate) {
      return NextResponse.json({
        success: true,
        message: 'Cache is fresh, skipping update',
        status: {
          last_update: status.last_update,
          cache_age_minutes: status.cache_age_minutes,
          next_update: status.next_update,
        },
      });
    }

    // Perform update
    console.log('[Cron] Starting scheduled cache update...');
    const result = await updateAllCache();

    return NextResponse.json({
      success: result.success,
      message: result.success
        ? `Cache updated: ${result.stocks_cached} stocks in ${result.duration_ms}ms`
        : `Update failed: ${result.error}`,
      result,
    });
  } catch (error) {
    console.error('[Cron] Cache update error:', error);
    return NextResponse.json({
      success: false,
      error: String(error),
    }, { status: 500 });
  }
}

// Also support POST for manual triggers
export async function POST(request: NextRequest) {
  return GET(request);
}
