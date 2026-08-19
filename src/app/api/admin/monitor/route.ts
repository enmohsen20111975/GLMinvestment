import { NextRequest, NextResponse } from 'next/server';
import { ensureInitialized, getLightDb, getHeavyDbHealth } from '@/lib/egx-db';
import { requireAdminAsync } from '@/lib/admin-auth-server';
import { db } from '@/lib/db';

// ---------------------------------------------------------------------------
// In-memory cache for monitor data (refreshed every 30 seconds)
// ---------------------------------------------------------------------------
let _lastMonitorData: Record<string, unknown> | null = null;
let _lastMonitorTime = 0;
const MONITOR_CACHE_TTL_MS = 30000; // 30 seconds

// ---------------------------------------------------------------------------
// GET /api/admin/monitor
// Return comprehensive monitoring data for admin dashboard
// Heavy DB is NOT loaded to prevent memory issues on small servers.
// ---------------------------------------------------------------------------

export async function GET(request: NextRequest) {
  try {
    // Return cached data if fresh
    const now = Date.now();
    if (_lastMonitorData && (now - _lastMonitorTime) < MONITOR_CACHE_TTL_MS) {
      return NextResponse.json({
        ..._lastMonitorData,
        cached: true,
        cache_age_seconds: Math.floor((now - _lastMonitorTime) / 1000),
      });
    }

    // Verify admin access via custom header or cookie
    const authError = await requireAdminAsync(request);
    if (authError) return authError;

    // Initialize with timeout protection
    try {
      await Promise.race([
        ensureInitialized(),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('DB initialization timeout')), 5000)
        )
      ]) as void;
    } catch (e) {
      console.error('[Admin Monitor] DB initialization timeout:', e);
      return NextResponse.json({
        success: false,
        error: 'Database initialization timeout',
        timestamp: new Date().toISOString(),
      }, { status: 503 });
    }

    // ---- User stats from Prisma ----
    let userCount = 0;
    let activeUserCount = 0;
    let premiumUserCount = 0;
    try {
      userCount = await db.user.count();
      activeUserCount = await db.user.count({ where: { is_active: true } });
      premiumUserCount = await db.user.count({
        where: { subscription_tier: 'premium' },
      });
    } catch (err) {
      console.error('[Admin Monitor] Error reading Prisma DB:', err);
    }

    // ---- Light DB stats (stocks, indices, etc.) ----
    let stockCount = 0;
    let activeStockCount = 0;
    let lastDataUpdate: string | null = null;
    let sectorCount = 0;
    let egx30Count = 0;

    try {
      const lightDb = getLightDb();
      const stockStats = lightDb.prepare(`
        SELECT
          COUNT(*) as total_stocks,
          SUM(CASE WHEN is_active = 1 THEN 1 ELSE 0 END) as active_stocks,
          MAX(last_update) as latest_update,
          COUNT(DISTINCT sector) as sector_count,
          SUM(CASE WHEN egx30_member = 1 THEN 1 ELSE 0 END) as egx30_count
        FROM stocks
      `).get() as Record<string, unknown>;

      stockCount = Number(stockStats?.total_stocks) || 0;
      activeStockCount = Number(stockStats?.active_stocks) || 0;
      lastDataUpdate = (stockStats?.latest_update as string) || null;
      sectorCount = Number(stockStats?.sector_count) || 0;
      egx30Count = Number(stockStats?.egx30_count) || 0;
    } catch (err) {
      console.error('[Admin Monitor] Error reading light DB:', err);
    }

    // ---- Heavy DB health (without loading it) ----
    const heavyDbHealth = getHeavyDbHealth();
    const heavyDbAvailable = heavyDbHealth.loaded || heavyDbHealth.dbFileExists;

    // ---- Data freshness ----
    const currentTime = new Date();
    const lastUpdate = lastDataUpdate ? new Date(lastDataUpdate) : null;
    const hoursSinceUpdate = lastUpdate ? Math.floor((currentTime.getTime() - lastUpdate.getTime()) / (1000 * 60 * 60)) : null;
    const dataFreshness = hoursSinceUpdate !== null
      ? hoursSinceUpdate < 4 ? 'fresh' : hoursSinceUpdate < 24 ? 'stale' : 'outdated'
      : 'unknown';

    // ---- System health ----
    const systemHealth = {
      light_db: 'connected',
      heavy_db: heavyDbAvailable ? 'available' : 'not_loaded',
      prisma_db: 'connected',
      data_freshness: dataFreshness,
      hours_since_update: hoursSinceUpdate,
    };

    const result = {
      success: true,
      timestamp: new Date().toISOString(),
      database: {
        total_stocks: stockCount,
        active_stocks: activeStockCount,
        sectors: sectorCount,
        egx30_count: egx30Count,
        price_history_points: heavyDbAvailable ? -1 : 0, // -1 means available but not loaded
        deep_insight_count: heavyDbAvailable ? -1 : 0,
        gold_history_points: heavyDbAvailable ? -1 : 0,
        last_update: lastDataUpdate,
      },
      users: {
        total: userCount,
        active: activeUserCount,
        premium: premiumUserCount,
      },
      platform: {
        watchlist_items: 0,
        portfolio_items: 0,
      },
      predictions: {
        total: 0,
        validated: 0,
        accuracy_percent: 0,
        recent: [],
      },
      feedback_loop: {
        recent_adjustments: [],
      },
      system_health: systemHealth,
      data_freshness: dataFreshness,
    };
    
    // Cache the result
    _lastMonitorData = result;
    _lastMonitorTime = Date.now();
    
    return NextResponse.json(result);
  } catch (error) {
    console.error('[GET /api/admin/monitor] Error:', error);
    return NextResponse.json(
      { success: false, error: 'حدث خطأ أثناء جلب بيانات المراقبة' },
      { status: 500 }
    );
  }
}
